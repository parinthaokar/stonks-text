/** App-wide constants shared by the seed script, the sim, and the UI. */

/** Fake money the demo user starts with. */
export const STARTING_CASH = 10_000;

/**
 * Default trade size, and the size the REFERENCE STRATEGIES always use.
 *
 * Keep this fixed even though the UI lets a player pick a size. The Reactive /
 * Contrarian / Coin-flip curves on the Data tab are only comparable to each
 * other because every one of them bets the same amount every time; making the
 * benchmarks variable would turn a strategy comparison into a position-sizing
 * comparison, which is a different experiment.
 */
export const BET_SIZE = 500;

/** Sizes offered in the reply bar. "max" means all cash / the whole position. */
export const TRADE_SIZES = [250, 500, 1000] as const;

export type TradeSize = (typeof TRADE_SIZES)[number] | "max";

/** Cookie the reply bar uses to remember the last size across navigations. */
export const TRADE_SIZE_COOKIE = "st-trade-size";

/** Server-side allowlist. Never trust a size that arrives from the client. */
export function parseTradeSize(raw: unknown): TradeSize | null {
  if (raw === "max") return "max";
  const n = typeof raw === "string" ? Number(raw) : raw;
  return TRADE_SIZES.includes(n as never) ? (n as TradeSize) : null;
}

/**
 * How much of the dataset is playable. The fetcher pulls 2 years; the most
 * recent SIM_WINDOW_DAYS are the sim, and everything before that exists only
 * as lookback so 52-week highs/lows are defined on day one of the sim.
 */
export const SIM_WINDOW_DAYS = 365;

/** Priority at or above which an asset shows an unread dot in the sidebar. */
export const BIG_MOVER_PRIORITY = 4;
