"""
FastAPI service for the Stonks & Texts recommendation engine.

    uvicorn serve:app --reload      # http://localhost:8000/docs

    GET  /health       liveness; 503 while the artifact is unavailable
    GET  /pipeline     describes the artifact: steps, build time, sklearn version
    POST /recommend    runs a day through the pipeline and returns an action

DESIGN NOTES
------------
* The artifact loads ONCE at import into a module-level global. Re-reading and
  re-unpickling it per request would be slow and pointless; a fitted pipeline is
  immutable.

* A failed load is captured, not raised. Throwing at import would kill the
  process and every request would surface as a connection error or a 500.
  Recording the failure lets every route answer 503 -- the service is up, its
  dependency is not.

* Every request field is bounded, so out-of-range input is rejected with a 422
  before the model is touched.

* Every response carries the model's real track record. This model does NOT beat
  a majority-class baseline, and the interface is built to say so rather than
  render a confident-looking recommendation over a coin flip.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Importing this is what makes `pipeline_def.MarketContextFeatures` resolvable
# when joblib unpickles the artifact. Without it the load fails with an opaque
# AttributeError that names nothing useful.
import pipeline_def  # noqa: F401

ARTIFACT_PATH = Path(__file__).resolve().parent / "pipeline.joblib"

BUNDLE: dict[str, Any] | None = None
LOAD_ERROR: str | None = None

try:
    BUNDLE = joblib.load(ARTIFACT_PATH)
    if not isinstance(BUNDLE, dict) or "pipeline" not in BUNDLE:
        raise ValueError("artifact is not a bundle dict containing a 'pipeline' key")
except Exception as exc:  # noqa: BLE001 - any failure must become a 503, not a crash
    BUNDLE = None
    LOAD_ERROR = f"{type(exc).__name__}: {exc}"


def require_bundle() -> dict[str, Any]:
    if BUNDLE is None:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "artifact_unavailable",
                "message": "The model artifact could not be loaded; the service cannot serve recommendations.",
                "artifact_path": str(ARTIFACT_PATH),
                "cause": LOAD_ERROR,
            },
        )
    return BUNDLE


app = FastAPI(
    title="Stonks & Texts — Recommendation Engine",
    description=(
        "Suggests sell / hold / buy for a single trading day, from a fitted "
        "scikit-learn Pipeline: a custom MarketContextFeatures transformer, a "
        "StandardScaler and a LogisticRegression.\n\n"
        "**This model does not beat a majority-class baseline.** That is the expected "
        "result for daily direction prediction, and every response reports its real "
        "accuracy so the caller can present it honestly."
    ),
    version="1.0.0",
)

# The frontend calls this from the browser. Without CORS every request fails in
# the browser while working perfectly from curl -- a confusing way to lose a day.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # public, read-only inference; no credentials involved
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

ACTION_LABELS = {"buy": "Buy more", "hold": "Hold", "sell": "Sell it"}


class RecommendRequest(BaseModel):
    """One trading day, described with strictly backward-looking numbers.

    Bounds are not arbitrary: a close cannot fall more than 100%, no asset in the
    dataset has run a 60-session streak, and the 52-week markers are booleans.
    Anything outside these ranges is malformed and is rejected with a 422.
    """

    pct_change: float = Field(..., ge=-100.0, le=100.0,
        description="Close-to-close change for the day, in percent.", examples=[-7.4])
    volume_ratio: float = Field(..., ge=0.0, le=50.0,
        description="Today's volume over its trailing 20-session average. 1.0 is normal.", examples=[3.1])
    vol_20d: float = Field(30.0, ge=0.0, le=500.0,
        description="Annualised 20-day realised volatility, percent.", examples=[48.0])
    ma50_dist: float = Field(0.0, ge=-100.0, le=100.0,
        description="Distance from the 50-day moving average, percent.", examples=[-12.0])
    drawdown_pct: float = Field(0.0, ge=0.0, le=100.0,
        description="How far below the trailing 52-week high, percent.", examples=[22.0])
    is_52w_high: int = Field(0, ge=0, le=1, description="1 if today set a new 52-week closing high.")
    is_52w_low: int = Field(0, ge=0, le=1, description="1 if today set a new 52-week closing low.")
    down_streak: int = Field(0, ge=0, le=60, description="Consecutive down days ending today.", examples=[4])
    up_streak: int = Field(0, ge=0, le=60, description="Consecutive up days ending today.")
    is_crypto: int = Field(0, ge=0, le=1, description="1 for a 7-day-a-week crypto asset.")


class TrackRecord(BaseModel):
    """How well this model actually does. Returned with every prediction."""
    holdout_accuracy: float
    majority_baseline: float
    beats_baseline: bool
    note: str


class RecommendResponse(BaseModel):
    action: str
    label: str
    confidence: float
    probabilities: dict[str, float]
    track_record: TrackRecord


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
    return {
        **bundle["metadata"],
        "classes": bundle["classes"],
        "pipeline_repr": str(bundle["pipeline"]),
    }


@app.post("/recommend", response_model=RecommendResponse, tags=["inference"])
def recommend(payload: RecommendRequest) -> RecommendResponse:
    """Run one day through the pipeline and return a suggested action."""
    bundle = require_bundle()
    pipeline = bundle["pipeline"]
    meta = bundle["metadata"]

    # Column order is read from the artifact's own metadata rather than retyped,
    # so a request can never be assembled in an order the pipeline wasn't fitted on.
    columns = meta["raw_features"]
    row = pd.DataFrame([[getattr(payload, c) for c in columns]], columns=columns)

    action = str(pipeline.predict(row)[0])
    proba = pipeline.predict_proba(row)[0]

    beats = bool(meta["beats_baseline"])
    note = (
        "This model does not beat a majority-class baseline on held-out data. "
        "Treat the recommendation as a talking point, not advice."
        if not beats else
        "Beats the majority-class baseline on held-out data, though only modestly."
    )

    return RecommendResponse(
        action=action,
        label=ACTION_LABELS.get(action, action),
        confidence=round(float(np.max(proba)), 4),
        probabilities={str(c): round(float(p), 4) for c, p in zip(pipeline.classes_, proba)},
        track_record=TrackRecord(
            holdout_accuracy=meta["holdout_accuracy"],
            majority_baseline=meta["majority_baseline"],
            beats_baseline=beats,
            note=note,
        ),
    )
