"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getPipelineInfo, MOOD_API_URL, type PipelineInfo } from "@/lib/mood-api";

/**
 * Renders GET /pipeline -- the artifact describing itself.
 *
 * Fetched from the BROWSER rather than on the server. Server-rendering it would
 * work, but then the page could look healthy while the browser had no route to
 * the API at all. Calling it client-side means what you see here is proof the
 * deployed frontend can actually reach the deployed service.
 */
export function PipelineInfoCard() {
  const [info, setInfo] = useState<PipelineInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPipelineInfo()
      .then((d) => !cancelled && setInfo(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Pipeline unavailable</CardTitle>
          <CardDescription className="font-mono text-xs">{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!info) {
    return (
      <Card className="shadow-none">
        <CardContent className="space-y-2 py-6">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-80" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">The deployed artifact</CardTitle>
        <CardDescription className="break-all font-mono text-[11px]">
          GET {MOOD_API_URL}/pipeline
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {info.steps.map((s, i) => (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <Badge variant={s === "features" ? "default" : "secondary"} className="font-mono text-[11px]">
                {s}
              </Badge>
            </span>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-xs sm:grid-cols-3">
          <Field label="Custom transformer" value={info.custom_transformer} mono />
          <Field label="scikit-learn" value={info.sklearn_version} mono />
          <Field label="Python" value={info.python_version} mono />
          <Field label="Training rows" value={info.n_training_rows.toLocaleString()} />
          <Field label="Features" value={`${info.raw_features.length} → ${info.engineered_features.length}`} />
          <Field label="Classes" value={String(info.classes.length)} />
          <Field label="Holdout accuracy" value={`${(info.holdout_accuracy * 100).toFixed(1)}%`} />
          <Field label="Macro F1" value={info.holdout_macro_f1.toFixed(3)} />
          <Field label="Majority baseline" value={`${(info.majority_baseline * 100).toFixed(1)}%`} />
        </dl>

        <p className="text-[11px] text-muted-foreground">
          Built {new Date(info.built_at).toLocaleString()} · {info.n_indexed_days.toLocaleString()} indexed
          days · {info.n_example_messages} example phrasings
        </p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-[11px] font-medium" : "font-medium tabular-nums"}>{value}</dd>
    </div>
  );
}
