/**
 * ============================================================================
 *  STONKS & TEXTS -- PORTFOLIO VALUATION & BACKTEST
 * ============================================================================
 *
 * Everything numeric on the Portfolio and Data tabs comes from here. The rules
 * engine decides what an asset SAYS; this module decides what your replies were
 * actually WORTH.
 *
 * The equity curve is derived from the trade ledger rather than stored as
 * snapshots. In this app you can trade at any point in the sim window, and any
 * new trade invalidates every snapshot after its date -- a stale row would
 * silently corrupt the headline "did you beat buy-and-hold?" number. Deriving
 * it means the chart cannot disagree with the trades that produced it.
 *
 * CALENDAR NOTE (this is the subtle one):
 * Crypto prints a bar 7 days a week; stocks print 5. A naive join would treat a
 * Saturday as a day AAPL was worth $0. Every price lookup here therefore
 * forward-fills from the last known close, and `isTradeable` reports whether an
 * asset genuinely printed a bar on a given date so the UI can disable its
 * buttons instead of filling a trade at a stale price.
 */

import type { Bar } from "./messages/rules";

export type TradeAction = "buy" | "sell" | "hold";

export interface Trade {
  ticker: string;
  action: TradeAction;
  /** Shares (fractional allowed). Always 0 for a 'hold'. */
  quantity: number;
  /** Execution price -- the close of `date`. */
  price: number;
  /** SIM date the trade executed at, not wall-clock time. */
  date: string;
  /**
   * The date of the message that prompted this trade. Differs from `date`
   * whenever execution lag applies, which is why it is tracked separately --
   * linking a fill back to its message by fill date silently matches nothing.
   */
  messageDate?: string;
}

export interface EquityPoint {
  date: string;
  cash: number;
  holdingsValue: number;
  totalValue: number;
}

export interface Position {
  ticker: string;
  shares: number;
  /** Weighted average cost of the shares currently held. */
  avgCost: number;
  lastPrice: number;
  marketValue: number;
  /** Gain/loss on shares still held. */
  unrealizedPnl: number;
  /** Locked-in gain/loss from shares already sold. */
  realizedPnl: number;
}

// ---------------------------------------------------------------------------
// Price lookup
// ---------------------------------------------------------------------------

export interface PriceLookup {
  /** Every date any asset traded, ascending. This is the sim clock. */
  dates: string[];
  tickers: string[];
  /** Last known close on or before `date`, or null if the asset hadn't started. */
  closeOn(ticker: string, date: string): number | null;
  /** Did this asset actually print a bar on this exact date? */
  isTradeable(ticker: string, date: string): boolean;
  /**
   * The first date strictly after `date` on which this asset really traded.
   * Used to model execution lag: you cannot act on a closing price until the
   * session after the one that produced it.
   */
  nextTradeableDate(ticker: string, date: string): string | null;
}

/**
 * Build a forward-filling price lookup from raw bars.
 *
 * Pre-computes a dense per-ticker array over the unified date axis so that
 * valuation is an O(1) array read per (asset, day) rather than a search. The
 * whole structure is 12 x ~740 numbers.
 */
