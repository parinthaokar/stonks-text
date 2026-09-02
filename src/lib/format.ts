/** Formatting helpers, kept in one place so every number reads the same way. */

export function currency(n: number, opts: { decimals?: number } = {}): string {
  const decimals = opts.decimals ?? (Math.abs(n) >= 1000 ? 0 : 2);
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
}

/** Always signed -- P&L reads wrong without an explicit +. */
export function signedCurrency(n: number): string {
  return `${n >= 0 ? "+" : "-"}${currency(Math.abs(n))}`;
}

export function percent(n: number, decimals = 1): string {
  return `${n.toFixed(decimals)}%`;
}

export function signedPercent(n: number, decimals = 1): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

export function compactNumber(n: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "Mar 14" -- dates are parsed as UTC so they never shift by a timezone. */
export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

/** "Fri, Mar 14, 2025" -- used for the date separators in a thread. */
export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** Tailwind text colour for a P&L figure. Green up, red down, muted at zero. */
export function pnlColor(n: number): string {
  if (Math.abs(n) < 0.005) return "text-muted-foreground";
  return n > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}
