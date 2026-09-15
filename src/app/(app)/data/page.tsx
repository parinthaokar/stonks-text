import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetAvatar } from "@/components/asset-avatar";
import { EquityChart, type EquityPointRow } from "@/components/charts/equity-chart";
import { MagnitudeBar } from "@/components/charts/magnitude-bar";
import { Sparkline } from "@/components/charts/sparkline";
import { loadAppData, portfolio } from "@/lib/app-data";
import { simulate, summarize, equalWeightBuyAndHold } from "@/lib/portfolio";
import { runStrategy, loadModelPredictions } from "@/lib/strategies";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RULE_META, type RuleId, type Tone } from "@/lib/messages/rules";
import { currency, percent, pnlColor, signedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function DataPage() {
  const data = await loadAppData();
  const view = portfolio(data);
  const from = data.windowStart;
  const to = data.sim.simDate;

  // ---- the three curves -----------------------------------------------------
  // The coin flip runs the same message stream through a strategy that ignores
  // what the message said. It is the null hypothesis: if the user's curve only
  // matches this, then any edge came from being active in a rising market
  // rather than from the rules engine.
  const visibleMessages = data.messages.filter((m) => m.date <= to);
  const coinflipTrades = runStrategy(
    "coinflip",
    visibleMessages.map((m) => ({
      ticker: m.ticker, date: m.date, tone: m.tone as Tone, rule: m.rule as RuleId,
      text: m.body, priority: m.priority, pctChange: m.pctChange,
      volumeRatio: m.volumeRatio, close: m.close,
    })),
    data.lookup,
  );
  const coinflipCurve = simulate(coinflipTrades, data.sim.startingCash, data.lookup, { from, to }).curve;

  // The deployed model, plotted as a fourth strategy. Predictions were exported
  // offline by ml/build_pipeline.py from the same fitted pipeline the API serves
  // -- charting it from live HTTP would be ~900 requests per page load.
  let modelCurve = coinflipCurve;
  let modelAvailable = false;
  try {
    const file = JSON.parse(
      readFileSync(join(process.cwd(), "data", "ml", "predictions.json"), "utf8"),
    ) as { predictions: Record<string, string> };
    loadModelPredictions(file.predictions);
    const modelTrades = runStrategy(
      "model",
      visibleMessages.map((m) => ({
        ticker: m.ticker, date: m.date, tone: m.tone as Tone, rule: m.rule as RuleId,
        text: m.body, priority: m.priority, pctChange: m.pctChange,
        volumeRatio: m.volumeRatio, close: m.close,
      })),
      data.lookup,
    );
    modelCurve = simulate(modelTrades, data.sim.startingCash, data.lookup, { from, to }).curve;
    modelAvailable = true;
  } catch {
    // Predictions not exported yet; the chart simply omits the line.
  }
  const benchCurve = equalWeightBuyAndHold(data.sim.startingCash, data.lookup, { from, to });

  const byDate = new Map<string, EquityPointRow>();
  for (const p of view.curve) byDate.set(p.date, { date: p.date, you: p.totalValue, benchmark: 0, coinflip: 0, model: 0 });
  for (const p of benchCurve) { const r = byDate.get(p.date); if (r) r.benchmark = p.totalValue; }
  for (const p of coinflipCurve) { const r = byDate.get(p.date); if (r) r.coinflip = p.totalValue; }
  for (const p of modelCurve) { const r = byDate.get(p.date); if (r) r.model = p.totalValue; }
  const equityRows = [...byDate.values()];

  const strategies = [
    { name: "Your trades", summary: summarize(view.curve), color: "var(--viz-1)" },
    { name: "Buy & hold", summary: summarize(benchCurve), color: "var(--viz-2)" },
    { name: "Coin flip", summary: summarize(coinflipCurve), color: "var(--viz-3)" },
    ...(modelAvailable
      ? [{ name: "Model", summary: summarize(modelCurve), color: "var(--viz-4)" }]
      : []),
  ];

  // ---- per-asset volatility -------------------------------------------------
  const volatility = data.assets
    .map((a) => {
      const bars = (data.prices[a.ticker] ?? []).filter((b) => b.date >= from && b.date <= to);
      const returns: number[] = [];
      for (let i = 1; i < bars.length; i++) {
        if (bars[i - 1].close > 0) returns.push((bars[i].close - bars[i - 1].close) / bars[i - 1].close);
      }
      const mean = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length > 1 ? returns.length - 1 : 1);
      // Annualised with the conventional 252-session factor.
      return { label: a.ticker, value: Math.sqrt(variance) * Math.sqrt(252) * 100 };
    })
    .sort((a, b) => b.value - a.value);

  // ---- message mix ----------------------------------------------------------
  const ruleIds = Object.keys(RULE_META) as RuleId[];
  const mix = ruleIds
    .map((r) => ({ label: RULE_META[r].label, value: visibleMessages.filter((m) => m.rule === r).length }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  // ---- small multiples ------------------------------------------------------
  // Every asset rebased to 100 on the first day of the window, so a $77,000
  // bitcoin and a $200 share of Apple can be compared by shape.
  const normalized = data.assets.map((a) => {
    const bars = (data.prices[a.ticker] ?? []).filter((b) => b.date >= from && b.date <= to);
    const base = bars[0]?.close ?? 0;
    const values = base > 0 ? bars.map((b) => (b.close / base) * 100) : [];
    const change = values.length > 1 ? values[values.length - 1] - 100 : 0;
    return { asset: a, values, change };
  }).sort((a, b) => b.change - a.change);

  const tradesPlaced = data.trades.filter((t) => t.action !== "hold").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Data</h1>
        <p className="text-sm text-muted-foreground">
          {from} to {to} · {data.assets.length} assets · {visibleMessages.length} messages generated ·{" "}
          {tradesPlaced} trades placed
        </p>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Your trades vs buy &amp; hold</CardTitle>
          <CardDescription>
            Portfolio value over the sim window. Buy &amp; hold splits{" "}
            {currency(data.sim.startingCash)} evenly across every asset on day one and never trades
            again. Coin flip trades on the same days as you but ignores what the message said — it is
            the control for &ldquo;does reading the texts actually help?&rdquo;
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <EquityChart data={equityRows} />

          {/* The table is not decoration: it carries the same numbers in text,
              which is what makes the chart readable without relying on colour. */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead className="text-right">End value</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  <TableHead className="text-right">Max drawdown</TableHead>
                  <TableHead className="text-right">Volatility</TableHead>
                  <TableHead className="text-right">Sharpe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {strategies.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{currency(s.summary.endValue)}</TableCell>
                    <TableCell className={cn("text-right font-medium tabular-nums", pnlColor(s.summary.totalReturnPct))}>
                      {signedPercent(s.summary.totalReturnPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{percent(s.summary.maxDrawdownPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{percent(s.summary.volatilityPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.summary.sharpe.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Sharpe assumes a 0% risk-free rate. Volatility and Sharpe are annualised with the
            conventional 252-session factor. Trades fill at the close of the next session the asset
            actually trades, not the close that generated the message — acting on a closing price you
            couldn&apos;t have known yet would flatter these results.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Annualised volatility</CardTitle>
            <CardDescription>
              Standard deviation of daily returns over the window. This is what decides which assets
              text you constantly and which barely speak.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MagnitudeBar
              data={volatility}
              valueLabel="Annualised volatility"
              unit="%"
              height={400}
            />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">What they talked about</CardTitle>
            <CardDescription>
              Which rule fired, across all {visibleMessages.length} generated messages. Every message
              has exactly one rule — the engine evaluates them in priority order and the first match
              wins.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MagnitudeBar
              data={mix}
              valueLabel="Messages"
              height={400}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Price history, rebased to 100</CardTitle>
          <CardDescription>
            Each asset indexed to 100 on {from} so a $77,000 bitcoin and a $200 share of Apple can be
            compared by shape. Twelve series on one axis would need twelve distinguishable colours,
            which is more than exist — so they get twelve panels instead.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {normalized.map(({ asset, values, change }) => (
              <div key={asset.ticker}>
                <div className="mb-1.5 flex items-center gap-2">
                  <AssetAvatar ticker={asset.ticker} color={asset.color} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{asset.ticker}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{asset.name}</p>
                  </div>
                  <span className={cn("shrink-0 text-xs font-medium tabular-nums", pnlColor(change))}>
                    {signedPercent(change)}
                  </span>
                </div>
                <Sparkline values={values} color={asset.color} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
