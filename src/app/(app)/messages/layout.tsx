import { DayFlash } from "@/components/day-flash";
import { loadAppData } from "@/lib/app-data";
import { BIG_MOVER_PRIORITY } from "@/lib/config";

/**
 * Wraps only the Messages section so the day-change card has somewhere to sit.
 *
 * It used to live in the shared app layout, but a floating card at the top of
 * the panel lands directly on the Portfolio tab's P&L figure -- the one number
 * you're most likely to be watching while the clock advances. Messages is also
 * where playing actually happens, and the thread has whitespace to spare.
 *
 * Portfolio and Data aren't left without a signal: the header date animates on
 * every tick and both pages state the sim date in their subtitle.
 */
export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const data = await loadAppData();

  // What landed today. loadAppData is request-cached, so this is free.
  const todaysMessages = data.messages.filter((m) => m.date === data.sim.simDate);
  const bigMovers = todaysMessages.filter((m) => m.priority >= BIG_MOVER_PRIORITY).length;

  const tickers = [
    ...new Map(
      todaysMessages
        .map((m) => data.assetById.get(m.assetId))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
        .map((a) => [a.ticker, { ticker: a.ticker, color: a.color }]),
    ).values(),
  ].slice(0, 4);

  return (
    <div className="relative h-full">
      {/* Keyed on the date so React remounts it -- that remount is what replays
          the CSS animation. Without the key it renders once and never fires
          again, no matter how many times the clock moves. */}
      <DayFlash
        key={data.sim.simDate}
        simDate={data.sim.simDate}
        newTexts={todaysMessages.length}
        bigMovers={bigMovers}
        tickers={tickers}
      />
      {children}
    </div>
  );
}
