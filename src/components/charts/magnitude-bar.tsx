"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export interface BarRow {
  label: string;
  value: number;
}

/**
 * Horizontal bars for a single magnitude measure.
 *
 * Magnitude is one variable, so it gets ONE hue rather than a categorical
 * rainbow -- the bar length already encodes the value, and colouring each bar
 * differently would imply a category that isn't there. Values are labelled
 * directly, so no legend is needed.
 */
export function MagnitudeBar({
  data, valueLabel, unit = "", decimals = 0, height = 280,
}: {
  data: BarRow[];
  valueLabel: string;
  /** Appended to every value, e.g. "%". A formatter function can't be passed
   *  from a server component, so the shape of the number is described instead. */
  unit?: string;
  decimals?: number;
  height?: number;
}) {
  const format = (n: number) => `${n.toFixed(decimals)}${unit}`;
  const config = { value: { label: valueLabel, color: "var(--viz-seq)" } } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="w-full" style={{ height }}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 44, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          tickLine={false}
          axisLine={false}
          width={104}
          className="text-[11px]"
        />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent formatter={(v) => [format(Number(v)), valueLabel]} />}
        />
        {/* 4px rounded data-end, square against the baseline. */}
        <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            className="fill-muted-foreground text-[11px] tabular-nums"
            formatter={(v) => format(Number(v))}
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
