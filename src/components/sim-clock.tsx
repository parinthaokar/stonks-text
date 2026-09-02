"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Play, Pause, SkipForward, RotateCcw, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advanceSim, resetSim } from "@/app/actions";
import { longDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The clock in the app header.
 *
 * The sim starts twelve months before the end of the dataset and plays forward.
 * Auto-play advances to the next day something actually texts you -- stepping
 * through silent weekends one at a time would burn most of the year on nothing.
 *
 * It stops on its own when a big mover lands, so the clock never plays past a
 * decision that was the whole point of the app.
 */

/** Base gap between auto-advances; divided by the speed multiplier. */
const BASE_INTERVAL_MS = 3000;
const SPEEDS = [1, 2, 4] as const;

export function SimClock({
  simDate, windowEnd, hasNextMessage,
}: {
  simDate: string;
  windowEnd: string;
  hasNextMessage: boolean;
}) {
  const [pending, start] = useTransition();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  const atEnd = simDate >= windowEnd || !hasNextMessage;
  const interval = BASE_INTERVAL_MS / speed;

  // Derived, not synced. Reaching the end of the data can't leave the clock in
  // a "playing" state, so there's nothing to reconcile in an effect -- the
  // button and the loop both read this instead of the raw toggle.
  const isPlaying = playing && !atEnd;

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  // Auto-play loop. `simDate` is in the dependency list so the next timer is
  // armed only after the server has actually moved the clock -- a fixed
  // setInterval would keep firing into a pending transition and stack up
  // advances the user never saw.
  useEffect(() => {
    if (!isPlaying || pending) return;

    const timer = setTimeout(() => {
      start(async () => {
        const res = await advanceSim("next-message");

        if (!res.ok) {
          setPlaying(false);
          toast.error(res.message);
          return;
        }
        if (res.pauseReason) {
          setPlaying(false);
          toast(res.pauseReason, { description: "Auto-play paused so you can reply." });
          return;
        }
        if (res.atEnd) {
          setPlaying(false);
          toast.success("Reached the end of the dataset.");
        }
      });
    }, interval);

    return () => clearTimeout(timer);
  }, [isPlaying, pending, interval, simDate]);

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={isPlaying ? "secondary" : "default"}
        disabled={atEnd}
        onClick={() => setPlaying((p) => !p)}
        aria-label={isPlaying ? "Pause the sim" : "Play the sim"}
      >
        {isPlaying ? <Pause /> : <Play />}
        {isPlaying ? "Pause" : "Play"}
      </Button>

      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 tabular-nums"
        onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
        title="Playback speed"
      >
        <Gauge className="size-3.5" />
        {speed}×
      </Button>

      <span
        // Re-keyed on the date so the number visibly ticks over on each advance.
        key={simDate}
        className="hidden animate-value-pop text-sm font-medium tabular-nums md:inline"
      >
        {longDate(simDate)}
      </span>

      <Button
        size="sm" variant="outline" disabled={pending || atEnd}
        onClick={() => run(() => advanceSim("next-message"))}
      >
        <SkipForward /> Next text
      </Button>

      <Button
        size="icon" variant="ghost" className="size-8" disabled={pending}
        title="Reset the sim and clear all trades"
        onClick={() => {
          setPlaying(false);
          run(resetSim);
        }}
      >
        <RotateCcw className="size-3.5" />
      </Button>

      {/* Countdown to the next auto-advance, pinned to the bottom of the header.
          Keyed on the date so the fill restarts cleanly every tick. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary/70",
          isPlaying && !pending ? "animate-tick-fill" : "hidden",
        )}
        key={`bar-${simDate}`}
        style={{ animationDuration: `${interval}ms` }}
      />
    </div>
  );
}