export function buildPriceLookup(barsByTicker: Record<string, Bar[]>): PriceLookup {
  const tickers = Object.keys(barsByTicker);

  const dateSet = new Set<string>();
  for (const t of tickers) for (const b of barsByTicker[t]) dateSet.add(b.date);
  const dates = [...dateSet].sort();
  const indexOfDate = new Map(dates.map((d, i) => [d, i]));

  // filled[ticker][i] = last known close at dates[i]; exact[ticker][i] = a real bar.
  const filled: Record<string, (number | null)[]> = {};
  const exact: Record<string, boolean[]> = {};

  for (const t of tickers) {
    const dense: (number | null)[] = new Array(dates.length).fill(null);
    const isExact: boolean[] = new Array(dates.length).fill(false);

    for (const b of barsByTicker[t]) {
      const i = indexOfDate.get(b.date)!;
      dense[i] = b.close;
      isExact[i] = true;
    }
    // Forward-fill the gaps (weekends and holidays for stocks).
    for (let i = 1; i < dense.length; i++) {
      if (dense[i] === null) dense[i] = dense[i - 1];
    }
    filled[t] = dense;
    exact[t] = isExact;
  }

  return {
    dates,
    tickers,
    closeOn(ticker, date) {
      const i = indexOfDate.get(date);
      if (i === undefined) return null;
      return filled[ticker]?.[i] ?? null;
    },
    isTradeable(ticker, date) {
      const i = indexOfDate.get(date);
      if (i === undefined) return false;
      return exact[ticker]?.[i] ?? false;
    },
    nextTradeableDate(ticker, date) {
      const i = indexOfDate.get(date);
      if (i === undefined) return null;
      const flags = exact[ticker];
      if (!flags) return null;
      for (let j = i + 1; j < dates.length; j++) if (flags[j]) return dates[j];
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Simulating a trade ledger
// ---------------------------------------------------------------------------

interface Book {
  shares: number;
  /** Total cost of the shares currently held, used for average-cost accounting. */
  costBasis: number;
  realizedPnl: number;
}

/**
 * Replay a ledger day by day and produce the equity curve plus final positions.
 *
 * Cost basis uses the weighted-average method: a sell realises
 * `(price - avgCost) * qty` and reduces the basis proportionally. That is the
 * standard convention and, unlike FIFO lot tracking, it needs no lot history --
 * appropriate here because every buy is the same fixed dollar size.
 *
 * Trades that cannot be afforded (or shares that aren't held) are skipped
 * rather than allowed to go negative; the UI prevents these, and this is the
 * backstop that keeps the curve honest if it ever doesn't.
 */
export interface SimStats {
  buys: number;
  sells: number;
  holds: number;
  /** Buy signals dropped because there wasn't enough cash to fill them. */
  skippedBuys: number;
  /** Sell signals dropped because no shares were held. */
  skippedSells: number;
}

export function simulate(
  trades: Trade[],
  startingCash: number,
  lookup: PriceLookup,
  opts: { from?: string; to?: string } = {},
): { curve: EquityPoint[]; positions: Position[]; cash: number; stats: SimStats } {
  const from = opts.from ?? lookup.dates[0];
  const to = opts.to ?? lookup.dates[lookup.dates.length - 1];
  const window = lookup.dates.filter((d) => d >= from && d <= to);

  const byDate = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }

  const books: Record<string, Book> = {};
  const book = (ticker: string) =>
    (books[ticker] ??= { shares: 0, costBasis: 0, realizedPnl: 0 });

  let cash = startingCash;
  const curve: EquityPoint[] = [];
  const stats: SimStats = { buys: 0, sells: 0, holds: 0, skippedBuys: 0, skippedSells: 0 };

  for (const date of window) {
    for (const t of byDate.get(date) ?? []) {
      if (t.action === "hold" || t.quantity <= 0) {
        stats.holds += 1;
        continue;
      }
      const b = book(t.ticker);

      if (t.action === "buy") {
        const cost = t.price * t.quantity;
        if (cost > cash + 1e-9) {
          // Cash constraint binds. Counting these matters: a strategy whose
          // sells fund its later buys will fill far more orders than the same
          // buy signals run without selling, and comparing the two without
          // knowing the skip count invites a completely wrong conclusion.
          stats.skippedBuys += 1;
          continue;
        }
        cash -= cost;
        b.shares += t.quantity;
        b.costBasis += cost;
        stats.buys += 1;
      } else {
        const qty = Math.min(t.quantity, b.shares);
        if (qty <= 0) {
          stats.skippedSells += 1;
          continue;
        }
        stats.sells += 1;
        const avgCost = b.shares > 0 ? b.costBasis / b.shares : 0;
        cash += t.price * qty;
        b.realizedPnl += (t.price - avgCost) * qty;
        b.costBasis -= avgCost * qty;
        b.shares -= qty;
      }
    }

    let holdingsValue = 0;
    for (const ticker of Object.keys(books)) {
      const px = lookup.closeOn(ticker, date);
      if (px !== null) holdingsValue += books[ticker].shares * px;
    }
    curve.push({ date, cash, holdingsValue, totalValue: cash + holdingsValue });
  }

  const positions: Position[] = Object.entries(books)
    .map(([ticker, b]) => {
      const lastPrice = lookup.closeOn(ticker, to) ?? 0;
      const avgCost = b.shares > 0 ? b.costBasis / b.shares : 0;
      return {
        ticker,
        shares: b.shares,
        avgCost,
        lastPrice,
        marketValue: b.shares * lastPrice,
        unrealizedPnl: b.shares * (lastPrice - avgCost),
        realizedPnl: b.realizedPnl,
      };
    })
    .filter((p) => p.shares > 1e-9 || Math.abs(p.realizedPnl) > 1e-9)
    .sort((a, b) => b.marketValue - a.marketValue);

  return { curve, positions, cash, stats };
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

/**
 * BASELINE 1 (headline): equal-weight buy-and-hold.
 *
 * Split the entire starting balance evenly across all tracked assets on the
 * first sim day and never touch it again. This is the "just buy everything and
 * go outside" strategy the app is arguing against, and it is the number the
 * landing page quotes.
 */
export function equalWeightBuyAndHold(
  startingCash: number,
  lookup: PriceLookup,
  opts: { from?: string; to?: string } = {},
): EquityPoint[] {
  const from = opts.from ?? lookup.dates[0];
  const to = opts.to ?? lookup.dates[lookup.dates.length - 1];
  const window = lookup.dates.filter((d) => d >= from && d <= to);

  const investable = lookup.tickers.filter((t) => (lookup.closeOn(t, from) ?? 0) > 0);
  const perAsset = startingCash / investable.length;

  const shares: Record<string, number> = {};
  for (const t of investable) shares[t] = perAsset / lookup.closeOn(t, from)!;

  return window.map((date) => {
    let holdingsValue = 0;
    for (const t of investable) holdingsValue += shares[t] * (lookup.closeOn(t, date) ?? 0);
    return { date, cash: 0, holdingsValue, totalValue: holdingsValue };
  });
}

/**
 * BASELINE 2 (fairness control): cash-matched buy-and-hold.
 *
 * Why this exists: your portfolio starts as 100% cash and deploys gradually, so
 * measuring it against a fully-invested baseline conflates two different things
 * -- whether your TIMING was good, and whether you were simply more exposed to
 * a rising market. This baseline removes the second effect by making exactly
 * the same purchases on exactly the same days you did, then never selling.
 *
 * Beating baseline 1 can just mean "you were invested". Beating baseline 2
 * means your SELL decisions actually added value, which is the real claim the
 * app is making.
 */
export function cashMatchedBuyAndHold(
  trades: Trade[],
  startingCash: number,
  lookup: PriceLookup,
  opts: { from?: string; to?: string } = {},
): EquityPoint[] {
  const buysOnly = trades.filter((t) => t.action === "buy");
  return simulate(buysOnly, startingCash, lookup, opts).curve;
}

// ---------------------------------------------------------------------------
// Summary stats
// ---------------------------------------------------------------------------

export interface PerformanceSummary {
  startValue: number;
  endValue: number;
  totalReturnPct: number;
  /** Largest peak-to-trough decline over the window, as a positive percent. */
  maxDrawdownPct: number;
  /** Annualised stdev of daily returns, as a percent. */
  volatilityPct: number;
  /** Return per unit of volatility. Risk-free rate assumed 0 for a class demo. */
  sharpe: number;
}

export function summarize(curve: EquityPoint[]): PerformanceSummary {
  if (curve.length === 0) {
    return { startValue: 0, endValue: 0, totalReturnPct: 0, maxDrawdownPct: 0, volatilityPct: 0, sharpe: 0 };
  }

  const startValue = curve[0].totalValue;
  const endValue = curve[curve.length - 1].totalValue;
  const totalReturnPct = startValue > 0 ? ((endValue - startValue) / startValue) * 100 : 0;

  let peak = curve[0].totalValue;
  let maxDrawdownPct = 0;
  const dailyReturns: number[] = [];

  for (let i = 0; i < curve.length; i++) {
    const v = curve[i].totalValue;
    if (v > peak) peak = v;
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - v) / peak) * 100);
    if (i > 0) {
      const prev = curve[i - 1].totalValue;
      if (prev > 0) dailyReturns.push((v - prev) / prev);
    }
  }

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / (dailyReturns.length || 1);
  const variance =
    dailyReturns.reduce((a, r) => a + (r - mean) ** 2, 0) / (dailyReturns.length > 1 ? dailyReturns.length - 1 : 1);
  const dailyStdev = Math.sqrt(variance);

  // 252 trading days is the standard annualisation factor. The sim clock also
  // contains weekend crypto bars, but using the conventional constant keeps the
  // number comparable to figures quoted anywhere else.
  const volatilityPct = dailyStdev * Math.sqrt(252) * 100;
  const sharpe = dailyStdev > 0 ? (mean / dailyStdev) * Math.sqrt(252) : 0;

  return { startValue, endValue, totalReturnPct, maxDrawdownPct, volatilityPct, sharpe };
}
