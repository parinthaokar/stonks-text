import { cn } from "@/lib/utils";

/**
 * The coloured circle that identifies an asset everywhere it appears.
 *
 * The colour comes from the asset row in the database, so the sidebar, the chat
 * header, the position list and every chart series agree without any component
 * having to know the mapping.
 */
export function AssetAvatar({
  ticker, color, size = "md", className,
}: {
  ticker: string;
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // "BTC-USD" should read as "BTC", not "BT".
  const label = ticker.split("-")[0].slice(0, 4);

  const sizes = {
    sm: "size-7 text-[9px]",
    md: "size-9 text-[11px]",
    lg: "size-11 text-xs",
  } as const;

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold tracking-tighter text-white tabular-nums",
        sizes[size],
        className,
      )}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {label}
    </span>
  );
}
