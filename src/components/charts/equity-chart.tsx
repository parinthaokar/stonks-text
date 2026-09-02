"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { shortDate } from "@/lib/format";

export interface EquityPointRow {
  date: string;
  you: number;
  benchmark: number;
  coinflip: number;
}

/**
 * The backtest chart: your ledger against the two reference curves.
 *
 * Three series is deliberately the ceiling -- categorical hues stop being
 * reliably distinguishable past a handful, and the point of this chart is a
 * comparison, not a survey. Slots 1-3 of the validated palette are used in
 * order. The stats table beneath it carries the same numbers in text, which is
 * what licenses the aqua series on a light surface.
 */
const config = {
  you: { label: "Your trades", color: "var(--viz-1)" },
  benchmark: { label: "Buy & hold", color: "var(--viz-2)" },
  coinflip: { label: "Coin flip", color: "var(--viz-3)" },
} satisfies ChartConfig;

export function EquityChart({ data }: { data: EquityPointRow[] }) {
  // A year of daily points is far more tick labels than will fit; show ~8.
  const tickInterval = Math.max(1, Math.floor(data.length / 8));

  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={tickInterval}
          tickFormatter={shortDate}
          className="text-[11px]"
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          width={56}
          domain={["dataMin - 400", "dataMax + 400"]}
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(1)}k`}
          className="text-[11px]"
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => shortDate(String(v))}
              formatter={(value, name) => [
                `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
                config[name as keyof typeof config]?.label ?? name,
              ]}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {/* Thin 2px marks, no dots: 366 points per series would be unreadable. */}
        <Line dataKey="you" stroke="var(--color-you)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="benchmark" stroke="var(--color-benchmark)" strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="coinflip" stroke="var(--color-coinflip)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}
