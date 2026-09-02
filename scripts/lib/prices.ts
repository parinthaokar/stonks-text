/** Shared loader for the CSVs written by scripts/fetch_prices.py. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Bar } from "../../src/lib/messages/rules";

export const DATA_DIR = join(process.cwd(), "data");

export interface AssetMeta {
  ticker: string;
  name: string;
  type: "stock" | "crypto";
  category: string;
  color: string;
  rows: number;
  first_date: string;
  last_date: string;
  file: string;
}

export interface Manifest {
  generated_at: string;
  as_of: string;
  years_of_history: number;
  assets: AssetMeta[];
}

export function loadManifest(): Manifest {
  return JSON.parse(readFileSync(join(DATA_DIR, "assets.json"), "utf8")) as Manifest;
}

export function loadBars(asset: AssetMeta): Bar[] {
  const text = readFileSync(join(DATA_DIR, asset.file), "utf8").trim();
  const [, ...rows] = text.split("\n"); // header is date,open,high,low,close,volume
  return rows.map((line) => {
    const [date, open, high, low, close, volume] = line.split(",");
    return {
      date,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  });
}

/** First date of the playable sim window, derived from the manifest's as_of. */
export function simStartDate(asOf: string, windowDays: number): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - windowDays);
  return d.toISOString().slice(0, 10);
}
