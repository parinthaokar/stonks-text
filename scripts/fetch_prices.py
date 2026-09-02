"""
Stonks & Texts -- historical price fetcher.

Pulls ~2 years of daily OHLCV per ticker from Yahoo Finance (no API key) and
writes plain CSVs to data/prices/ plus a data/assets.json manifest.

This script ONLY fetches. Message generation and database loading live in the
Node seed (scripts/seed.ts) so that the message rules engine has exactly one
implementation, shared with the running app.

Re-run any time to refresh:  npm run fetch
"""

from __future__ import annotations

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

ROOT = Path(__file__).resolve().parent.parent
PRICES_DIR = ROOT / "data" / "prices"

# ~2 years: the most recent 12 months are the playable sim window, and the
# 12 months before that exist purely as lookback so that 52-week high/low and
# moving averages are already well-defined on the very first sim day.
YEARS_OF_HISTORY = 2

# A deliberate spread of volatility profiles -- mega-cap steady (MSFT, AAPL),
# high-beta tech (NVDA, TSLA, AMD), meme/crypto-adjacent drama (GME, COIN),
# and true 7-day-a-week crypto (BTC, ETH). Variety here is what makes the
# message rules engine produce an interesting mix of tones.
ASSETS = [
    {"ticker": "AAPL",    "name": "Apple",          "type": "stock",  "category": "Consumer Tech",   "color": "#8E8E93"},
    {"ticker": "MSFT",    "name": "Microsoft",      "type": "stock",  "category": "Software",        "color": "#0A84FF"},
    {"ticker": "GOOGL",   "name": "Alphabet",       "type": "stock",  "category": "Communication",   "color": "#34C759"},
    {"ticker": "AMZN",    "name": "Amazon",         "type": "stock",  "category": "E-Commerce",      "color": "#FF9F0A"},
    {"ticker": "META",    "name": "Meta Platforms", "type": "stock",  "category": "Communication",   "color": "#5E5CE6"},
    {"ticker": "NVDA",    "name": "NVIDIA",         "type": "stock",  "category": "Semiconductors",  "color": "#30D158"},
    {"ticker": "AMD",     "name": "AMD",            "type": "stock",  "category": "Semiconductors",  "color": "#FF453A"},
    {"ticker": "TSLA",    "name": "Tesla",          "type": "stock",  "category": "Autos",           "color": "#FF375F"},
    {"ticker": "COIN",    "name": "Coinbase",       "type": "stock",  "category": "Fintech",         "color": "#0040FF"},
    {"ticker": "GME",     "name": "GameStop",       "type": "stock",  "category": "Retail",          "color": "#BF5AF2"},
    {"ticker": "BTC-USD", "name": "Bitcoin",        "type": "crypto", "category": "Crypto",          "color": "#F7931A"},
    {"ticker": "ETH-USD", "name": "Ethereum",       "type": "crypto", "category": "Crypto",          "color": "#627EEA"},
]

COLUMNS = ["open", "high", "low", "close", "volume"]


def flatten(df: pd.DataFrame, ticker: str) -> pd.DataFrame:
    """yfinance returns MultiIndex columns for some calls and flat for others."""
    if isinstance(df.columns, pd.MultiIndex):
        # Drop whichever level holds the ticker name.
        for level in range(df.columns.nlevels):
            if ticker in df.columns.get_level_values(level):
                df = df.xs(ticker, axis=1, level=level)
                break
        else:
            df.columns = df.columns.get_level_values(0)
    df.columns = [str(c).lower().replace(" ", "_") for c in df.columns]
    return df


def fetch(ticker: str, start: date, end: date) -> pd.DataFrame:
    # auto_adjust=True gives split- and dividend-adjusted prices, which is what
    # a backtest needs -- an unadjusted split shows up as a fake -50% crash and
    # would trip the "big drop" message rule for entirely the wrong reason.
    raw = yf.download(
        ticker,
        start=start.isoformat(),
        end=end.isoformat(),
        interval="1d",
        auto_adjust=True,
        progress=False,
        threads=False,
    )
    if raw is None or raw.empty:
        raise RuntimeError(f"no rows returned for {ticker}")

    df = flatten(raw.copy(), ticker)
    missing = [c for c in COLUMNS if c not in df.columns]
    if missing:
        raise RuntimeError(f"{ticker}: missing columns {missing} (got {list(df.columns)})")

    df = df[COLUMNS].copy()
    df.index = pd.to_datetime(df.index).tz_localize(None).normalize()
    df.index.name = "date"

    # Drop rows where the close is missing; a NaN close is unusable downstream.
    df = df[df["close"].notna()]
    df = df[~df.index.duplicated(keep="last")].sort_index()

    df[["open", "high", "low", "close"]] = df[["open", "high", "low", "close"]].round(6)
    df["volume"] = df["volume"].fillna(0).astype("int64")
    return df


def main() -> int:
    end = date.today() + timedelta(days=1)          # yfinance `end` is exclusive
    start = end - timedelta(days=365 * YEARS_OF_HISTORY + 10)

    PRICES_DIR.mkdir(parents=True, exist_ok=True)
    manifest, failures = [], []

    for i, asset in enumerate(ASSETS):
        ticker = asset["ticker"]
        try:
            df = fetch(ticker, start, end)
        except Exception as exc:                     # noqa: BLE001 - report and continue
            print(f"  {ticker:<8} FAILED  {exc}", file=sys.stderr)
            failures.append(ticker)
            continue

        out = PRICES_DIR / f"{ticker}.csv"
        df.to_csv(out, float_format="%.6f")
        first, last = df.index[0].date(), df.index[-1].date()
        print(f"  {ticker:<8} {len(df):>5} rows  {first} -> {last}")

        manifest.append({**asset, "rows": len(df), "first_date": first.isoformat(),
                         "last_date": last.isoformat(), "file": f"prices/{ticker}.csv"})

        if i < len(ASSETS) - 1:
            time.sleep(1.0)                          # be polite to Yahoo

    if not manifest:
        print("\nNo data fetched at all -- aborting.", file=sys.stderr)
        return 1

    # "Today" for the entire app is the latest date present across ALL assets.
    # Using the max would let crypto (which trades weekends) run ahead of every
    # stock; using the min keeps every asset priced on the final sim day.
    as_of = min(a["last_date"] for a in manifest)

    (ROOT / "data" / "assets.json").write_text(
        json.dumps({"generated_at": date.today().isoformat(), "as_of": as_of,
                    "years_of_history": YEARS_OF_HISTORY, "assets": manifest}, indent=2) + "\n"
    )

    print(f"\n{len(manifest)}/{len(ASSETS)} assets written to data/  (as_of = {as_of})")
    if failures:
        print(f"failed: {', '.join(failures)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
