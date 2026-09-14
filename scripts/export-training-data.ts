/**
 * Exports the ML training set from the SAME rules engine the app uses.
 *
 *   npm run ml:export   ->  data/ml/training.csv
 *
 * WHY THIS IS A TYPESCRIPT SCRIPT AND NOT PYTHON
 * ----------------------------------------------
 * The labels have to come from src/lib/messages/rules.ts itself. Reimplementing
 * the eight rules in Python would create a second copy of the thing this whole
 * project claims has exactly one implementation, and the two would drift the
 * first time a threshold changed. So labelling happens here, in TypeScript,
 * against the real RULES array, and Python only ever sees the resulting CSV.
 *
 * LABELLING MODE
 * --------------
 * The app throttles rules so a thread stays readable: 52-week extremes fire
 * only on a breakout day, streaks fire every other day, mundane waits a week.
 * Those throttles depend on *history* (what was said recently), not on the day
 * itself, so a model given only today's numbers could never predict them.
 *
 * For training we therefore evaluate each day with an empty history:
 *     prev: undefined, daysSinceAnyMessage: Infinity, daysSinceThisRule: Infinity
 *
 * That makes every throttle inactive and reduces each rule to a pure function of
 * the day's own features -- which is exactly the function the model is asked to
 * learn. It also means every one of the ~6,550 bars gets a label, instead of
 * only the 917 that survived throttling to become real messages.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeIndicators, generateMessages, RULES, RULE_META, type RuleId } from "../src/lib/messages/rules";
import { SIM_WINDOW_DAYS } from "../src/lib/config";
import { loadBars, loadManifest, simStartDate } from "./lib/prices";

const manifest = loadManifest();

const HEADER = [
  "ticker", "date",
  // features
  "pct_change", "volume_ratio", "down_streak", "up_streak",
  "drawdown_pct", "is_52w_high", "is_52w_low",
  // labels
  "rule", "tone",
] as const;

const rows: string[] = [HEADER.join(",")];
const counts: Record<string, number> = {};
let skippedWarmup = 0;

for (const asset of manifest.assets) {
  const contexts = computeIndicators(asset.ticker, loadBars(asset));

  for (const d of contexts) {
    // Warm-up days have no 52-week window yet, so their extreme flags are
    // meaningless. Training on them would teach the model that a 52-week high
    // never happens in the first year of any asset's life.
    if (!d.hasFullLookback) {
      skippedWarmup += 1;
      continue;
    }

    const rule = RULES.find((r) =>
      r.match(d, {
        prev: undefined,
        daysSinceAnyMessage: Number.POSITIVE_INFINITY,
        daysSinceThisRule: Number.POSITIVE_INFINITY,
      }),
    );
    if (!rule) continue; // unreachable: `mundane` is unconditional under this context

    counts[rule.id] = (counts[rule.id] ?? 0) + 1;

    rows.push([
      asset.ticker,
      d.date,
      d.pctChange.toFixed(6),
      d.volumeRatio.toFixed(6),
      d.downStreak,
      d.upStreak,
      d.drawdownPct.toFixed(6),
      d.isNew52wHigh ? 1 : 0,
      d.isNew52wLow ? 1 : 0,
      rule.id,
      RULE_META[rule.id as RuleId].tone,
    ].join(","));
  }
}

// The API returns a real example message alongside its prediction, so the
// bundle needs a corpus. These come from the genuine (throttled) message stream
// -- the actual texts the app has shown -- rather than from the unthrottled
// labelling pass, so nothing is quoted back that the app would never have said.
const documents: Record<string, string[]> = {};
const from = simStartDate(manifest.as_of, SIM_WINDOW_DAYS);

for (const asset of manifest.assets) {
  for (const m of generateMessages(asset.ticker, loadBars(asset), { from })) {
    (documents[m.tone] ??= []).push(m.text);
  }
}

// Deduplicate: the variant picker reuses phrasings across assets and dates, and
// a corpus of 900 near-identical strings would bloat the artifact for nothing.
for (const tone of Object.keys(documents)) {
  documents[tone] = [...new Set(documents[tone])].sort();
}

writeFileSync(
  join(process.cwd(), "data", "ml", "documents.json"),
  JSON.stringify(documents, null, 2) + "\n",
);

const out = join(process.cwd(), "data", "ml", "training.csv");
writeFileSync(out, rows.join("\n") + "\n");

const total = rows.length - 1;
console.log(`wrote ${out}`);
console.log(`rows: ${total}   (skipped ${skippedWarmup} warm-up days without a full 52w window)\n`);
console.log(`documents: ${Object.values(documents).reduce((n, v) => n + v.length, 0)} unique phrasings across ${Object.keys(documents).length} tones\n`);
console.log("label distribution:");
for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const pct = (n / total) * 100;
  console.log(`  ${id.padEnd(16)} ${String(n).padStart(5)}  ${pct.toFixed(1).padStart(5)}%  ${"#".repeat(Math.round(pct / 2))}`);
}
