/** App-wide constants shared by the seed script, the sim, and the UI. */

/** Fake money the demo user starts with. */
export const STARTING_CASH = 10_000;

/** Every tap of "buy more" / "sell it" trades this many dollars' worth. */
export const BET_SIZE = 500;

/**
 * How much of the dataset is playable. The fetcher pulls 2 years; the most
 * recent SIM_WINDOW_DAYS are the sim, and everything before that exists only
 * as lookback so 52-week highs/lows are defined on day one of the sim.
 */
export const SIM_WINDOW_DAYS = 365;

/** Priority at or above which an asset shows an unread dot in the sidebar. */
export const BIG_MOVER_PRIORITY = 4;
