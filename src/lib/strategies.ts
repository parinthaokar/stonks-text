/**
 * REFERENCE STRATEGIES
 *
 * The app's central question is "does reacting to the texts beat buy-and-hold?"
 * To answer it we need a definition of "reacting" that doesn't depend on a
 * human clicking 900 buttons. These are two mechanical strategies that read the
 * same messages a user would and reply automatically.
 *
 * They are used for the landing-page headline stat and as the dashed comparison
 * lines on the Data tab -- the user's own curve is plotted against them.
 *
 * Both are deterministic functions of the message stream, so the quoted numbers
 * are reproducible from a fresh clone.
 */

import { stableHash, type GeneratedMessage, type Tone } from "./messages/rules";
import type { PriceLookup, Trade, TradeAction } from "./portfolio";
import { BET_SIZE } from "./config";

export type StrategyId = "reactive" | "contrarian" | "coinflip" | "model";

/**
 * REACTIVE ("do what the text makes you feel").
 *
 * The asset is panicking, so you panic. The asset is euphoric, so you pile in.
 * This is the emotional reading of the thread -- buy strength, sell weakness --
 * and it is the behaviour the chat UI is designed to provoke.
 */
const REACTIVE: Record<Tone, TradeAction> = {
  euphoric: "buy",     // new 52-week high -> it's unstoppable, get in
  manic: "buy",        // +5% day -> FOMO
  smug: "buy",         // winning streak -> momentum
  anxious: "sell",     // -5% day -> get out
  desperate: "sell",   // losing streak -> cut losses
  despondent: "sell",  // 52-week low -> capitulate
  attention: "hold",   // volume spike with no direction -> no signal
  casual: "hold",      // nothing happened
};

/**
 * CONTRARIAN ("do the opposite of the feeling").
 *
 * The same messages, inverted: buy the panic, sell the euphoria. Included as
 * the control that makes the reactive result meaningful -- if both strategies
 * lose to buy-and-hold, the lesson is about trading frequency; if only one
 * does, the lesson is about direction.
 */
const CONTRARIAN: Record<Tone, TradeAction> = {
  euphoric: "sell",
  manic: "sell",
  smug: "hold",
  anxious: "buy",
  desperate: "buy",
  despondent: "buy",
  attention: "hold",
  casual: "hold",
};

export const STRATEGY_META: Record<StrategyId, { label: string; description: string }> = {
  reactive: {
    label: "Reactive",
    description: "Buys hype, sells panic — the emotional reply to every text.",
  },
  contrarian: {
    label: "Contrarian",
    description: "Buys panic, sells hype — the same texts, read backwards.",
  },
  coinflip: {
    label: "Coin flip",
    description: "Ignores what the text says and trades at random on the same days.",
  },
  model: {
    label: "Model",
    description: "A trained classifier's suggested action, from the deployed pipeline.",
  },
};

/**
 * COIN FLIP (null hypothesis).
 *
 * Trades on exactly the same days as the other strategies but picks the action
 * without looking at the message. This is the control that decides what the
 * headline number actually means: if reacting to the texts only matches this,
 * then any edge came from being active in a rising market, not from the rules
 * engine. Seeded from a stable hash so the "random" run is reproducible.
 */
function coinflipAction(ticker: string, date: string): TradeAction {
  const roll = stableHash(`${ticker}|${date}|coinflip`) % 3;
  return roll === 0 ? "buy" : roll === 1 ? "sell" : "hold";
}

/**
 * MODEL.
 *
 * Reads the predictions exported by ml/build_pipeline.py -- the same fitted
 * pipeline the API serves, evaluated once per day offline. Rendering this curve
 * from live HTTP calls would mean ~900 requests per chart load.
 *
 * Days the model never scored (its features need a 50-day warm-up the message
 * stream does not) fall back to "hold", which is the honest reading of "no
 * opinion" and costs nothing in the ledger.
 */
let modelPredictions: Record<string, string> | null = null;

export function loadModelPredictions(predictions: Record<string, string>) {
  modelPredictions = predictions;
}

function modelAction(ticker: string, date: string): TradeAction {
  const p = modelPredictions?.[`${ticker}|${date}`];
  return p === "buy" || p === "sell" ? p : "hold";
}

/** Which way a given tone tells you to trade under a strategy. */
export function actionFor(strategy: StrategyId, tone: Tone, ticker = "", date = ""): TradeAction {
  if (strategy === "coinflip") return coinflipAction(ticker, date);
  if (strategy === "model") return modelAction(ticker, date);
  return (strategy === "reactive" ? REACTIVE : CONTRARIAN)[tone];
}

/**
 * Turn a message stream into a trade ledger.
 *
 * Sizing matches the app exactly: every tap is a fixed BET_SIZE of notional, so
 * the strategies are directly comparable to what a user can actually do with
 * the three buttons. Sells are capped at the shares actually held, which is
 * tracked here so the ledger never contains an impossible trade.
 */
export interface RunOptions {
  /**
   * EXECUTION LAG. A message is produced by a day's CLOSING price, so acting on
   * that same close assumes you knew where the day would finish before it did.
   * With `nextOpen: true` the order instead fills at the next session the asset
   * actually trades, which is what a person tapping a button that evening could
   * really achieve. Defaults to true because the looser assumption flatters the
   * results and this app makes a performance claim.
   */
  nextSession?: boolean;
}

export function runStrategy(
  strategy: StrategyId,
  messages: GeneratedMessage[],
  lookup: PriceLookup,
  options: RunOptions = {},
): Trade[] {
  const nextSession = options.nextSession ?? true;
  const trades: Trade[] = [];
  const held: Record<string, number> = {};

  // Chronological order matters: share counts accumulate as we go.
  const ordered = [...messages].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const m of ordered) {
    const action = actionFor(strategy, m.tone, m.ticker, m.date);

    // Decide from the message's day, but fill on the day you could actually act.
    const fillDate = nextSession ? lookup.nextTradeableDate(m.ticker, m.date) : m.date;
    if (fillDate === null) continue; // message landed on the last bar; nothing to fill against
    const price = lookup.closeOn(m.ticker, fillDate);
    if (price === null || price <= 0) continue;

    if (action === "hold") {
      // Logged with zero quantity so "how often did doing nothing win?" stays
      // an answerable question rather than an absence of data.
      trades.push({ ticker: m.ticker, action: "hold", quantity: 0, price, date: fillDate, messageDate: m.date });
      continue;
    }

    if (action === "buy") {
      const qty = BET_SIZE / price;
      held[m.ticker] = (held[m.ticker] ?? 0) + qty;
      trades.push({ ticker: m.ticker, action: "buy", quantity: qty, price, date: fillDate, messageDate: m.date });
    } else {
      // Sell a fixed dollar amount, or everything left if that's less.
      const qty = Math.min(BET_SIZE / price, held[m.ticker] ?? 0);
      if (qty <= 1e-9) continue;
      held[m.ticker] = (held[m.ticker] ?? 0) - qty;
      trades.push({ ticker: m.ticker, action: "sell", quantity: qty, price, date: fillDate, messageDate: m.date });
    }
  }

  return trades;
}
