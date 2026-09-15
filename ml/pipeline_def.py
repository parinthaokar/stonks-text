"""
Custom transformer for the Stonks & Texts recommendation pipeline.

THIS FILE MUST SHIP WHEREVER THE ARTIFACT IS LOADED.
----------------------------------------------------
joblib stores the *import path* of a custom class, not its source. The artifact
references `pipeline_def.MarketContextFeatures`, so anything unpickling it -- the
local server, the Modal container -- must be able to `import pipeline_def`.
Omitting this file from the Modal image is the most common way this deployment
breaks, and it fails with an AttributeError that names nothing useful.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

#: Canonical input order. The API builds its request vector from this list, so
#: the column order can never silently diverge from what was fitted.
RAW_FEATURES = [
    "pct_change",     # close-to-close move today, percent
    "volume_ratio",   # today's volume / trailing 20-session average
    "vol_20d",        # annualised 20-day realised volatility, percent
    "ma50_dist",      # distance from the 50-day moving average, percent
    "drawdown_pct",   # how far below the trailing 52-week high, percent
    "is_52w_high",
    "is_52w_low",
    "down_streak",
    "up_streak",
    "is_crypto",      # crypto trades 7 days a week and moves differently
]


class MarketContextFeatures(BaseEstimator, TransformerMixin):
    """Expand ten raw daily market numbers into modelling features.

    The engineering is deliberately smooth -- magnitude, direction, curvature,
    and interactions -- with no hand-coded thresholds. Nothing here tells the
    model where a "big" move begins; it has to find any boundary itself.

    Parameters
    ----------
    streak_cap:
        Streak lengths are clipped here so one 14-day slide cannot dominate the
        scaled feature and flatten every other row toward zero.
    clip_pct:
        Daily percentage moves are clipped to +/- this, guarding against a bad
        bar in the source data becoming an enormous outlier.
    add_interactions:
        Emit the magnitude x volume and squared-magnitude columns. Exposed as a
        parameter so their contribution can be measured rather than assumed.

    Notes
    -----
    `__init__` only assigns its arguments -- no validation, no derived state.
    scikit-learn's `get_params`/`set_params`, and therefore cloning and grid
    search, require the constructor signature and instance attributes to match
    exactly.
    """

    def __init__(self, streak_cap: int = 10, clip_pct: float = 50.0, add_interactions: bool = True):
        self.streak_cap = streak_cap
        self.clip_pct = clip_pct
        self.add_interactions = add_interactions

    def _to_frame(self, X) -> pd.DataFrame:
        """Accept a DataFrame or a positional array; always return named columns."""
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
        # Stateless with respect to the data: the learned state in this pipeline
        # lives in the scaler and the classifier downstream. The fitted marker is
        # still recorded so a transform before fit fails loudly.
        frame = self._to_frame(X)
        self.n_features_in_ = frame.shape[1]
        self.feature_names_in_ = np.asarray(RAW_FEATURES, dtype=object)
        return self

    def transform(self, X):
        f = self._to_frame(X)

        pct = f["pct_change"].clip(-self.clip_pct, self.clip_pct)
        vol = f["volume_ratio"].clip(lower=0.0)
        realised = f["vol_20d"].clip(lower=0.0)
        ma_dist = f["ma50_dist"].clip(-self.clip_pct, self.clip_pct)
        down = f["down_streak"].clip(0, self.streak_cap)
        up = f["up_streak"].clip(0, self.streak_cap)
        drawdown = f["drawdown_pct"].clip(lower=0.0)

        out = pd.DataFrame(index=f.index)

        # Direction and magnitude kept separate. A -6% and a +6% day are the same
        # size but opposite events, and one signed column averages them together.
        out["pct_change"] = pct
        out["abs_pct_change"] = pct.abs()
        out["pct_up"] = pct.clip(lower=0.0)
        out["pct_down"] = (-pct).clip(lower=0.0)

        # Volume is heavy-tailed; a 30x spike is not thirty times as meaningful
        # as a normal day, so the log stops it swamping the scaler.
        out["volume_ratio"] = vol
        out["log_volume_ratio"] = np.log1p(vol)

        out["vol_20d"] = realised
        out["log_vol_20d"] = np.log1p(realised)

        out["ma50_dist"] = ma_dist
        out["abs_ma50_dist"] = ma_dist.abs()

        out["down_streak"] = down
        out["up_streak"] = up
        out["streak_net"] = up - down

        out["drawdown_pct"] = drawdown
        out["log_drawdown"] = np.log1p(drawdown)

        out["is_52w_high"] = f["is_52w_high"]
        out["is_52w_low"] = f["is_52w_low"]
        out["is_crypto"] = f["is_crypto"]

        if self.add_interactions:
            # A big move ON heavy volume is a different event from a big move on
            # a quiet day, and neither column states that alone.
            out["move_x_volume"] = out["abs_pct_change"] * out["log_volume_ratio"]
            # Curvature: a linear model cannot draw "beyond some threshold" with
            # a straight line, but a squared term lets it bend toward one.
            out["abs_pct_squared"] = out["abs_pct_change"] ** 2
            # Is today's move large relative to how this asset normally moves?
            out["move_vs_normal"] = out["abs_pct_change"] / (realised / np.sqrt(252) + 0.5)

        return out.to_numpy(dtype=float)

    def get_feature_names_out(self, input_features=None):
        names = [
            "pct_change", "abs_pct_change", "pct_up", "pct_down",
            "volume_ratio", "log_volume_ratio",
            "vol_20d", "log_vol_20d",
            "ma50_dist", "abs_ma50_dist",
            "down_streak", "up_streak", "streak_net",
            "drawdown_pct", "log_drawdown",
            "is_52w_high", "is_52w_low", "is_crypto",
        ]
        if self.add_interactions:
            names += ["move_x_volume", "abs_pct_squared", "move_vs_normal"]
        return np.asarray(names, dtype=object)
