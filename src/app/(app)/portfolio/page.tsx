import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AssetAvatar } from "@/components/asset-avatar";
import { StatCard } from "@/components/stat-card";
import { loadAppData, portfolio } from "@/lib/app-data";
import { currency, pnlColor, signedCurrency, signedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default async function PortfolioPage() {
  const data = await loadAppData();
  const view = portfolio(data);

  const invested = view.positions.filter((p) => p.shares > 1e-9);
  const closed = view.positions.filter((p) => p.shares <= 1e-9 && Math.abs(p.realizedPnl) > 1e-9);
  const realizedTotal = view.positions.reduce((sum, p) => sum + p.realizedPnl, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted-foreground">
          As of {data.sim.simDate} · started with {currency(view.startingCash)} on {data.windowStart}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total value"
          value={currency(view.totalValue)}
          sub={`${currency(view.holdingsValue)} in positions`}
        />
        <StatCard label="Cash" value={currency(view.cash)} sub="uninvested" />
        <StatCard
          label="Total P&L"
          value={signedCurrency(view.totalPnl)}
          valueClassName={pnlColor(view.totalPnl)}
          sub={<span className={pnlColor(view.totalPnlPct)}>{signedPercent(view.totalPnlPct)}</span>}
        />
        <StatCard
          label="vs buy &amp; hold"
          value={`${view.edgePct >= 0 ? "+" : ""}${view.edgePct.toFixed(1)} pts`}
          valueClassName={pnlColor(view.edgePct)}
          sub={`benchmark ${signedPercent(view.benchmarkPnlPct)} · ${currency(view.benchmarkValue)}`}
        />
      </div>

      {/* The comparison the whole project exists to make. */}
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Did replying to the texts beat doing nothing?</CardTitle>
          <CardDescription>
            The benchmark splits the same {currency(view.startingCash)} evenly across all{" "}
            {data.assets.length} assets on {data.windowStart} and never trades again.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Your trades</p>
            <p className={cn("text-lg font-semibold tabular-nums", pnlColor(view.totalPnlPct))}>
              {signedPercent(view.totalPnlPct)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Buy &amp; hold</p>
            <p className={cn("text-lg font-semibold tabular-nums", pnlColor(view.benchmarkPnlPct))}>
              {signedPercent(view.benchmarkPnlPct)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Difference</p>
            <p className={cn("text-lg font-semibold tabular-nums", pnlColor(view.edgePct))}>
              {view.edgePct >= 0 ? "+" : ""}{view.edgePct.toFixed(1)} pts
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Positions</CardTitle>
          <CardDescription>
            {invested.length} open · {data.trades.filter((t) => t.action !== "hold").length} trades placed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invested.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You haven&apos;t bought anything yet. Reply to a text to open a position.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Shares</TableHead>
                    <TableHead className="text-right">Avg cost</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Unrealised</TableHead>
                    <TableHead className="text-right">Realised</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invested.map((p) => {
                    const asset = data.assetByTicker.get(p.ticker)!;
                    const pctGain = p.avgCost > 0 ? ((p.lastPrice - p.avgCost) / p.avgCost) * 100 : 0;
                    return (
                      <TableRow key={p.ticker}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <AssetAvatar ticker={p.ticker} color={asset.color} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{p.ticker}</p>
                              <p className="truncate text-xs text-muted-foreground">{asset.name}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.shares.toFixed(4)}</TableCell>
                        <TableCell className="text-right tabular-nums">{currency(p.avgCost, { decimals: 2 })}</TableCell>
                        <TableCell className="text-right tabular-nums">{currency(p.lastPrice, { decimals: 2 })}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{currency(p.marketValue)}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", pnlColor(p.unrealizedPnl))}>
                          {signedCurrency(p.unrealizedPnl)}
                          <span className="ml-1 text-xs opacity-70">{signedPercent(pctGain)}</span>
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", pnlColor(p.realizedPnl))}>
                          {Math.abs(p.realizedPnl) < 0.005 ? "—" : signedCurrency(p.realizedPnl)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {closed.length > 0 && (
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Closed out</CardTitle>
            <CardDescription>
              Sold down to nothing. Realised P&amp;L total {signedCurrency(realizedTotal)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {closed.map((p) => (
              <Badge key={p.ticker} variant="outline" className="gap-1.5 py-1">
                <span className="font-medium">{p.ticker}</span>
                <span className={pnlColor(p.realizedPnl)}>{signedCurrency(p.realizedPnl)}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
