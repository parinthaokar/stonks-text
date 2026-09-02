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
import { BET_SIZE } from "@/lib/config";
import type { TradeAction } from "@/lib/data/types";

export interface TradeResult {
  ok: boolean;
  message: string;
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
): Promise<TradeResult> {
  const data = await loadAppData();
  const asset = data.assetById.get(assetId);
  if (!asset) return { ok: false, message: "Unknown asset." };

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
    if (cash < BET_SIZE) {
      return { ok: false, message: `Not enough cash — you have ${cash.toFixed(2)} left.` };
    }
    const quantity = BET_SIZE / price;
    await source.addTrade({
      assetId, messageId, action: "buy", price, quantity, notional: BET_SIZE, tradeDate: today,
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Bought $${BET_SIZE} of ${asset.ticker} at $${price.toFixed(2)}.` };
  }

  const held = positions.find((p) => p.ticker === asset.ticker)?.shares ?? 0;
  if (held <= 1e-9) return { ok: false, message: `You don't own any ${asset.ticker}.` };

  // Sell a fixed dollar amount, or the whole position if it's worth less.
  const quantity = Math.min(BET_SIZE / price, held);
  const notional = quantity * price;
  await source.addTrade({
    assetId, messageId, action: "sell", price, quantity, notional, tradeDate: today,
  });
  revalidatePath("/", "layout");
  return { ok: true, message: `Sold $${notional.toFixed(0)} of ${asset.ticker} at $${price.toFixed(2)}.` };
}

/**
 * Move the clock forward.
 *
 * "next-message" skips straight to the next day anything actually texts you,
 * which is how you play through a year without clicking through 200 silent
 * weekends. "next-day" steps one calendar day for fine control.
 */
export async function advanceSim(mode: "next-day" | "next-message"): Promise<TradeResult> {
  const data = await loadAppData();
  const next = mode === "next-message" ? nextMessageDate(data) : nextSimDate(data);

  if (!next) return { ok: false, message: "You've reached the end of the dataset." };

  await getDataSource().setSimState({ simDate: next });
  revalidatePath("/", "layout");
  return { ok: true, message: `Advanced to ${next}.` };
}

/** Wipe the ledger and send the clock back to the start of the window. */
export async function resetSim(): Promise<TradeResult> {
  await getDataSource().resetSim();
  revalidatePath("/", "layout");
  return { ok: true, message: "Sim reset." };
}
