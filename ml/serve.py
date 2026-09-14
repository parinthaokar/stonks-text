"""
FastAPI service for the Stonks & Texts mood pipeline.

    uvicorn serve:app --reload       # http://localhost:8000/docs

Three routes:
    GET  /health     liveness, and whether the artifact loaded
    GET  /pipeline   describes the artifact: steps, build time, sklearn version
    POST /predict    runs input through the fitted pipeline

DESIGN NOTES THAT MATTER
------------------------
* The artifact is loaded ONCE, at import, into a module-level global. Loading
  per request would re-read and re-unpickle 556 KB on every call, which is both
  slow and pointless -- the object is immutable once fitted.

* A failed load is captured rather than raised. If this module threw at import,
  the process would die and every request would fail with a connection error or
  a 500. Instead the failure is recorded and every route answers 503 Service
  Unavailable, which is the honest status: the service is up, its dependency is
  not.

* Every request field is bounded, so out-of-range input is rejected by FastAPI
  with a 422 before it ever reaches the model.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Importing the module is what makes `pipeline_def.MarketMoodFeatures`
# resolvable when joblib unpickles the artifact. Without this import present in
# the image, the load below fails with an opaque AttributeError.
import pipeline_def  # noqa: F401

ARTIFACT_PATH = Path(__file__).resolve().parent / "pipeline.joblib"

# ---------------------------------------------------------------------------
# Load once, at import
# ---------------------------------------------------------------------------

BUNDLE: dict[str, Any] | None = None
LOAD_ERROR: str | None = None

try:
    BUNDLE = joblib.load(ARTIFACT_PATH)
    if not isinstance(BUNDLE, dict) or "pipeline" not in BUNDLE:
        raise ValueError("artifact is not a bundle dict containing a 'pipeline' key")
except Exception as exc:  # noqa: BLE001 - any failure here must become a 503, not a crash
    BUNDLE = None
    LOAD_ERROR = f"{type(exc).__name__}: {exc}"


def require_bundle() -> dict[str, Any]:
    """Return the loaded bundle, or fail the request with 503."""
    if BUNDLE is None:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "artifact_unavailable",
                "message": "The model artifact could not be loaded; the service cannot serve predictions.",
                "artifact_path": str(ARTIFACT_PATH),
                "cause": LOAD_ERROR,
            },
        )
    return BUNDLE


app = FastAPI(
    title="Stonks & Texts — Mood Engine",
    description=(
        "Turns a day of market numbers into the mood the asset would text you in. "
        "Backed by a fitted scikit-learn Pipeline: a custom MarketMoodFeatures "
        "transformer, a StandardScaler, and a LogisticRegression."
    ),
    version="1.0.0",
)

# The Vercel frontend calls this directly from the browser, so without CORS every
# request fails in the browser while working perfectly from curl -- which is a
# genuinely confusing way to lose an afternoon.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # public read-only inference; no credentials, nothing to protect
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

#: Human labels for each tone, mirroring RULE_META in the TypeScript engine.
TONE_LABELS = {
    "euphoric": "New 52-week high",
    "despondent": "New 52-week low",
    "manic": "Big gain",
    "anxious": "Big drop",
    "desperate": "Losing streak",
    "smug": "Winning streak",
    "attention": "Volume spike",
    "casual": "Ordinary day",
}


class PredictRequest(BaseModel):
    """One trading day, described the way the rules engine sees it.

    Every field is bounded. These are not arbitrary: a day cannot move less than
    -100%, a streak of 60 sessions has never happened in the dataset, and the
    52-week flags are booleans. Anything outside these ranges is a malformed
    request, and FastAPI rejects it with a 422 before the model is touched.
    """

    pct_change: float = Field(
        ..., ge=-100.0, le=100.0,
        description="Close-to-close change for the day, in percent.",
        examples=[-7.4],
    )
    volume_ratio: float = Field(
        ..., ge=0.0, le=50.0,
        description="Today's volume divided by the trailing 20-session average. 1.0 is normal.",
        examples=[3.1],
    )
    down_streak: int = Field(
        0, ge=0, le=60, description="Consecutive down days ending today.", examples=[4],
    )
    up_streak: int = Field(
        0, ge=0, le=60, description="Consecutive up days ending today.", examples=[0],
    )
    drawdown_pct: float = Field(
        0.0, ge=0.0, le=100.0,
        description="How far below the trailing 52-week high, in percent.", examples=[22.0],
    )
    is_52w_high: int = Field(
        0, ge=0, le=1, description="1 if today set a new 52-week closing high.", examples=[0],
    )
    is_52w_low: int = Field(
        0, ge=0, le=1, description="1 if today set a new 52-week closing low.", examples=[1],
    )


class NeighborOut(BaseModel):
    ticker: str
    date: str
    tone: str
    pct_change: float
    volume_ratio: float
    distance: float


class PredictResponse(BaseModel):
    tone: str
    label: str
    confidence: float
    probabilities: dict[str, float]
    example_message: str
    nearest_days: list[NeighborOut]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health", tags=["meta"])
def health() -> dict[str, Any]:
    """Liveness. 503 while the artifact is unavailable."""
    bundle = require_bundle()
    return {
        "status": "ok",
        "artifact_loaded": True,
        "model": bundle["metadata"]["name"],
        "sklearn_version": bundle["metadata"]["sklearn_version"],
    }


@app.get("/pipeline", tags=["meta"])
def describe_pipeline() -> dict[str, Any]:
    """Describe the fitted artifact: what it is, when it was built, what it expects."""
    bundle = require_bundle()
    meta = bundle["metadata"]
    return {
        **meta,
        "classes": bundle["classes"],
        "n_indexed_days": len(bundle["index"]),
        "n_example_messages": sum(len(v) for v in bundle["documents"].values()),
        "pipeline_repr": str(bundle["pipeline"]),
    }


@app.post("/predict", response_model=PredictResponse, tags=["inference"])
def predict(payload: PredictRequest) -> PredictResponse:
    """Run one day through the pipeline and return its mood."""
    bundle = require_bundle()
    pipeline = bundle["pipeline"]

    # Column order comes from the artifact's own metadata rather than being
    # retyped here, so the request can never be assembled in an order the
    # pipeline wasn't fitted on.
    columns = bundle["metadata"]["raw_features"]
    row = pd.DataFrame([[getattr(payload, c) for c in columns]], columns=columns)

    tone = str(pipeline.predict(row)[0])
    proba = pipeline.predict_proba(row)[0]
    probabilities = {
        str(cls): round(float(p), 4) for cls, p in zip(pipeline.classes_, proba)
    }

    # Nearest real days, measured in the same scaled space the classifier uses.
    scaled = pipeline[:-1].transform(row)
    distances, indices = bundle["neighbors"].kneighbors(scaled, n_neighbors=3)
    nearest = [
        NeighborOut(
            ticker=bundle["index"][int(i)]["ticker"],
            date=str(bundle["index"][int(i)]["date"]),
            tone=bundle["index"][int(i)]["tone"],
            pct_change=round(float(bundle["index"][int(i)]["pct_change"]), 2),
            volume_ratio=round(float(bundle["index"][int(i)]["volume_ratio"]), 2),
            distance=round(float(d), 4),
        )
        for d, i in zip(distances[0], indices[0])
    ]

    # Pick an example phrasing deterministically from the input, so the same
    # request always returns the same message. Matches the rest of the project,
    # where nothing about a message is random.
    pool = bundle["documents"].get(tone) or ["(no example available)"]
    seed = hashlib.sha256(
        "|".join(f"{getattr(payload, c)}" for c in columns).encode()
    ).hexdigest()
    example = pool[int(seed, 16) % len(pool)]

    return PredictResponse(
        tone=tone,
        label=TONE_LABELS.get(tone, tone),
        confidence=round(float(np.max(proba)), 4),
        probabilities=probabilities,
        example_message=example,
        nearest_days=nearest,
    )
