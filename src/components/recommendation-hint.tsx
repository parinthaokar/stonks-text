"use client";

import { useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchRecommendation, RECOMMEND_API_URL,
  type RecommendRequest, type RecommendResponse,
} from "@/lib/recommendation";

/**
 * "Recommended action" under the newest text.
 *
 * Collapsed until asked. Two reasons: a recommendation shown by default nudges
 * every decision before the player has formed one, and this model does not beat
 * a majority-class baseline -- so it has not earned the right to speak first.
 *
 * Its measured accuracy is displayed alongside the answer, pulled from the
 * artifact's own metadata rather than hardcoded here, so the caveat can never
 * drift from the model it describes.
 */
export function RecommendationHint({
  request, ticker,
}: {
  request: RecommendRequest;
  ticker: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function reveal() {
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    fetchRecommendation(request)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  if (!open) {
    return (
      <div className="mx-auto max-w-3xl px-1 pb-2">
        <button
          type="button"
          onClick={reveal}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Sparkles className="size-3" />
          Show what the model thinks
          <ChevronDown className="size-3" />
        </button>
      </div>
    );
  }

  const styles: Record<string, string> = {
    buy: "text-emerald-600 dark:text-emerald-400",
    sell: "text-red-600 dark:text-red-400",
    hold: "text-muted-foreground",
  };
  const bars: Record<string, string> = {
    buy: "bg-emerald-600",
    sell: "bg-red-600",
    hold: "bg-neutral-400",
  };

  return (
    <div className="mx-auto max-w-3xl px-1 pb-2">
      <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
        {error ? (
          <>
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">
              Model unavailable
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{error}</p>
            {!RECOMMEND_API_URL && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                NEXT_PUBLIC_MODAL_API_URL isn&apos;t set on this deployment.
              </p>
            )}
          </>
        ) : loading || !data ? (
          <p className="text-[11px] text-muted-foreground">Asking the model about {ticker}…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Recommended action
              </span>
              <span className={cn("text-sm font-semibold uppercase", styles[data.action])}>
                {data.action}
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {(data.confidence * 100).toFixed(0)}% confident
              </span>
            </div>

            <div className="mt-2 flex gap-2">
              {(["sell", "hold", "buy"] as const).map((k) => (
                <div key={k} className="flex-1">
                  <div className="mb-0.5 flex justify-between text-[10px] text-muted-foreground">
                    <span>{k}</span>
                    <span className="tabular-nums">
                      {((data.probabilities[k] ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", bars[k])}
                      style={{ width: `${Math.max((data.probabilities[k] ?? 0) * 100, 1)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* The caveat is not fine print -- it is the honest headline. A model
                that loses to "always guess the same thing" should say so next to
                every answer it gives. */}
            <p className="mt-2 border-t pt-2 text-[10px] leading-relaxed text-muted-foreground">
              {data.track_record.beats_baseline ? "Beats" : "Does not beat"} a naive baseline:{" "}
              <span className="tabular-nums">
                {(data.track_record.holdout_accuracy * 100).toFixed(1)}%
              </span>{" "}
              accurate vs{" "}
              <span className="tabular-nums">
                {(data.track_record.majority_baseline * 100).toFixed(1)}%
              </span>{" "}
              for always guessing the most common answer. Treat this as a talking point, not advice.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
