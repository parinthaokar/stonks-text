import { AssetAvatar } from "@/components/asset-avatar";
import { longDate } from "@/lib/format";

/**
 * The card that announces a new sim day.
 *
 * Deliberately not a client component and deliberately stateless. It is keyed
 * on the date by its parent, so React remounts it whenever the clock moves and
 * the CSS animation runs from the top; the animation ends at
 * `visibility: hidden`, which means nothing has to time it out or hide it.
 * No timer, no state, nothing to leak.
 *
 * `pointer-events-none` throughout: it floats over the thread and must never
 * swallow a click on the reply buttons underneath it.
 */
export function DayFlash({
  simDate, newTexts, bigMovers, tickers,
}: {
  simDate: string;
  newTexts: number;
  bigMovers: number;
  /** Up to a few assets that spoke today, for the avatar row. */
  tickers: { ticker: string; color: string }[];
}) {
  return (
    <div
      // Keyed by the caller on simDate -- see AppLayout.
      // top-20 clears the thread's own header (asset name, price, position).
      // At top-4 the card landed straight on top of it.
      className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4"
      aria-live="polite"
    >
      <div className="animate-day-flash flex flex-col items-center gap-1.5 rounded-xl border bg-background/95 px-6 py-3 shadow-sm backdrop-blur">
        <p className="text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
          {longDate(simDate)}
        </p>

        {newTexts > 0 ? (
          <div className="flex items-center gap-2">
            {tickers.length > 0 && (
              <div className="flex -space-x-1.5">
                {tickers.map((t) => (
                  <AssetAvatar
                    key={t.ticker} ticker={t.ticker} color={t.color} size="sm"
                    className="ring-2 ring-background"
                  />
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {newTexts} new {newTexts === 1 ? "text" : "texts"}
              {bigMovers > 0 && (
                <span className="ml-1 font-medium text-foreground">
                  · {bigMovers} big {bigMovers === 1 ? "mover" : "movers"}
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Quiet day — nobody texted.</p>
        )}
      </div>
    </div>
  );
}
