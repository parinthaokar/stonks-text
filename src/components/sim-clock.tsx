"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ChevronRight, SkipForward, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advanceSim, resetSim } from "@/app/actions";
import { longDate } from "@/lib/format";

/**
 * The clock in the app header.
 *
 * The sim starts twelve months before the end of the dataset and plays forward.
 * "Next text" jumps to the next day anything actually messages you, which is
 * how you cover a year without stepping through 200 silent weekends.
 */
export function SimClock({
  simDate, windowEnd, hasNextMessage,
}: {
  simDate: string;
  windowEnd: string;
  hasNextMessage: boolean;
}) {
  const [pending, start] = useTransition();
  const atEnd = simDate >= windowEnd;

  function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-sm font-medium tabular-nums md:inline">{longDate(simDate)}</span>

      <Button
        size="sm" variant="outline" disabled={pending || atEnd}
        onClick={() => run(() => advanceSim("next-day"))}
      >
        <ChevronRight /> Next day
      </Button>

      <Button
        size="sm" disabled={pending || !hasNextMessage}
        onClick={() => run(() => advanceSim("next-message"))}
      >
        <SkipForward /> Next text
      </Button>

      <Button
        size="icon" variant="ghost" className="size-8" disabled={pending}
        title="Reset the sim and clear all trades"
        onClick={() => run(resetSim)}
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </div>
  );
}
