/**
 * Server-side view-model layer.
 *
 * Loads everything once per request and derives the shapes the pages actually
 * render. Pages stay declarative; all the joining, the calendar handling and
 * the P&L arithmetic happen here where it can be commented and tested.
 */
import { cache } from "react";
import { getDataSource, type Asset, type Message, type PriceBar, type SimState, type TradeRow } from "./data";
import { buildPriceLookup, simulate, equalWeightBuyAndHold, type PriceLookup, type Trade } from "./portfolio";
import { BIG_MOVER_PRIORITY, SIM_WINDOW_DAYS } from "./config";

export interface AppData {
  assets: Asset[];
  assetById: Map<number, Asset>;
  assetByTicker: Map<string, Asset>;
  prices: Record<string, PriceBar[]>;
  messages: Message[];
  trades: TradeRow[];
  sim: SimState;
  lookup: PriceLookup;
  /** First and last day of the playable window. */
  windowStart: string;
  windowEnd: string;
  /** Every sim day in the window, ascending. */
  simDates: string[];
  sourceKind: "supabase" | "local";
}

/**
 * `cache` dedupes this across all the server components in one render, so a
 * page with a sidebar, a header and three cards still only hits the database
 * once.
 */
export const loadAppData = cache(async (): Promise<AppData> => {
  const source = getDataSource();
  const [assets, prices, messages, trades, sim] = await Promise.all([
    source.getAssets(),
    source.getPrices(),
    source.getMessages(),
    source.getTrades(),
    source.getSimState(),
  ]);

  const lookup = buildPriceLookup(prices);
  const windowEnd = lookup.dates[lookup.dates.length - 1];

  const start = new Date(`${windowEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - SIM_WINDOW_DAYS);
  const windowStart = start.toISOString().slice(0, 10);

  return {
    assets,
    assetById: new Map(assets.map((a) => [a.id, a])),
    assetByTicker: new Map(assets.map((a) => [a.ticker, a])),
    prices,
    messages,
    trades,
    sim,
    lookup,
    windowStart,
    windowEnd,
    simDates: lookup.dates.filter((d) => d >= windowStart && d <= windowEnd),
    sourceKind: source.kind,
  };
});

// ---------------------------------------------------------------------------
// Conversation list (sidebar)
// ---------------------------------------------------------------------------

export interface Conversation {
  asset: Asset;
  lastMessage: Message | null;
  /**
   * 1 when this asset's NEWEST text is a big mover you haven't replied to.
   *
   * Deliberately not "every unanswered big mover ever": under a fixed budget a
   * played-through year leaves hundreds of signals unfilled because the cash ran
   * out, and counting those produced a meaningless badge reading 301. Unread
   * here means what it means in a messaging app -- there is something new at the
   * bottom of this thread that you have not dealt with.
   */
  unread: number;
  price: number | null;
  dayChangePct: number;
  /** False on days this asset didn't trade (stocks at the weekend). */
  tradeable: boolean;
}

/**
 * Everything the sidebar needs, as of the current sim date.
 *
 * "Unread" means a big mover (priority >= 4) that has arrived on or before
 * today and that you never replied to. Replying is what clears it, which is why
 * `trades.message_id` exists -- it links a tap back to the text that prompted it.
 */
export function conversations(data: AppData): Conversation[] {
  const today = data.sim.simDate;
  const answered = new Set(data.trades.map((t) => t.messageId).filter((id): id is number => id !== null));

  return data.assets
    .map((asset) => {
      const mine = data.messages.filter((m) => m.assetId === asset.id && m.date <= today);
      const lastMessage = mine.length > 0 ? mine[mine.length - 1] : null;
      const unread =
        lastMessage && lastMessage.priority >= BIG_MOVER_PRIORITY && !answered.has(lastMessage.id) ? 1 : 0;

      const price = data.lookup.closeOn(asset.ticker, today);
      const bars = data.prices[asset.ticker] ?? [];
      const idx = bars.findLastIndex((b) => b.date <= today);
      const dayChangePct =
        idx > 0 && bars[idx - 1].close > 0
          ? ((bars[idx].close - bars[idx - 1].close) / bars[idx - 1].close) * 100
          : 0;

      return {
        asset, lastMessage, unread, price, dayChangePct,
        tradeable: data.lookup.isTradeable(asset.ticker, today),
      };
    })
    // Loudest first: unread big movers, then whoever spoke most recently.
    .sort((a, b) => {
      if (a.unread !== b.unread) return b.unread - a.unread;
      const ad = a.lastMessage?.date ?? "";
      const bd = b.lastMessage?.date ?? "";
      return bd.localeCompare(ad);
    });
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

/** The trade ledger in the shape the backtest module expects. */
export function ledger(data: AppData): Trade[] {
  return data.trades.map((t) => ({
    ticker: t.ticker, action: t.action, quantity: t.quantity, price: t.price, date: t.tradeDate,
  }));
}

export interface PortfolioView {
  cash: number;
  holdingsValue: number;
  totalValue: number;
  startingCash: number;
  totalPnl: number;
  totalPnlPct: number;
  /** Equal-weight buy-and-hold over the same window, for the comparison. */
  benchmarkValue: number;
  benchmarkPnlPct: number;
  edgePct: number;
  positions: ReturnType<typeof simulate>["positions"];
  curve: ReturnType<typeof simulate>["curve"];
  benchmarkCurve: ReturnType<typeof equalWeightBuyAndHold>;
}

/**
 * Value the portfolio as of the sim date.
 *
 * Both the user's curve and the benchmark are cut off at the sim date, not at
 * the end of the dataset -- otherwise the comparison would quietly credit the
 * benchmark with returns from days the player hasn't reached yet.
 */
export function portfolio(data: AppData): PortfolioView {
  const from = data.windowStart;
  const to = data.sim.simDate;

  const { curve, positions } = simulate(ledger(data), data.sim.startingCash, data.lookup, { from, to });
  const benchmarkCurve = equalWeightBuyAndHold(data.sim.startingCash, data.lookup, { from, to });

  const last = curve[curve.length - 1];
  const holdingsValue = last?.holdingsValue ?? 0;
  const cash = last?.cash ?? data.sim.startingCash;
  const totalValue = cash + holdingsValue;

  const benchmarkValue = benchmarkCurve[benchmarkCurve.length - 1]?.totalValue ?? data.sim.startingCash;
  const totalPnl = totalValue - data.sim.startingCash;
  const totalPnlPct = (totalPnl / data.sim.startingCash) * 100;
  const benchmarkPnlPct = ((benchmarkValue - data.sim.startingCash) / data.sim.startingCash) * 100;

  return {
    cash, holdingsValue, totalValue,
    startingCash: data.sim.startingCash,
    totalPnl, totalPnlPct,
    benchmarkValue, benchmarkPnlPct,
    edgePct: totalPnlPct - benchmarkPnlPct,
    positions, curve, benchmarkCurve,
  };
}

// ---------------------------------------------------------------------------
// Sim clock
// ---------------------------------------------------------------------------

/** The next sim day on which any asset sends a message. Null at the end. */
export function nextMessageDate(data: AppData): string | null {
  const today = data.sim.simDate;
  const future = data.messages.filter((m) => m.date > today).map((m) => m.date).sort();
  return future[0] ?? null;
}

/** The next calendar day in the dataset. Null at the end of the window. */
export function nextSimDate(data: AppData): string | null {
  const i = data.simDates.indexOf(data.sim.simDate);
  if (i === -1) return data.simDates.find((d) => d > data.sim.simDate) ?? null;
  return data.simDates[i + 1] ?? null;
}
