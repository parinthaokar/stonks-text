/**
 * Runs the message rules engine over the real fetched data and prints a
 * distribution report. This is the sanity check for step 3 -- if one rule is
 * swallowing everything, or an asset never speaks, it shows up here.
 *
 *   npm run test:rules
 */
import { generateMessages, RULE_META, THRESHOLDS, type RuleId } from "../src/lib/messages/rules";
import { SIM_WINDOW_DAYS } from "../src/lib/config";
import { loadBars, loadManifest, simStartDate } from "./lib/prices";

const manifest = loadManifest();
const from = simStartDate(manifest.as_of, SIM_WINDOW_DAYS);

console.log(`sim window: ${from} -> ${manifest.as_of}  (${SIM_WINDOW_DAYS} days)`);
console.log(`thresholds: ${JSON.stringify(THRESHOLDS)}\n`);

const ruleIds = Object.keys(RULE_META) as RuleId[];
const totals: Record<string, number> = Object.fromEntries(ruleIds.map((r) => [r, 0]));
let grand = 0;

const header = ["ticker", ...ruleIds.map((r) => r.slice(0, 9)), "TOTAL"];
const widths = [8, ...ruleIds.map(() => 10), 6];
const pad = (s: string, w: number) => s.padEnd(w);
console.log(header.map((h, i) => pad(h, widths[i])).join(""));
console.log("-".repeat(widths.reduce((a, b) => a + b, 0)));

const samples: Record<string, string[]> = Object.fromEntries(ruleIds.map((r) => [r, []]));

for (const asset of manifest.assets) {
  const msgs = generateMessages(asset.ticker, loadBars(asset), { from });
  const counts: Record<string, number> = Object.fromEntries(ruleIds.map((r) => [r, 0]));
  for (const m of msgs) {
    counts[m.rule] += 1;
    totals[m.rule] += 1;
    if (samples[m.rule].length < 3) samples[m.rule].push(`${m.ticker} ${m.date}  ${m.text}`);
  }
  grand += msgs.length;
  console.log(
    [pad(asset.ticker, widths[0]), ...ruleIds.map((r, i) => pad(String(counts[r]), widths[i + 1])), String(msgs.length)].join(""),
  );
}

console.log("-".repeat(widths.reduce((a, b) => a + b, 0)));
console.log(
  [pad("ALL", widths[0]), ...ruleIds.map((r, i) => pad(String(totals[r]), widths[i + 1])), String(grand)].join(""),
);

console.log("\nshare of all messages:");
for (const r of ruleIds) {
  const pct = grand > 0 ? (totals[r] / grand) * 100 : 0;
  console.log(`  ${r.padEnd(16)} ${String(totals[r]).padStart(4)}  ${pct.toFixed(1).padStart(5)}%  ${"#".repeat(Math.round(pct / 2))}`);
}

console.log("\nsamples:");
for (const r of ruleIds) {
  console.log(`\n  [${r}] ${RULE_META[r].description}`);
  for (const s of samples[r]) console.log(`    ${s}`);
  if (samples[r].length === 0) console.log("    (never fired)");
}

// Determinism check: regenerating must produce identical output.
const a = JSON.stringify(generateMessages("TSLA", loadBars(manifest.assets.find((x) => x.ticker === "TSLA")!), { from }));
const b = JSON.stringify(generateMessages("TSLA", loadBars(manifest.assets.find((x) => x.ticker === "TSLA")!), { from }));
console.log(`\ndeterminism check (TSLA regenerated twice): ${a === b ? "PASS" : "FAIL"}`);
