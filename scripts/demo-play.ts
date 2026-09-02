/**
 * Auto-plays the sim so there is something to look at.
 *
 *   npm run demo              play the Reactive strategy to the end of the data
 *   npm run demo -- 2026-03-01   ...or up to a given sim date
 *   npm run demo -- --clear   wipe trades and rewind to the start
 *
 * Useful for a live demo: rather than tapping through a year of texts on stage,
 * this replies to every message the way the Reactive strategy would, then parks
 * the clock at the end so the Portfolio and Data tabs are fully populated.
 *
 * Writes through the same DataSource the app uses, so it works against either
 * Supabase or the local file store.
 */
import { config } from "dotenv";
import { getDataSource } from "../src/lib/data";
import { generateMessages, type Bar } from "../src/lib/messages/rules";
import { buildPriceLookup, simulate } from "../src/lib/portfolio";
import { runStrategy } from "../src/lib/strategies";
import { SIM_WINDOW_DAYS } from "../src/lib/config";

config({ path: ".env.local" });

async function main() {
  const source = getDataSource();
  console.log(`data source: ${source.kind}`);

  if (process.argv.includes("--clear")) {
    await source.resetSim();
    console.log("cleared trades and rewound the clock.");
    return;
  }

  const [assets, prices] = await Promise.all([source.getAssets(), source.getPrices()]);
  const lookup = buildPriceLookup(prices);
  const windowEnd = lookup.dates[lookup.dates.length - 1];

  const start = new Date(`${windowEnd}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - SIM_WINDOW_DAYS);
  const windowStart = start.toISOString().slice(0, 10);

  const until = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? windowEnd;

  // Start from a clean ledger so replaying is idempotent.
  await source.resetSim();
  const state = await source.getSimState();

  const bars: Record<string, Bar[]> = {};
  for (const a of assets) bars[a.ticker] = prices[a.ticker];
  const messages = assets
    .flatMap((a) => generateMessages(a.ticker, bars[a.ticker], { from: windowStart }))
    .filter((m) => m.date <= until);

  const idByTicker = new Map(assets.map((a) => [a.ticker, a.id]));

  // Link each trade back to the message that prompted it. Without this the
  // sidebar's unread count treats every auto-played big mover as unanswered and
  // shows a nonsense number like "301".
  const stored = await source.getMessages();
  const messageIdAt = new Map(stored.map((m) => [`${m.assetId}|${m.date}`, m.id]));
  const trades = runStrategy("reactive", messages, lookup).filter((t) => t.date <= until);

  // Replay through the same accounting the app uses, so orders that couldn't
  // have been afforded are dropped here too rather than silently overdrawing.
  const { stats } = simulate(trades, state.startingCash, lookup, { from: windowStart, to: until });
  console.log(`messages: ${messages.length}   fillable trades: ${stats.buys + stats.sells}`);

  let cash = state.startingCash;
  const held: Record<string, number> = {};
  let written = 0;

  for (const t of trades) {
    const assetId = idByTicker.get(t.ticker);
    if (assetId === undefined) continue;

    if (t.action === "hold") continue; // skipped: 400+ no-op rows add nothing to a demo

    if (t.action === "buy") {
      const notional = t.price * t.quantity;
      if (notional > cash + 1e-9) continue;
      cash -= notional;
      held[t.ticker] = (held[t.ticker] ?? 0) + t.quantity;
      await source.addTrade({ assetId, messageId: messageIdAt.get(`${assetId}|${t.messageDate ?? t.date}`) ?? null, action: "buy", price: t.price, quantity: t.quantity, notional, tradeDate: t.date });
    } else {
      const qty = Math.min(t.quantity, held[t.ticker] ?? 0);
      if (qty <= 1e-9) continue;
      const notional = qty * t.price;
      cash += notional;
      held[t.ticker] = (held[t.ticker] ?? 0) - qty;
      await source.addTrade({ assetId, messageId: messageIdAt.get(`${assetId}|${t.messageDate ?? t.date}`) ?? null, action: "sell", price: t.price, quantity: qty, notional, tradeDate: t.date });
    }
    written += 1;
  }

  await source.setSimState({ simDate: until, cash });
  console.log(`wrote ${written} trades; clock parked at ${until} with $${cash.toFixed(2)} cash.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
