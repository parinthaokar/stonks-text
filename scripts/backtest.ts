/**
 * Runs the full backtest against the real fetched data, with no database
 * involved. This is what produces the numbers quoted on the landing page.
 *
 *   npm run backtest
 *
 * READING THE TABLE
 * -----------------
 * "filled" vs "signals" is the important column pair. Every strategy wants to
 * trade $500 per signal, but the account only has $10,000. A strategy that
 * sells frequently keeps recycling cash and therefore fills far more of its
 * buy signals than one that never sells. Comparing two strategies without
 * that number visible is how you conclude something completely wrong.
 *
 * The Coin flip row is the null hypothesis: it trades on the same days but
 * ignores what the message actually said. If Reactive doesn't clear it, the
 * rules engine isn't adding anything.
 */
import { generateMessages, type Bar } from "../src/lib/messages/rules";
import { SIM_WINDOW_DAYS, STARTING_CASH, BET_SIZE } from "../src/lib/config";
import {
  buildPriceLookup, simulate, equalWeightBuyAndHold, summarize,
  type EquityPoint, type SimStats,
} from "../src/lib/portfolio";
import { runStrategy, STRATEGY_META, type StrategyId } from "../src/lib/strategies";
import { loadBars, loadManifest, simStartDate } from "./lib/prices";
import { writeFileSync } from "node:fs";

// Same-close fills assume you knew the closing price before the close. The
// honest default is to fill on the next session the asset actually trades.
const SAME_CLOSE = process.argv.includes("--same-close");

const manifest = loadManifest();
const from = simStartDate(manifest.as_of, SIM_WINDOW_DAYS);
const to = manifest.as_of;

const barsByTicker: Record<string, Bar[]> = {};
for (const a of manifest.assets) barsByTicker[a.ticker] = loadBars(a);

const lookup = buildPriceLookup(barsByTicker);
const messages = manifest.assets.flatMap((a) => generateMessages(a.ticker, barsByTicker[a.ticker], { from }));

console.log(`window        : ${from} -> ${to}  (${lookup.dates.filter(d => d >= from && d <= to).length} sim days)`);
console.log(`assets        : ${manifest.assets.length}`);
console.log(`messages      : ${messages.length}`);
console.log(`starting cash : $${STARTING_CASH.toLocaleString()}   bet size: $${BET_SIZE}`);
console.log(`execution     : ${SAME_CLOSE ? "same close (optimistic)" : "next session the asset trades (conservative)"}\n`);

interface Row { name: string; curve: EquityPoint[]; stats?: SimStats; signals?: number }
const rows: Row[] = [];

const bh = equalWeightBuyAndHold(STARTING_CASH, lookup, { from, to });
rows.push({ name: "Buy & hold (equal weight)", curve: bh });

for (const id of ["reactive", "contrarian", "coinflip"] as StrategyId[]) {
  const trades = runStrategy(id, messages, lookup, { nextSession: !SAME_CLOSE });
  const signals = trades.filter((t) => t.action !== "hold").length;
  const { curve, stats } = simulate(trades, STARTING_CASH, lookup, { from, to });
  rows.push({ name: STRATEGY_META[id].label, curve, stats, signals });
}

// Reported separately rather than as a table row, because under a fixed $10k
// budget this variant is degenerate: it fills roughly 20 of its ~300 buy
// signals and then sits in a frozen portfolio for the rest of the year. That
// is not a "never sells" control, it is "bought 20 things in week one". The
// useful thing it does tell us is printed in the notes at the bottom.
const reactiveTrades = runStrategy("reactive", messages, lookup, { nextSession: !SAME_CLOSE });
const buysOnly = simulate(reactiveTrades.filter((t) => t.action === "buy"), STARTING_CASH, lookup, { from, to });

const w = [30, 11, 9, 9, 8, 8, 9, 9];
const head = ["strategy", "end value", "return", "max DD", "vol", "sharpe", "filled", "signals"];
console.log(head.map((h, i) => h.padEnd(w[i])).join(""));
console.log("-".repeat(w.reduce((a, b) => a + b, 0)));

for (const r of rows) {
  const s = summarize(r.curve);
  const filled = r.stats ? r.stats.buys + r.stats.sells : 12;
  console.log([
    r.name.padEnd(w[0]),
    `$${s.endValue.toFixed(0)}`.padEnd(w[1]),
    `${s.totalReturnPct >= 0 ? "+" : ""}${s.totalReturnPct.toFixed(1)}%`.padEnd(w[2]),
    `${s.maxDrawdownPct.toFixed(1)}%`.padEnd(w[3]),
    `${s.volatilityPct.toFixed(1)}%`.padEnd(w[4]),
    s.sharpe.toFixed(2).padEnd(w[5]),
    String(filled).padEnd(w[6]),
    String(r.signals ?? 12).padEnd(w[7]),
  ].join(""));
}

console.log("\ncash constraint (orders that never filled):");
for (const r of rows) {
  if (!r.stats) continue;
  console.log(`  ${r.name.padEnd(16)} skipped ${String(r.stats.skippedBuys).padStart(4)} buys, ${String(r.stats.skippedSells).padStart(4)} sells`);
}

const summaries = Object.fromEntries(rows.map((r) => [r.name, summarize(r.curve)]));
const bhRet = summaries["Buy & hold (equal weight)"].totalReturnPct;
const coin = summaries["Coin flip"].totalReturnPct;
const reactive = summaries["Reactive"].totalReturnPct;

console.log("\nnotes:");
console.log(`  Selling is what funds the strategy. The same buy signals with no`);
console.log(`  sells fill only ${buysOnly.stats.buys} of ${reactiveTrades.filter((t) => t.action === "buy").length} orders before the cash runs out,`);
console.log(`  ending at ${summarize(buysOnly.curve).totalReturnPct.toFixed(1)}% -- the account freezes in week one.`);

console.log("\nverdict:");
console.log(`  buy & hold                    ${bhRet >= 0 ? "+" : ""}${bhRet.toFixed(1)}%`);
console.log(`  coin flip (null hypothesis)   ${coin >= 0 ? "+" : ""}${coin.toFixed(1)}%`);
console.log(`  reactive (follows the texts)  ${reactive >= 0 ? "+" : ""}${reactive.toFixed(1)}%`);
console.log(`\n  vs buy & hold : ${reactive - bhRet >= 0 ? "+" : ""}${(reactive - bhRet).toFixed(1)} pts`);
console.log(`  vs coin flip  : ${reactive - coin >= 0 ? "+" : ""}${(reactive - coin).toFixed(1)} pts  <- is the rules engine adding anything?`);

// The landing page quotes these. Writing them to disk means the marketing copy
// is generated from the backtest rather than typed in by hand and left to rot.
if (!SAME_CLOSE) {
  const out = {
    generated_at: new Date().toISOString().slice(0, 10),
    window: { from, to },
    assets: manifest.assets.length,
    messages: messages.length,
    starting_cash: STARTING_CASH,
    bet_size: BET_SIZE,
    execution: "next session",
    strategies: Object.fromEntries(
      rows.map((r) => [r.name, {
        endValue: summaries[r.name].endValue,
        totalReturnPct: summaries[r.name].totalReturnPct,
        maxDrawdownPct: summaries[r.name].maxDrawdownPct,
        volatilityPct: summaries[r.name].volatilityPct,
        sharpe: summaries[r.name].sharpe,
        filledTrades: r.stats ? r.stats.buys + r.stats.sells : manifest.assets.length,
      }]),
    ),
  };
  writeFileSync("data/backtest.json", JSON.stringify(out, null, 2) + "\n");
  console.log("\nwrote data/backtest.json");
}
