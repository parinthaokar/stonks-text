"""
Fit the mood pipeline and dump the artifact bundle.

    python ml/build_pipeline.py

Reads data/ml/training.csv (written by `npm run ml:export`, which labels every
day using the app's real rules engine) and writes ml/pipeline.joblib.

WHAT IS ACTUALLY LEARNED
------------------------
Three pieces of state end up in the artifact, and all three would be wrong if
rebuilt from scratch at boot:

  * StandardScaler     per-feature mean and standard deviation of the training set
  * LogisticRegression one coefficient per feature per class, plus intercepts
  * NearestNeighbors   an index over the scaled training matrix, used to answer
                       "which real day does this most resemble?"

The custom transformer itself is deterministic, which is the point: it defines
the feature space, and the learned numbers above are expressed in that space. A
transformer whose output changed between build and serve would invalidate every
coefficient downstream.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.neighbors import NearestNeighbors
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))  # so `import pipeline_def` works from any cwd

from pipeline_def import MarketMoodFeatures, RAW_FEATURES  # noqa: E402

TRAINING_CSV = ROOT / "data" / "ml" / "training.csv"
DOCUMENTS_JSON = ROOT / "data" / "ml" / "documents.json"
ARTIFACT = HERE / "pipeline.joblib"

#: Fraction of the (date-ordered) rows used for training.
TRAIN_FRACTION = 0.70


def main() -> int:
    if not TRAINING_CSV.exists():
        print(f"missing {TRAINING_CSV} -- run `npm run ml:export` first", file=sys.stderr)
        return 1

    df = pd.read_csv(TRAINING_CSV)
    documents = json.loads(DOCUMENTS_JSON.read_text())

    # TEMPORAL SPLIT, NOT A RANDOM ONE.
    # Shuffling rows from a time series lets the model train on days that come
    # after the ones it is tested on. It is not strictly leakage here -- the
    # label depends only on the same row's features -- but a random split on
    # market data is the classic way to report a number that evaporates in
    # production, so it is not a habit worth having.
    df = df.sort_values("date").reset_index(drop=True)
    split = int(len(df) * TRAIN_FRACTION)
    train, test = df.iloc[:split], df.iloc[split:]

    X_train, y_train = train[RAW_FEATURES], train["tone"]
    X_test, y_test = test[RAW_FEATURES], test["tone"]

    print(f"rows        : {len(df)}  (train {len(train)} / test {len(test)})")
    print(f"train dates : {train.date.min()} -> {train.date.max()}")
    print(f"test dates  : {test.date.min()} -> {test.date.max()}")
    print(f"classes     : {sorted(y_train.unique())}\n")

    pipeline = Pipeline([
        ("features", MarketMoodFeatures(streak_cap=10, clip_pct=50.0, add_interactions=True)),
        ("scaler", StandardScaler()),
        # class_weight="balanced" is doing real work: 81% of days are `mundane`,
        # so an unweighted fit maximises accuracy by nearly always saying
        # "mundane" and the whole demo stops responding to its inputs. Balancing
        # trades overall accuracy for actually learning the rare moods, which is
        # the behaviour the app needs.
        ("classifier", LogisticRegression(
            max_iter=4000, class_weight="balanced", C=2.0, random_state=42,
        )),
    ])

    pipeline.fit(X_train, y_train)

    pred = pipeline.predict(X_test)
    acc = accuracy_score(y_test, pred)
    macro_f1 = f1_score(y_test, pred, average="macro")

    # Accuracy alone is misleading at 81% class imbalance -- "always mundane"
    # scores 0.81 while being useless. Macro F1 weights every mood equally and
    # is the number that actually says whether the rare ones were learned.
    baseline = (y_test == y_test.mode()[0]).mean()
    print(f"accuracy        : {acc:.3f}")
    print(f"macro F1        : {macro_f1:.3f}")
    print(f"majority baseline: {baseline:.3f}  (always predicting '{y_test.mode()[0]}')\n")
    print(classification_report(y_test, pred, zero_division=0))

    labels = sorted(y_test.unique())
    cm = confusion_matrix(y_test, pred, labels=labels)
    print("confusion matrix (rows = actual, cols = predicted)")
    print("               " + " ".join(f"{l[:6]:>7}" for l in labels))
    for label, row in zip(labels, cm):
        print(f"  {label:<12} " + " ".join(f"{v:>7}" for v in row))

    # Refit on everything before shipping. The split above exists to produce an
    # honest estimate; the artifact that goes to production should use all the
    # data that estimate was measured on.
    pipeline.fit(df[RAW_FEATURES], df["tone"])

    # Nearest-neighbour index over the SCALED feature space, so distances mean
    # the same thing the classifier sees. Built from the pipeline's own fitted
    # steps rather than a second scaler, which could drift from it.
    matrix = pipeline[:-1].transform(df[RAW_FEATURES])
    neighbors = NearestNeighbors(n_neighbors=5, metric="euclidean").fit(matrix)

    bundle = {
        "pipeline": pipeline,
        "matrix": matrix,
        "neighbors": neighbors,
        "index": df[["ticker", "date", "rule", "tone", "pct_change", "volume_ratio"]].to_dict("records"),
        "documents": documents,
        "classes": list(pipeline.named_steps["classifier"].classes_),
        "metadata": {
            "name": "stonks-mood-engine",
            "steps": [name for name, _ in pipeline.steps],
            "built_at": datetime.now(timezone.utc).isoformat(),
            "sklearn_version": sklearn.__version__,
            "python_version": sys.version.split()[0],
            "n_training_rows": int(len(df)),
            "raw_features": RAW_FEATURES,
            "engineered_features": list(
                pipeline.named_steps["features"].get_feature_names_out()
            ),
            "custom_transformer": "MarketMoodFeatures",
            "holdout_accuracy": round(float(acc), 4),
            "holdout_macro_f1": round(float(macro_f1), 4),
            "majority_baseline": round(float(baseline), 4),
        },
    }

    joblib.dump(bundle, ARTIFACT, compress=3)

    # Write the pin file from the versions that ACTUALLY produced this artifact,
    # rather than maintaining a hand-edited list that silently drifts. A pickle
    # carries references into numpy/scipy internals, so a mismatch on any of
    # these can fail the load in the container -- not just scikit-learn.
    import fastapi, numpy, pandas, pydantic, scipy, uvicorn  # noqa: PLC0415 - only for the pin file
    (HERE / "requirements.txt").write_text(
        "# Generated by build_pipeline.py -- pinned to the versions that built\n"
        "# pipeline.joblib. Do not edit by hand; rebuild instead.\n"
        f"scikit-learn=={sklearn.__version__}\n"
        f"numpy=={numpy.__version__}\n"
        f"pandas=={pandas.__version__}\n"
        f"scipy=={scipy.__version__}\n"
        f"joblib=={joblib.__version__}\n"
        f"fastapi=={fastapi.__version__}\n"
        f"uvicorn=={uvicorn.__version__}\n"
        f"pydantic=={pydantic.VERSION}\n"
    )
    size_kb = ARTIFACT.stat().st_size / 1024
    print(f"\nwrote {ARTIFACT}  ({size_kb:.0f} KB)")
    print(f"sklearn {sklearn.__version__}  |  steps: {' -> '.join(bundle['metadata']['steps'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
