"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MOOD_API_URL, predictMood, type MoodRequest, type MoodResponse,
} from "@/lib/mood-api";
import { cn } from "@/lib/utils";
import { signedPercent } from "@/lib/format";

/** Mood colours follow the app's existing P&L semantics: up green, down red. */
const TONE_STYLES: Record<string, { bar: string; text: string; bubble: string }> = {
  euphoric:   { bar: "bg-emerald-600", text: "text-emerald-600 dark:text-emerald-400", bubble: "bg-emerald-600" },
  manic:      { bar: "bg-emerald-600", text: "text-emerald-600 dark:text-emerald-400", bubble: "bg-emerald-600" },
  smug:       { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", bubble: "bg-emerald-500" },
  anxious:    { bar: "bg-red-600",     text: "text-red-600 dark:text-red-400",         bubble: "bg-red-600" },
  desperate:  { bar: "bg-red-600",     text: "text-red-600 dark:text-red-400",         bubble: "bg-red-600" },
  despondent: { bar: "bg-red-700",     text: "text-red-600 dark:text-red-400",         bubble: "bg-red-700" },
  attention:  { bar: "bg-amber-500",   text: "text-amber-600 dark:text-amber-400",     bubble: "bg-amber-500" },
  casual:     { bar: "bg-neutral-400", text: "text-muted-foreground",                  bubble: "bg-neutral-500" },
};

const DEFAULTS: MoodRequest = {
  pct_change: -7.4,
  volume_ratio: 3.1,
  down_streak: 4,
  up_streak: 0,
  drawdown_pct: 22,
  is_52w_high: 0,
  is_52w_low: 0,
};

/** One-tap scenarios, so the page is interesting before you touch a slider. */
const PRESETS: { name: string; values: MoodRequest }[] = [
  { name: "Crash",      values: { pct_change: -9.2, volume_ratio: 4.5, down_streak: 5, up_streak: 0, drawdown_pct: 31, is_52w_high: 0, is_52w_low: 0 } },
  { name: "Melt-up",    values: { pct_change: 8.1, volume_ratio: 3.2, down_streak: 0, up_streak: 3, drawdown_pct: 2, is_52w_high: 0, is_52w_low: 0 } },
  { name: "Record high",values: { pct_change: 2.4, volume_ratio: 1.6, down_streak: 0, up_streak: 5, drawdown_pct: 0, is_52w_high: 1, is_52w_low: 0 } },
  { name: "Rock bottom",values: { pct_change: -3.1, volume_ratio: 2.2, down_streak: 6, up_streak: 0, drawdown_pct: 58, is_52w_high: 0, is_52w_low: 1 } },
  { name: "Quiet day",  values: { pct_change: 0.3, volume_ratio: 0.9, down_streak: 0, up_streak: 1, drawdown_pct: 6, is_52w_high: 0, is_52w_low: 0 } },
];

export function MoodLab() {
  const [input, setInput] = useState<MoodRequest>(DEFAULTS);
  const [result, setResult] = useState<MoodResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Debounced so dragging a slider fires one request when you stop, not forty
  // on the way there. Aborting in the cleanup means a slow earlier response can
  // never land after a newer one and show a stale mood.
  useEffect(() => {
    const controller = new AbortController();

    const timer = setTimeout(() => {
      setLoading(true);
      predictMood(input)
        .then((res) => {
          if (controller.signal.aborted) return;
          setResult(res);
          setError(null);
        })
        .catch((err: Error) => {
          if (controller.signal.aborted) return;
          setError(err.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [input]);

  function set<K extends keyof MoodRequest>(key: K, value: MoodRequest[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
  }

  const style = result ? TONE_STYLES[result.tone] ?? TONE_STYLES.casual : TONE_STYLES.casual;
  const sortedProbs = result
    ? Object.entries(result.probabilities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ---------------- controls ---------------- */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Describe a day</CardTitle>
          <CardDescription>
            These seven numbers are exactly what the rules engine sees. Change them and the
            model re-predicts.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <Button key={p.name} size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => setInput(p.values)}>
                {p.name}
              </Button>
            ))}
          </div>

          <SliderRow label="Day change" value={input.pct_change} min={-15} max={15} step={0.1}
            format={(v) => signedPercent(v)} onChange={(v) => set("pct_change", v)} />
          <SliderRow label="Volume vs average" value={input.volume_ratio} min={0} max={10} step={0.1}
            format={(v) => `${v.toFixed(1)}×`} onChange={(v) => set("volume_ratio", v)} />
          <SliderRow label="Down streak" value={input.down_streak} min={0} max={12} step={1}
            format={(v) => `${v} days`} onChange={(v) => set("down_streak", Math.round(v))} />
          <SliderRow label="Up streak" value={input.up_streak} min={0} max={12} step={1}
            format={(v) => `${v} days`} onChange={(v) => set("up_streak", Math.round(v))} />
          <SliderRow label="Off 52-week high" value={input.drawdown_pct} min={0} max={70} step={0.5}
            format={(v) => `${v.toFixed(0)}%`} onChange={(v) => set("drawdown_pct", v)} />

          <div className="flex gap-2 pt-1">
            {/* Mutually exclusive: a close cannot be both the year's high and its
                low, and letting both toggle on would send the model a row that
                never appears in the training data. */}
            <Toggle label="New 52-week high" active={input.is_52w_high === 1}
              onClick={() => setInput((p) => ({ ...p, is_52w_high: p.is_52w_high ? 0 : 1, is_52w_low: 0 }))} />
            <Toggle label="New 52-week low" active={input.is_52w_low === 1}
              onClick={() => setInput((p) => ({ ...p, is_52w_low: p.is_52w_low ? 0 : 1, is_52w_high: 0 }))} />
          </div>
        </CardContent>
      </Card>

      {/* ---------------- result ---------------- */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">What it would say</CardTitle>
          <CardDescription className="break-all font-mono text-[11px]">
            POST {MOOD_API_URL || "(NEXT_PUBLIC_MODAL_API_URL not set)"}/predict
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950">
              <p className="font-medium text-red-700 dark:text-red-400">Request failed</p>
              <p className="mt-1 font-mono text-xs text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : !result ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-48" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              <div className={cn("transition-opacity", loading && "opacity-50")}>
                <p className="text-xs text-muted-foreground">Predicted mood</p>
                <p className={cn("text-3xl font-semibold tracking-tight", style.text)}>
                  {result.tone}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {result.label} · {(result.confidence * 100).toFixed(1)}% confident
                </p>
              </div>

              <div className={cn("transition-opacity", loading && "opacity-50")}>
                <p className="mb-1.5 text-xs text-muted-foreground">It would text you</p>
                <div className={cn("rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm text-white", style.bubble)}>
                  {result.example_message}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs text-muted-foreground">All eight moods</p>
                <div className="space-y-1.5">
                  {sortedProbs.map(([tone, p]) => (
                    <div key={tone} className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">{tone}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full transition-[width] duration-300",
                            (TONE_STYLES[tone] ?? TONE_STYLES.casual).bar)}
                          style={{ width: `${Math.max(p * 100, 0.5)}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {(p * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Closest real days in the dataset
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.nearest_days.map((n) => (
                    <Badge key={`${n.ticker}-${n.date}`} variant="outline" className="gap-1.5 py-1 font-normal">
                      <span className="font-medium">{n.ticker}</span>
                      <span className="text-muted-foreground">{n.date}</span>
                      <span className="tabular-nums text-muted-foreground">{signedPercent(n.pct_change)}</span>
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SliderRow({
  label, value, min, max, step, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step}
        onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn(
        "flex-1 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
        active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted",
      )}>
      {label}
    </button>
  );
}
