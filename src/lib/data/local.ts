/**
 * FILE-BACKED DATA SOURCE (fallback).
 *
 * Reads the committed CSVs in data/ and runs the rules engine in-process, so
 * `npm run dev` works from a fresh clone with no Supabase project. Mutable
 * state (trades, sim clock) goes to a gitignored JSON file next to the data.
 *
 * This is a development and grading convenience, not the production path --
 * a serverless deploy has an ephemeral filesystem, so writes here do not
 * survive. When Supabase credentials are present, src/lib/data/index.ts uses
 * the Supabase source instead and this file is never touched.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generateMessages, type Bar } from "../messages/rules";
import { SIM_WINDOW_DAYS, STARTING_CASH } from "../config";
import type { Asset, DataSource, Message, NewTrade, PriceBar, SimState, TradeRow } from "./types";

const DATA_DIR = join(process.cwd(), "data");
const STATE_FILE = join(DATA_DIR, ".local-state.json");

interface ManifestAsset {
  ticker: string; name: string; type: "stock" | "crypto";
  category: string; color: string; file: string;
}
interface Manifest { as_of: string; assets: ManifestAsset[] }

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(DATA_DIR, "assets.json"), "utf8")) as Manifest;
}

function simStart(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - SIM_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

function readBars(file: string): Bar[] {
  const [, ...rows] = readFileSync(join(DATA_DIR, file), "utf8").trim().split("\n");
  return rows.map((line) => {
    const [date, open, high, low, close, volume] = line.split(",");
    return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume };
  });
}

interface LocalState { sim: SimState; trades: TradeRow[]; nextId: number }

function defaultState(): LocalState {
  const m = manifest();
  return {
    sim: { simDate: simStart(m.as_of), cash: STARTING_CASH, startingCash: STARTING_CASH },
    trades: [],
    nextId: 1,
  };
}

function readState(): LocalState {
  if (!existsSync(STATE_FILE)) return defaultState();
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as LocalState;
  } catch {
    // A corrupt dev state file should not take the whole app down.
    return defaultState();
  }
}

function writeState(state: LocalState) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Assets get stable synthetic ids from their position in the manifest, so the
// same ticker keeps the same id across restarts (mirroring the DB's bigserial).
function assetList(): Asset[] {
  return manifest().assets.map((a, i) => ({
    id: i + 1, ticker: a.ticker, name: a.name, type: a.type, category: a.category, color: a.color,
  }));
}

export function createLocalSource(): DataSource {
  return {
    kind: "local",

    async getAssets() {
      return assetList();
    },

    async getPrices() {
      const out: Record<string, PriceBar[]> = {};
      for (const a of manifest().assets) out[a.ticker] = readBars(a.file);
      return out;
    },

    async getMessages() {
      const m = manifest();
      const from = simStart(m.as_of);
      const assets = assetList();
      const byTicker = new Map(assets.map((a) => [a.ticker, a]));
      const all: Message[] = [];
      let id = 1;

      for (const a of m.assets) {
        for (const g of generateMessages(a.ticker, readBars(a.file), { from })) {
          all.push({
            id: id++, assetId: byTicker.get(a.ticker)!.id, ticker: g.ticker, date: g.date,
            rule: g.rule, tone: g.tone, body: g.text, priority: g.priority,
            pctChange: g.pctChange, volumeRatio: g.volumeRatio, close: g.close,
          });
        }
      }
      return all;
    },

    async getSimState() {
      return readState().sim;
    },

    async setSimState(next) {
      const s = readState();
      s.sim = { ...s.sim, ...next };
      writeState(s);
    },

    async getTrades() {
      return readState().trades;
    },

    async addTrade(t: NewTrade) {
      const s = readState();
      const ticker = assetList().find((a) => a.id === t.assetId)?.ticker ?? "";
      s.trades.push({
        id: s.nextId++, assetId: t.assetId, ticker, messageId: t.messageId,
        action: t.action, price: t.price, quantity: t.quantity, notional: t.notional,
        tradeDate: t.tradeDate, createdAt: new Date().toISOString(),
      });
      // Cash moves here so the local source stays consistent with the DB path,
      // where the same arithmetic happens inside the trade server action.
      if (t.action === "buy") s.sim.cash -= t.notional;
      if (t.action === "sell") s.sim.cash += t.notional;
      writeState(s);
    },

    async resetSim() {
      writeState(defaultState());
    },
  };
}
