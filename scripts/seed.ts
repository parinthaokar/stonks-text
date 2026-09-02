/**
 * STONKS & TEXTS -- SEED
 *
 * Loads the CSVs written by scripts/fetch_prices.py into Supabase, runs the
 * message rules engine over them, and stores the resulting messages.
 *
 *   npm run seed            refresh market data; keep the demo user's progress
 *   npm run seed -- --reset refresh AND wipe trades / restart the sim clock
 *
 * Idempotent: every write is an upsert keyed on a natural unique constraint, so
 * re-running after `npm run fetch` refreshes the dataset in place.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY -- the seed writes to tables that RLS
 * deliberately makes read-only for the browser's anon key.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { generateMessages } from "../src/lib/messages/rules";
import { SIM_WINDOW_DAYS, STARTING_CASH } from "../src/lib/config";
import { loadBars, loadManifest, simStartDate } from "./lib/prices";
import { supabaseSecretKey, supabaseUrl } from "../src/lib/data/env";

config({ path: ".env.local" });

const URL = supabaseUrl();
const SECRET_KEY = supabaseSecretKey();
const RESET = process.argv.includes("--reset");

if (!URL || !SECRET_KEY) {
  console.error(
    "Missing credentials. Add to .env.local:\n" +
      "  NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co\n" +
      "  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   (or the legacy ANON_KEY)\n" +
      "  SUPABASE_SECRET_KEY=sb_secret_...                         (or the legacy SERVICE_ROLE_KEY)\n\n" +
      "The secret key is required: RLS deliberately makes the seeded tables\n" +
      "read-only for the publishable key. Find it under Settings -> API keys.\n",
  );
  process.exit(1);
}

const db = createClient(URL, SECRET_KEY, { auth: { persistSession: false } });

/** Supabase rejects very large payloads; insert in chunks. */
async function upsertChunked<T>(table: string, rows: T[], onConflict: string, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await db.from(table).upsert(chunk as never, { onConflict });
    if (error) throw new Error(`${table} upsert failed at row ${i}: ${error.message}`);
    process.stdout.write(`\r  ${table}: ${Math.min(i + size, rows.length)}/${rows.length}   `);
  }
  process.stdout.write("\n");
}

async function main() {
  const manifest = loadManifest();
  const simStart = simStartDate(manifest.as_of, SIM_WINDOW_DAYS);

  console.log(`dataset  : ${manifest.assets.length} assets, as_of ${manifest.as_of}`);
  console.log(`sim window: ${simStart} -> ${manifest.as_of}\n`);

  // -- assets ---------------------------------------------------------------
  const { data: assetRows, error: assetErr } = await db
    .from("assets")
    .upsert(
      manifest.assets.map((a) => ({
        ticker: a.ticker, name: a.name, type: a.type, category: a.category, color: a.color,
      })),
      { onConflict: "ticker" },
    )
    .select("id, ticker");
  if (assetErr) throw new Error(`assets upsert failed: ${assetErr.message}`);

  const idByTicker = new Map(assetRows!.map((r) => [r.ticker as string, r.id as number]));
  console.log(`  assets: ${assetRows!.length}`);

  // -- price history --------------------------------------------------------
  const priceRows: Record<string, unknown>[] = [];
  const messageRows: Record<string, unknown>[] = [];

  for (const asset of manifest.assets) {
    const assetId = idByTicker.get(asset.ticker)!;
    const bars = loadBars(asset);

    for (const b of bars) {
      priceRows.push({
        asset_id: assetId, date: b.date,
        open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      });
    }

    // Messages are only generated inside the sim window. The two years of bars
    // before it exist purely so 52-week highs/lows and the volume baseline are
    // already well-defined on the first playable day.
    for (const m of generateMessages(asset.ticker, bars, { from: simStart })) {
      messageRows.push({
        asset_id: assetId, date: m.date, rule: m.rule, tone: m.tone, body: m.text,
        priority: m.priority, pct_change: m.pctChange,
        volume_ratio: m.volumeRatio, close: m.close,
      });
    }
  }

  await upsertChunked("price_history", priceRows, "asset_id,date");
  await upsertChunked("messages", messageRows, "asset_id,date");

  // -- sim state ------------------------------------------------------------
  const { data: existing } = await db.from("sim_state").select("sim_date, cash").eq("id", 1).maybeSingle();

  if (RESET || !existing) {
    if (RESET) {
      // neq on a bigserial id matches every row; supabase-js requires a filter.
      const { error } = await db.from("trades").delete().neq("id", -1);
      if (error) throw new Error(`clearing trades failed: ${error.message}`);
      console.log("  trades: cleared");
    }
    const { error } = await db.from("sim_state").upsert(
      { id: 1, sim_date: simStart, cash: STARTING_CASH, starting_cash: STARTING_CASH, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (error) throw new Error(`sim_state init failed: ${error.message}`);
    console.log(`  sim_state: reset to ${simStart} with $${STARTING_CASH.toLocaleString()}`);
  } else {
    console.log(`  sim_state: preserved (at ${existing.sim_date}, $${Number(existing.cash).toFixed(2)} cash)`);
    console.log("             pass --reset to restart the sim and clear trades");
  }

  console.log(`\nseeded ${priceRows.length} price rows and ${messageRows.length} messages.`);
}

main().catch((err) => {
  console.error(`\nseed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
