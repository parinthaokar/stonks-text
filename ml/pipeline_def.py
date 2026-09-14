"""
Custom transformer for the Stonks & Texts mood pipeline.

THIS FILE MUST SHIP WHEREVER THE ARTIFACT IS LOADED.
----------------------------------------------------
joblib records the *import path* of every custom class inside the pipeline, not
its source. The saved artifact contains a reference to
`pipeline_def.MarketMoodFeatures`, so anything unpickling it -- the local server,
the Modal container -- must be able to `import pipeline_def`. Leaving this file
out of the Modal image is the single most common way this deployment fails, and
it fails at load with an opaque AttributeError rather than anything helpful.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

#: Canonical order of the raw inputs. The API builds its request vector from
#: this, so the order can never silently disagree with what was fitted.
RAW_FEATURES = [
    "pct_change",
    "volume_ratio",
    "down_streak",
    "up_streak",
    "drawdown_pct",
    "is_52w_high",
    "is_52w_low",
]


class MarketMoodFeatures(BaseEstimator, TransformerMixin):
    """Expand seven raw daily market numbers into modelling features.

    The engineering here is deliberately *smooth*. The labels come from rules
    with hard thresholds ("a move over 5% is a big day"), and it would be easy
    to hand the model a `pct_change >= 5` indicator and let it score ~100%. That
    would be handing over the answer rather than learning it, so no threshold
    from the rules engine appears anywhere below. Instead the transformer
    supplies magnitude, direction, curvature and an interaction term, and the
    model has to find the boundaries itself.

    Parameters
    ----------
    streak_cap:
        Streaks are clipped here. A single 14-day slide would otherwise dominate
        the scaled feature and drag every other row toward zero.
    clip_pct:
        Daily percentage moves are clipped to +/- this. Guards against a bad bar
        in the source data turning into an enormous outlier.
    add_interactions:
        Whether to emit the magnitude x volume and squared-magnitude columns.
        Exposed so the effect of the interaction terms can be measured rather
        than assumed.

    Notes
    -----
    `__init__` only assigns its arguments -- no validation, no derived
    attributes. scikit-learn's `get_params`/`set_params` (and therefore cloning,
    grid search, and this object's own repr) require the constructor signature
    and the instance attributes to correspond exactly.
    """

    def __init__(self, streak_cap: int = 10, clip_pct: float = 50.0, add_interactions: bool = True):
        self.streak_cap = streak_cap
        self.clip_pct = clip_pct
        self.add_interactions = add_interactions

    # -- sklearn plumbing ---------------------------------------------------

    def _to_frame(self, X) -> pd.DataFrame:
        """Accept a DataFrame or a positional array, always return named columns."""
        if isinstance(X, pd.DataFrame):
            missing = [c for c in RAW_FEATURES if c not in X.columns]
            if missing:
                raise ValueError(f"missing required columns: {missing}")
            return X[RAW_FEATURES].astype(float).copy()

        arr = np.asarray(X, dtype=float)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        if arr.shape[1] != len(RAW_FEATURES):
            raise ValueError(f"expected {len(RAW_FEATURES)} columns, got {arr.shape[1]}")
        return pd.DataFrame(arr, columns=RAW_FEATURES)

    def fit(self, X, y=None):
        # Stateless with respect to the data -- the learned state in this
        # pipeline lives in the scaler and the classifier downstream. The
        # fitted attribute is still recorded so `check_is_fitted` behaves and
        # so a transform before fit fails loudly instead of silently working.
        frame = self._to_frame(X)
        self.n_features_in_ = frame.shape[1]
        self.feature_names_in_ = np.asarray(RAW_FEATURES, dtype=object)
        return self

    def transform(self, X):
        frame = self._to_frame(X)

        pct = frame["pct_change"].clip(-self.clip_pct, self.clip_pct)
        vol = frame["volume_ratio"].clip(lower=0.0)
        down = frame["down_streak"].clip(0, self.streak_cap)
        up = frame["up_streak"].clip(0, self.streak_cap)
        drawdown = frame["drawdown_pct"].clip(lower=0.0)

        out = pd.DataFrame(index=frame.index)

        # Direction and magnitude, separated. A -6% day and a +6% day are the
        # same size but opposite moods, and a single signed column makes a
        # linear model average the two together.
        out["pct_change"] = pct
        out["abs_pct_change"] = pct.abs()
        out["pct_up"] = pct.clip(lower=0.0)
        out["pct_down"] = (-pct).clip(lower=0.0)

        # Volume is heavy-tailed -- a 30x spike is not "30 times as newsworthy"
        # as a 1x day, so the log keeps it from swamping the scaler.
        out["volume_ratio"] = vol
        out["log_volume_ratio"] = np.log1p(vol)

        out["down_streak"] = down
        out["up_streak"] = up
        out["streak_net"] = up - down
        out["in_streak"] = ((down > 0) | (up > 0)).astype(float)

        out["drawdown_pct"] = drawdown
        out["log_drawdown"] = np.log1p(drawdown)

        out["is_52w_high"] = frame["is_52w_high"]
        out["is_52w_low"] = frame["is_52w_low"]

        if self.add_interactions:
            # A big move ON heavy volume is a different event from a big move on
            # a quiet day, and neither column says that on its own.
            out["move_x_volume"] = out["abs_pct_change"] * out["log_volume_ratio"]
            # Curvature. A linear model cannot represent "above 5%" with a
            # straight line; a squared term lets it bend toward one.
            out["abs_pct_squared"] = out["abs_pct_change"] ** 2

        return out.to_numpy(dtype=float)

    def get_feature_names_out(self, input_features=None):
        names = [
            "pct_change", "abs_pct_change", "pct_up", "pct_down",
            "volume_ratio", "log_volume_ratio",
            "down_streak", "up_streak", "streak_net", "in_streak",
            "drawdown_pct", "log_drawdown",
            "is_52w_high", "is_52w_low",
        ]
        if self.add_interactions:
            names += ["move_x_volume", "abs_pct_squared"]
        return np.asarray(names, dtype=object)
