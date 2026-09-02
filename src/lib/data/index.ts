/**
 * Picks the data source.
 *
 * Supabase when credentials are configured (the deployed app and anyone who has
 * run the seed); the committed CSVs otherwise, so `npm run dev` works from a
 * fresh clone. Every page talks to the DataSource interface and neither knows
 * nor cares which one it got.
 */
import { createLocalSource } from "./local";
import { createSupabaseSource } from "./supabase";
import { isSupabaseConfigured } from "./env";
import type { DataSource } from "./types";

export * from "./types";
export { isSupabaseConfigured } from "./env";

let cached: DataSource | null = null;

export function getDataSource(): DataSource {
  if (!cached) cached = isSupabaseConfigured() ? createSupabaseSource() : createLocalSource();
  return cached;
}
