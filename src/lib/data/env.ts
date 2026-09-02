/**
 * Supabase credential resolution.
 *
 * Supabase is migrating from legacy JWT keys (`anon` / `service_role`) to a new
 * format (`sb_publishable_...` / `sb_secret_...`). Both are accepted here so the
 * project works whichever era a given dashboard hands you, and so rotating to
 * the new scheme later needs no code change.
 *
 * The publishable/anon key is safe in the browser -- what it can actually do is
 * bounded by the RLS policies in supabase/schema.sql. The secret/service_role
 * key bypasses RLS entirely and is read ONLY by the seed script.
 */

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/** The public, browser-safe key. New name first, legacy name as fallback. */
export function supabasePublicKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/** The privileged key. Server-side only -- never expose this to the client. */
export function supabaseSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabasePublicKey());
}
