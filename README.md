# Stonks & Texts

A paper-trading app where each asset **texts you** about its own price movement, and you
reply with one of three buttons. The question underneath the joke is a real one:

> Does reacting to the texts beat just buying and holding?

Over the seeded window the answer is **yes, by 13.8 points** — but the interesting part is
the controls that make that number mean something. See [Methodology](#methodology).

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

That works from a fresh clone with **no database**. The two years of price data are
committed to `data/`, and the app falls back to a file-backed data source when Supabase
credentials are absent. Add credentials (below) and it switches automatically.

```bash
npm run demo           # auto-play a year so the Portfolio and Data tabs are populated
npm run demo -- --clear   # wipe trades and rewind the clock
```

---

## How it fits together

```
scripts/fetch_prices.py     Yahoo Finance -> data/prices/*.csv        (Python, yfinance)
        |
        v
src/lib/messages/rules.ts   prices -> messages          THE RULES ENGINE
        |
        +--> scripts/seed.ts     writes assets/prices/messages into Supabase
        +--> src/lib/data/       app reads them back (Supabase or local files)
        |
        v
src/lib/portfolio.ts        trades + prices -> equity curve, positions, P&L
src/lib/strategies.ts       messages -> reference strategies for comparison
```

The rules engine has exactly **one** implementation. The seed script imports the same
module the app does, so the messages in the database and the messages the app would
generate can never disagree.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run fetch` | Re-pull 2 years of OHLCV from Yahoo into `data/` |
| `npm run seed` | Load `data/` into Supabase (add `-- --reset` to clear trades) |
| `npm run test:rules` | Run the rules engine over the real data, print the message mix |
| `npm run backtest` | Run the full backtest, write `data/backtest.json` |
| `npm run demo` | Auto-play the sim so there's something to look at |

---

## The data

Twelve tickers, chosen to span volatility profiles so the rules engine produces a varied
mix rather than one tone: mega-cap steady (AAPL, MSFT, GOOGL, AMZN, META), high-beta tech
(NVDA, AMD, TSLA), meme/crypto-adjacent (COIN, GME), and true 7-day crypto (BTC-USD,
ETH-USD).

- ~2 years of daily OHLCV per asset, **split- and dividend-adjusted**. Unadjusted data
  turns a stock split into a fake -50% crash, which would trip the "big drop" rule for
  entirely the wrong reason.
- The most recent date in the dataset is **"today"** throughout the app.
- The most recent **12 months are playable**; the 12 months before that exist only as
  lookback, so 52-week highs/lows and volume averages are already well-defined on the
  first playable day.
- **No runtime API calls.** The CSVs are committed. A deploy is reproducible forever.

### The calendar problem

Crypto prints a bar 7 days a week; stocks print 5. A naive join treats a Saturday as a day
AAPL was worth $0. Every price lookup forward-fills from the last known close, and
`isTradeable()` reports whether an asset genuinely printed a bar that day — so the UI
disables its buttons instead of filling a trade at a stale price.

---

## The rules engine

`src/lib/messages/rules.ts` — eight rules, evaluated in priority order, **first match
wins**. Nothing calls `Math.random()` or `Date.now()`: same prices in, byte-identical
messages out, every run.

| Priority | Rule | Fires when | Tone |
|---|---|---|---|
| 5 | `new_52w_high` | Close is the highest in 52 weeks | euphoric |
| 5 | `new_52w_low` | Close is the lowest in 52 weeks | despondent |
| 4 | `big_gain` | Up more than 5% on the day | manic |
| 4 | `big_drop` | Down more than 5% on the day | anxious |
| 3 | `losing_streak` | 4+ consecutive down days | desperate (escalates) |
| 3 | `winning_streak` | 4+ consecutive up days | smug |
| 2 | `volume_spike` | Volume ≥ 2× the 20-day average | attention |
| 1 | `mundane` | Nothing notable; throttled to one per 7 quiet days | casual |

Every threshold is a named constant in `THRESHOLDS` — one place to tune.

**Where variety comes from.** So threads don't read like form letters, each rule has
several phrasings and one is picked with an FNV-1a hash of `(ticker, date, rule)`. That's
a pure function of the input: varied *and* reproducible. It is not random flavour text —
every message is a claim about what the price actually did, and each bubble in the UI
shows the receipt (the day's move, the volume multiple, the rule that fired).

**Two throttles that matter.** Both were added after measuring the output, not guessed:

- *52-week extremes fire on the breakout day only.* In an uptrend every session sets a new
  high, so the unthrottled rule fired 38 times for GOOGL and "I've never been worth more"
  became meaningless. Requiring that yesterday was *not* also a high turns a 30-day run
  into one message: the day the record was reclaimed.
- *Streaks fire on qualifying, then every other day.* Firing daily made streaks 53.6% of
  all messages and buried everything else. After the fix they're 26.2%.

Run `npm run test:rules` to see the full distribution.

---

## Methodology

This is the part worth reading.

### Execution lag

A message is produced by a day's *closing* price. Filling that same close assumes you knew
where the day would finish before it did. Orders therefore fill at **the next session the
asset actually trades**. The optimistic assumption is available via
`npm run backtest -- --same-close` for comparison — it adds about 1.5 points to the
headline, which is exactly why it isn't the default.

### The baselines

| Strategy | What it does | Return |
|---|---|---|
| **Reactive** | Buys hype, sells panic — the emotional reply to every text | **+28.8%** |
| Buy & hold | Splits $10,000 evenly across all 12 on day one, never trades again | +15.0% |
| Coin flip | Trades on the same days but **ignores what the text said** | +1.9% |
| Contrarian | The same texts read backwards | +7.9% |

**Why the coin flip exists.** Beating buy-and-hold could just mean "you traded a lot in a
rising market." The coin flip runs the same message stream, on the same days, under the
same cash constraint, and picks its action without reading the message. Reactive clears it
by **26.9 points**, which is the comparison that actually supports the claim.

### Position sizing

The reply bar lets you trade $250, $500, $1,000, or your whole balance / position.
The **reference strategies always bet a fixed $500**, and deliberately so: Reactive,
Contrarian and Coin flip are only comparable to each other because every one of them
stakes the same amount on every signal. Letting the benchmarks size variably would turn a
strategy comparison into a position-sizing comparison, which is a different experiment.

Your own curve is derived from your ledger, so variable sizing is handled correctly — but
it does mean a big edge over the benchmark can come from sizing rather than from timing.
Worth saying out loud if you quote your own number rather than the Reactive one.

### A control that didn't work, and what it taught us

The first fairness control was "make the same buys on the same days, but never sell" — to
separate good *timing* from simply being more *exposed*. It's degenerate: under a fixed
$10,000 budget it fills only **20 of ~300** buy orders before running out of cash and then
sits frozen for a year. It isn't "never sells", it's "bought 20 things in week one."

That failure is itself the finding: **selling is what funds the strategy.** Sells recycle
capital, which is why Reactive fills 207 orders where the buys-only variant fills 20.

### Portfolio valuation

The equity curve is **derived from the trade ledger**, not stored as snapshots. You can
trade at any point in the sim window, and any new trade invalidates every snapshot after
its date — a stale row would silently corrupt the headline number. Deriving it means the
chart cannot disagree with the trades that produced it. A `daily_positions` SQL view
exposes the same data for inspection.

Cost basis uses weighted average. Sharpe assumes a 0% risk-free rate; volatility and
Sharpe annualise with the conventional 252-session factor.

### Honest limits

- One historical window, one asset universe. A 13.8-point edge over 12 months is **not**
  evidence the strategy generalises — a different year could easily invert it.
- No transaction costs, no slippage, no bid-ask spread. Reactive places 207 trades and
  buy-and-hold places 12, so costs would hurt it far more.
- Fractional shares are assumed available.

---

## The Mood Engine (ML service)

A separate deliverable living in `ml/`: a fitted scikit-learn Pipeline served over FastAPI,
deployed to Modal, and driven from the app's `/lab` tab.

- **API:** https://parinthaokar--stonks-mood-engine-fastapi-app.modal.run ([docs](https://parinthaokar--stonks-mood-engine-fastapi-app.modal.run/docs))
- **Pipeline:** `MarketMoodFeatures` (custom) → `StandardScaler` → `LogisticRegression`
- **Learned state:** scaler means/stds, regression coefficients, and a `NearestNeighbors`
  index over the 3,320-row scaled training matrix — none of which can be rebuilt at boot
- **Result:** 93.6% accuracy, 0.864 macro-F1, against an 81.1% majority-class baseline

`MarketMoodFeatures` expands seven raw daily numbers into sixteen features — magnitude,
direction, log-scaled volume, capped streaks, a move x volume interaction — and deliberately
encodes **none** of the rules engine's thresholds. The model is never told that 5% is the
line; it has to find that boundary from the data, which is the only part of this that
constitutes learning.

**The honest caveat:** the labels come from this project's own rules engine, so a high score
means the model successfully imitated hand-written rules, not that it discovered anything
about markets. That is appropriate for a serving exercise and is stated plainly on the
`/lab` page rather than dressed up as a predictive result.

See `ml/SUBMISSION.md` for URLs, the write-up, and the rebuild steps.

## Supabase

Create a project, then run `supabase/schema.sql` in the SQL editor. Put credentials in
`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

Supabase is migrating from legacy JWT keys to a new format. Both are accepted — the
legacy names `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` work as
fallbacks (`src/lib/data/env.ts`).

Then `npm run seed`. The app switches to Supabase automatically.

**Schema:** `assets`, `price_history`, `messages`, `trades`, `sim_state`, plus a
`daily_positions` view. There is no auth — this is a single-demo-user app, so RLS is on
everywhere with policies that grant `anon` read on the seeded market data, insert/delete
on `trades`, and update on `sim_state`, and nothing else. The seeded market data cannot be
rewritten through the public key. Real users would need auth and per-user rows.

The secret key is used **only** by the seed script, which needs it because RLS
deliberately makes the seeded tables read-only for the publishable key. It must never be
added to Vercel.

---

## Deploying

Vercel needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Without them
the deploy still works — it serves the committed dataset read-only, but trades won't
persist, because a serverless filesystem is ephemeral.

## Stack

Next.js 16 (App Router) · shadcn/ui + Tailwind v4 · Supabase (Postgres) · Recharts ·
Python + yfinance for the fetch step only.
