/**
 * SUPABASE DATA SOURCE (production path).
 *
 * Uses the public anon key and relies on the RLS policies in
 * supabase/schema.sql: read-only on the seeded market data, insert on trades,
 * update on sim_state. All calls run on the server (server components and
 * server actions), so nothing here ships to the browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicKey, supabaseUrl } from "./env";
import type { Asset, DataSource, Message, NewTrade, PriceBar, SimState, TradeRow } from "./types";

function client(): SupabaseClient {
  return createClient(supabaseUrl()!, supabasePublicKey()!, { auth: { persistSession: false } });
}

/** Supabase caps a single select at 1000 rows; price_history is ~7000. */
async function selectAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  order: string,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

export function createSupabaseSource(): DataSource {
  return {
    kind: "supabase",

    async getAssets() {
      const db = client();
      const { data, error } = await db
        .from("assets")
        .select("id, ticker, name, type, category, color")
        .order("ticker");
      if (error) throw new Error(`assets select failed: ${error.message}`);
      return (data ?? []) as Asset[];
    },

    async getPrices() {
      const db = client();
      const assets = await this.getAssets();
      const tickerById = new Map(assets.map((a) => [a.id, a.ticker]));

      const rows = await selectAll<{
        asset_id: number; date: string; open: number; high: number;
        low: number; close: number; volume: number;
      }>(db, "price_history", "asset_id, date, open, high, low, close, volume", "date");

      const out: Record<string, PriceBar[]> = {};
      for (const a of assets) out[a.ticker] = [];
      for (const r of rows) {
        const ticker = tickerById.get(r.asset_id);
        if (!ticker) continue;
        out[ticker].push({
          date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: Number(r.volume),
        });
      }
      // `date` ordering is global, so each per-ticker array is already ascending.
      return out;
    },

    async getMessages() {
      const db = client();
      const assets = await this.getAssets();
      const tickerById = new Map(assets.map((a) => [a.id, a.ticker]));

      const rows = await selectAll<{
        id: number; asset_id: number; date: string; rule: string; tone: string;
        body: string; priority: number; pct_change: number; volume_ratio: number; close: number;
      }>(db, "messages", "id, asset_id, date, rule, tone, body, priority, pct_change, volume_ratio, close", "date");

      return rows.map((r) => ({
        id: r.id, assetId: r.asset_id, ticker: tickerById.get(r.asset_id) ?? "",
        date: r.date, rule: r.rule, tone: r.tone, body: r.body, priority: r.priority,
        pctChange: r.pct_change, volumeRatio: r.volume_ratio, close: r.close,
      })) as Message[];
    },

    async getSimState() {
      const db = client();
      const { data, error } = await db
        .from("sim_state")
        .select("sim_date, cash, starting_cash")
        .eq("id", 1)
        .single();
      if (error) throw new Error(`sim_state select failed: ${error.message} (did you run npm run seed?)`);
      return { simDate: data.sim_date, cash: data.cash, startingCash: data.starting_cash };
    },

    async setSimState(next: Partial<SimState>) {
      const db = client();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (next.simDate !== undefined) patch.sim_date = next.simDate;
      if (next.cash !== undefined) patch.cash = next.cash;
      const { error } = await db.from("sim_state").update(patch).eq("id", 1);
      if (error) throw new Error(`sim_state update failed: ${error.message}`);
    },

    async getTrades() {
      const db = client();
      const assets = await this.getAssets();
      const tickerById = new Map(assets.map((a) => [a.id, a.ticker]));

      const rows = await selectAll<{
        id: number; asset_id: number; message_id: number | null; action: string;
        price: number; quantity: number; notional: number; trade_date: string; created_at: string;
      }>(db, "trades", "id, asset_id, message_id, action, price, quantity, notional, trade_date, created_at", "trade_date");

      return rows.map((r) => ({
        id: r.id, assetId: r.asset_id, ticker: tickerById.get(r.asset_id) ?? "",
        messageId: r.message_id, action: r.action as TradeRow["action"], price: r.price,
        quantity: r.quantity, notional: r.notional, tradeDate: r.trade_date, createdAt: r.created_at,
      }));
    },

    async addTrade(t: NewTrade) {
      const db = client();
      const { error } = await db.from("trades").insert({
        asset_id: t.assetId, message_id: t.messageId, action: t.action,
        price: t.price, quantity: t.quantity, notional: t.notional, trade_date: t.tradeDate,
      });
      if (error) throw new Error(`trade insert failed: ${error.message}`);

      // Cash is kept on sim_state rather than recomputed from the ledger on
      // every read. The ledger stays the source of truth for the equity curve;
      // this is just the running balance the UI needs on every page.
      if (t.action !== "hold") {
        const state = await this.getSimState();
        const delta = t.action === "buy" ? -t.notional : t.notional;
        await this.setSimState({ cash: state.cash + delta });
      }
    },

    async resetSim() {
      const db = client();
      const { error: delErr } = await db.from("trades").delete().neq("id", -1);
      if (delErr) throw new Error(`clearing trades failed: ${delErr.message}`);

      // Restart the clock at the beginning of the sim window.
      const prices = await this.getPrices();
      const allDates = new Set<string>();
      for (const bars of Object.values(prices)) for (const b of bars) allDates.add(b.date);
      const sorted = [...allDates].sort();
      const asOf = sorted[sorted.length - 1];
      const d = new Date(`${asOf}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 365);

      const state = await this.getSimState();
      await this.setSimState({ simDate: d.toISOString().slice(0, 10), cash: state.startingCash });
    },
  };
}
