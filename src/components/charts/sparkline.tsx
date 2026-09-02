/**
 * One panel of the small-multiples grid.
 *
 * Twelve assets cannot share a single line chart -- categorical palettes run out
 * well before twelve, and cycling hues makes two unrelated assets look related.
 * Small multiples solve it properly: one series per panel, each panel titled
 * with its ticker, so identity never rests on colour alone.
 *
 * Hand-rolled SVG rather than a charting library: twelve chart runtimes to draw
 * twelve polylines is a lot of JavaScript for a shape, and this version needs no
 * client bundle at all.
 */
export function Sparkline({
  values, color, width = 220, height = 48,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <div style={{ height }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    // SVG y grows downward, so the value is inverted into the box.
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // A hairline at the rebased starting level (100) shows at a glance whether the
  // asset finished above or below where it began.
  const baselineY = height - pad - ((100 - min) / span) * (height - pad * 2);
  const baselineVisible = 100 >= min && 100 <= max;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-auto w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
    >
      {baselineVisible && (
        <line
          x1={0} x2={width} y1={baselineY} y2={baselineY}
          stroke="var(--viz-grid)" strokeWidth={1} strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
