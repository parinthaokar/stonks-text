"use server";

/**
 * Server actions: the only paths that write anything.
 *
 * All validation happens here rather than in the client components, because a
 * disabled button is a hint, not a guarantee. Every action re-derives the
 * current holdings and cash from the ledger before it writes.
 */
import { revalidatePath } from "next/cache";
import { getDataSource } from "@/lib/data";
import { loadAppData, ledger, nextMessageDate, nextSimDate } from "@/lib/app-data";
import { simulate } from "@/lib/portfolio";
import { BET_SIZE, BIG_MOVER_PRIORITY, parseTradeSize, type TradeSize } from "@/lib/config";
import type { TradeAction } from "@/lib/data/types";

export interface TradeResult {
  ok: boolean;
  message: string;
}

export interface AdvanceResult extends TradeResult {
  /** The sim date after advancing. */
  date?: string;
  /**
   * Set when auto-play should stop here. Auto-advancing straight past a -7%
   * crash without giving you a chance to reply would make the clock the thing
   * playing the game instead of you.
   */
  pauseReason?: string;
  /** True once there is nothing left to advance to. */
  atEnd?: boolean;
}

/**
 * Reply to a text with sell / hold / buy.
 *
 * Sizing is a fixed BET_SIZE of notional per tap, matching the strategies in
 * the backtest so the user's curve is directly comparable to them. Fills use
 * the sim date's close for the asset in question.
 */
export async function placeTrade(
  assetId: number,
  messageId: number | null,
  action: TradeAction,
  requestedSize: TradeSize | string | number = BET_SIZE,
): Promise<TradeResult> {
  const data = await loadAppData();
  const asset = data.assetById.get(assetId);
  if (!asset) return { ok: false, message: "Unknown asset." };

  // A disabled button is a hint, not a guarantee. Sizes are checked against a
  // fixed allowlist rather than accepted as a number, so a crafted call can't
  // open a $10,000,000 position.
  const size = parseTradeSize(requestedSize);
  if (size === null) return { ok: false, message: "Invalid trade size." };

  const today = data.sim.simDate;
  const price = data.lookup.closeOn(asset.ticker, today);
  if (price === null || price <= 0) return { ok: false, message: `No price for ${asset.ticker} yet.` };

  const source = getDataSource();

  // A 'hold' is a real, logged decision -- it costs nothing and it is what makes
  // "how often did doing nothing win?" answerable on the Data tab.
  if (action === "hold") {
    await source.addTrade({
      assetId, messageId, action: "hold", price, quantity: 0, notional: 0, tradeDate: today,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Held ${asset.ticker}.` };
  }

  // Re-derive positions from the ledger; never trust a number from the client.
  const { positions, cash } = simulate(ledger(data), data.sim.startingCash, data.lookup, {
    from: data.windowStart, to: today,
  });

  if (action === "buy") {
    // "max" deploys everything left; a preset spends exactly that much.
    const notional = size === "max" ? cash : size;

    if (notional < 1) {
      return { ok: false, message: `Not enough cash — you have $${cash.toFixed(2)} left.` };
    }
    if (notional > cash + 1e-9) {
      return {
        ok: false,
        message: `Not enough cash for a $${notional} buy — you have $${cash.toFixed(2)}.`,
      };
    }

    const quantity = notional / price;
    await source.addTrade({
      assetId, messageId, action: "buy", price, quantity, notional, tradeDate: today,
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Bought $${notional.toFixed(0)} of ${asset.ticker} at $${price.toFixed(2)}.`,
    };
  }

  const held = positions.find((p) => p.ticker === asset.ticker)?.shares ?? 0;
  if (held <= 1e-9) return { ok: false, message: `You don't own any ${asset.ticker}.` };

  // Sell the requested dollar amount, or the whole position if it's worth less
  // -- so a $1,000 tap on a $300 position closes it rather than failing.
  const quantity = size === "max" ? held : Math.min(size / price, held);
  const notional = quantity * price;
  const closed = quantity >= held - 1e-9;

  await source.addTrade({
    assetId, messageId, action: "sell", price, quantity, notional, tradeDate: today,
  });
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: closed
      ? `Closed ${asset.ticker} — sold $${notional.toFixed(0)} at $${price.toFixed(2)}.`
      : `Sold $${notional.toFixed(0)} of ${asset.ticker} at $${price.toFixed(2)}.`,
  };
}

/**
 * Move the clock forward.
 *
 * "next-message" skips straight to the next day anything actually texts you,
 * which is how you play through a year without clicking through 200 silent
 * weekends. "next-day" steps one calendar day for fine control.
 */
export async function advanceSim(mode: "next-day" | "next-message"): Promise<AdvanceResult> {
  const data = await loadAppData();
  const next = mode === "next-message" ? nextMessageDate(data) : nextSimDate(data);

  if (!next) {
    return { ok: false, message: "You've reached the end of the dataset.", atEnd: true };
  }

  await getDataSource().setSimState({ simDate: next });
  revalidatePath("/", "layout");

  // Anything landing on the new date is unanswered by definition -- you haven't
  // had the chance yet. Read from the pre-advance snapshot rather than
  // refetching: loadAppData is request-cached, so a second call here would
  // return the same stale state anyway.
  const bigMovers = data.messages.filter(
    (m) => m.date === next && m.priority >= BIG_MOVER_PRIORITY,
  );

  let pauseReason: string | undefined;
  if (bigMovers.length > 0) {
    const tickers = [...new Set(bigMovers.map((m) => data.assetById.get(m.assetId)?.ticker ?? ""))]
      .filter(Boolean);
    pauseReason =
      tickers.length === 1
        ? `${tickers[0]} needs an answer.`
        : `${tickers.slice(0, 3).join(", ")} need an answer.`;
  }

  const hasMore = nextMessageDate({ ...data, sim: { ...data.sim, simDate: next } }) !== null;

  return {
    ok: true,
    message: `Advanced to ${next}.`,
    date: next,
    pauseReason,
    atEnd: !hasMore,
  };
}

/** Wipe the ledger and send the clock back to the start of the window. */
export async function resetSim(): Promise<TradeResult> {
  await getDataSource().resetSim();
  revalidatePath("/", "layout");
  return { ok: true, message: "Sim reset." };
}
