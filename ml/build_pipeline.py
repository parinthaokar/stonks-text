"""
Fit the recommendation pipeline and dump the artifact bundle.

    python ml/build_pipeline.py

Reads the committed price CSVs, builds strictly backward-looking features,
labels each day with what would have been the best action, fits the pipeline and
writes ml/pipeline.joblib.

THE LABEL
---------
For each day, look at the return from the NEXT session's close to five sessions
after that (t+1 -> t+6):

    beyond +BAND%   -> "buy" was right
    beyond -BAND%   -> "sell" was right
    inside the band -> "hold" was right

t+1, not t, because a signal produced by today's close cannot be traded until
tomorrow. Measuring from today would credit the model with a move that had
already happened.

HONEST EVALUATION
-----------------
The split is temporal with an embargo, and the resulting accuracy -- including
the fact that it does not beat the baseline -- is written into the artifact's
metadata. The API returns those numbers with every prediction so the interface
can state the model's real track record instead of implying confidence it has
not earned.
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
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from pipeline_def import MarketContextFeatures, RAW_FEATURES  # noqa: E402

ARTIFACT = HERE / "pipeline.joblib"

#: Move beyond this over the forward window for "buy"/"sell" to have been right.
#: 2.0 was chosen because it splits the data almost evenly three ways (32/32/35),
#: which keeps the majority baseline low and leaves room to show skill.
BAND = 2.0
FORWARD_SESSIONS = 5
TRAIN_FRACTION = 0.75
#: Calendar days held out between train and test. A five-session forward label
#: overlaps its neighbours', so adjacent rows either side of a naive split share
#: outcome data. Without this gap the score is inflated by leakage.
EMBARGO_DAYS = 10


def build_frame() -> pd.DataFrame:
    """Load every asset and derive backward-looking features plus the label."""
    manifest = json.loads((ROOT / "data" / "assets.json").read_text())
    frames = []

    for asset in manifest["assets"]:
        d = pd.read_csv(ROOT / "data" / asset["file"], parse_dates=["date"]).sort_values("date")
        d["ticker"] = asset["ticker"]
        d["is_crypto"] = 1 if asset["type"] == "crypto" else 0

        # --- features: every window looks strictly backwards -----------------
        d["pct_change"] = d["close"].pct_change() * 100
        # .shift(1) on the average so today's own volume is not in its own baseline
        d["volume_ratio"] = d["volume"] / d["volume"].rolling(20).mean().shift(1)
        d["vol_20d"] = d["close"].pct_change().rolling(20).std() * np.sqrt(252) * 100
        d["ma50_dist"] = (d["close"] / d["close"].rolling(50).mean() - 1) * 100

        roll_max = d["close"].rolling(252, min_periods=60).max()
        roll_min = d["close"].rolling(252, min_periods=60).min()
        d["drawdown_pct"] = (roll_max - d["close"]) / roll_max * 100
        d["is_52w_high"] = (d["close"] >= roll_max).astype(int)
        d["is_52w_low"] = (d["close"] <= roll_min).astype(int)

        sign = np.sign(d["pct_change"].fillna(0))
        run = d.groupby((sign != sign.shift()).cumsum()).cumcount() + 1
        d["down_streak"] = np.where(sign < 0, run, 0)
        d["up_streak"] = np.where(sign > 0, run, 0)

        # --- label: acts tomorrow, measured five sessions later --------------
        d["forward_return"] = (
            d["close"].shift(-(FORWARD_SESSIONS + 1)) / d["close"].shift(-1) - 1
        ) * 100

        frames.append(d)

    df = pd.concat(frames).dropna(subset=RAW_FEATURES + ["forward_return"])
    df["label"] = pd.cut(
        df["forward_return"], [-np.inf, -BAND, BAND, np.inf], labels=["sell", "hold", "buy"]
    ).astype(str)
    return df.sort_values("date").reset_index(drop=True)


def main() -> int:
    df = build_frame()
    print(f"rows        : {len(df)}   {df.date.min().date()} -> {df.date.max().date()}")
    balance = df["label"].value_counts(normalize=True).mul(100).round(1)
    print(f"label mix   : " + "  ".join(f"{k} {v}%" for k, v in balance.items()))

    cut = df["date"].iloc[int(len(df) * TRAIN_FRACTION)]
    train = df[df["date"] < cut - pd.Timedelta(days=EMBARGO_DAYS)]
    test = df[df["date"] >= cut]
    print(f"train       : {len(train)} rows, to {train.date.max().date()}")
    print(f"test        : {len(test)} rows, from {test.date.min().date()}  ({EMBARGO_DAYS}d embargo)\n")

    X_train, y_train = train[RAW_FEATURES], train["label"]
    X_test, y_test = test[RAW_FEATURES], test["label"]

    pipeline = Pipeline([
        ("features", MarketContextFeatures(streak_cap=10, clip_pct=50.0, add_interactions=True)),
        ("scaler", StandardScaler()),
        # Logistic regression on purpose. Trees and boosting were tested and land
        # in the same place, and a linear model at least yields readable
        # coefficients -- worth more than a fractional score difference that is
        # noise at this sample size.
        ("classifier", LogisticRegression(max_iter=4000, C=1.0, random_state=42)),
    ])
    pipeline.fit(X_train, y_train)

    pred = pipeline.predict(X_test)
    acc = accuracy_score(y_test, pred)
    macro = f1_score(y_test, pred, average="macro")

    baseline = DummyClassifier(strategy="most_frequent").fit(X_train, y_train)
    base_acc = accuracy_score(y_test, baseline.predict(X_test))

    print(f"accuracy         : {acc:.3f}")
    print(f"macro F1         : {macro:.3f}")
    print(f"majority baseline: {base_acc:.3f}")
    print(f"beats baseline   : {'YES' if acc > base_acc else 'NO  <- expected; markets are not predictable'}\n")
    print(classification_report(y_test, pred, zero_division=0))

    labels = sorted(y_test.unique())
    print("confusion matrix (rows = actual, cols = predicted)")
    print("          " + " ".join(f"{l:>7}" for l in labels))
    for label, row in zip(labels, confusion_matrix(y_test, pred, labels=labels)):
        print(f"  {label:<7} " + " ".join(f"{v:>7}" for v in row))

    # Refit on everything. The split above exists to produce an honest estimate;
    # the shipped artifact should use all the data that estimate was measured on.
    pipeline.fit(df[RAW_FEATURES], df["label"])

    coefs = pd.DataFrame(
        pipeline.named_steps["classifier"].coef_,
        index=pipeline.named_steps["classifier"].classes_,
        columns=pipeline.named_steps["features"].get_feature_names_out(),
    )

    bundle = {
        "pipeline": pipeline,
        "classes": list(pipeline.named_steps["classifier"].classes_),
        "coefficients": coefs.round(4).to_dict(),
        "metadata": {
            "name": "stonks-recommendation-engine",
            "steps": [name for name, _ in pipeline.steps],
            "built_at": datetime.now(timezone.utc).isoformat(),
            "sklearn_version": sklearn.__version__,
            "python_version": sys.version.split()[0],
            "custom_transformer": "MarketContextFeatures",
            "n_training_rows": int(len(df)),
            "raw_features": RAW_FEATURES,
            "engineered_features": list(pipeline.named_steps["features"].get_feature_names_out()),
            "label_definition": (
                f"best action over t+1 -> t+{FORWARD_SESSIONS + 1}, band +/-{BAND}%"
            ),
            "forward_sessions": FORWARD_SESSIONS,
            "band_pct": BAND,
            # Shipped with the model so the UI can state its real track record
            # next to every prediction rather than implying unearned confidence.
            "holdout_accuracy": round(float(acc), 4),
            "holdout_macro_f1": round(float(macro), 4),
            "majority_baseline": round(float(base_acc), 4),
            "beats_baseline": bool(acc > base_acc),
            "evaluation": (
                f"Temporal split ({TRAIN_FRACTION:.0%}/{1 - TRAIN_FRACTION:.0%}) with a "
                f"{EMBARGO_DAYS}-day embargo. Features are strictly backward-looking and "
                f"orders fill the session after the signal."
            ),
        },
    }

    joblib.dump(bundle, ARTIFACT, compress=3)

    # Export a prediction for every day so the app's backtest can plot the model
    # as a strategy without making ~900 HTTP calls to render one chart. The API
    # serves single live predictions; this file serves the historical curve.
    preds = pipeline.predict(df[RAW_FEATURES])
    out = {f"{t}|{d.date()}": str(p) for t, d, p in zip(df["ticker"], df["date"], preds)}
    (ROOT / "data" / "ml").mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "ml" / "predictions.json").write_text(
        json.dumps({
            "generated_at": bundle["metadata"]["built_at"],
            "model": bundle["metadata"]["name"],
            "sklearn_version": bundle["metadata"]["sklearn_version"],
            "holdout_accuracy": bundle["metadata"]["holdout_accuracy"],
            "majority_baseline": bundle["metadata"]["majority_baseline"],
            "predictions": out,
        }, indent=0) + "\n"
    )
    print(f"wrote data/ml/predictions.json  ({len(out)} days)")

    import fastapi, pydantic, scipy, uvicorn  # noqa: PLC0415 - only for the pin file
    (HERE / "requirements.txt").write_text(
        "# Generated by build_pipeline.py -- pinned to the versions that built\n"
        "# pipeline.joblib. Do not edit by hand; rebuild instead.\n"
        f"scikit-learn=={sklearn.__version__}\n"
        f"numpy=={np.__version__}\n"
        f"pandas=={pd.__version__}\n"
        f"scipy=={scipy.__version__}\n"
        f"joblib=={joblib.__version__}\n"
        f"fastapi=={fastapi.__version__}\n"
        f"uvicorn=={uvicorn.__version__}\n"
        f"pydantic=={pydantic.VERSION}\n"
    )

    print(f"\nwrote {ARTIFACT}  ({ARTIFACT.stat().st_size / 1024:.0f} KB)")
    print(f"sklearn {sklearn.__version__}  |  {' -> '.join(bundle['metadata']['steps'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
