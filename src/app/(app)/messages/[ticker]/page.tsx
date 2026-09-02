import { notFound } from "next/navigation";
import { AssetAvatar } from "@/components/asset-avatar";
import { Badge } from "@/components/ui/badge";
import { ChatThread, type ThreadItem } from "@/components/chat-thread";
import { ScrollToBottom } from "@/components/scroll-to-bottom";
import { TradeActions } from "@/components/trade-actions";
import { loadAppData, portfolio } from "@/lib/app-data";
import { BET_SIZE } from "@/lib/config";
import { cn } from "@/lib/utils";
import { currency, pnlColor, signedPercent } from "@/lib/format";

export default async function ThreadPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ticker = decodeURIComponent(raw);

  const data = await loadAppData();
  const asset = data.assetByTicker.get(ticker);
  if (!asset) notFound();

  const today = data.sim.simDate;
  const view = portfolio(data);

  // Only what has happened by the sim date. Everything after it is the future.
  const messages = data.messages.filter((m) => m.assetId === asset.id && m.date <= today);
  const trades = data.trades.filter((t) => t.assetId === asset.id && t.tradeDate <= today);

  const items: ThreadItem[] = [
    ...messages.map((m) => ({
      kind: "message" as const, id: m.id, date: m.date, body: m.body,
      rule: m.rule, pctChange: m.pctChange, volumeRatio: m.volumeRatio,
    })),
    ...trades.map((t) => ({
      kind: "reply" as const, id: t.id, date: t.tradeDate, action: t.action,
      notional: t.notional, price: t.price, quantity: t.quantity,
    })),
  ].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    // Within a day the text arrives before the reply to it.
    if (a.kind !== b.kind) return a.kind === "message" ? -1 : 1;
    return a.id - b.id;
  });

  const price = data.lookup.closeOn(ticker, today);
  const bars = data.prices[ticker] ?? [];
  const idx = bars.findLastIndex((b) => b.date <= today);
  const dayChangePct =
    idx > 0 && bars[idx - 1].close > 0
      ? ((bars[idx].close - bars[idx - 1].close) / bars[idx - 1].close) * 100
      : 0;

  const position = view.positions.find((p) => p.ticker === ticker);
  const latestMessageId = messages.length > 0 ? messages[messages.length - 1].id : null;

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <AssetAvatar ticker={asset.ticker} color={asset.color} size="lg" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-semibold">{asset.name}</h1>
            <Badge variant="outline" className="h-5 text-[10px] font-normal">
              {asset.type === "crypto" ? "Crypto" : asset.category}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {asset.ticker} · {price !== null ? currency(price, { decimals: 2 }) : "—"}{" "}
            <span className={pnlColor(dayChangePct)}>{signedPercent(dayChangePct)}</span>
          </p>
        </div>

        {position && position.shares > 1e-9 && (
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Your position</p>
            <p className="text-sm font-medium tabular-nums">
              {currency(position.marketValue)}{" "}
              <span className={cn("text-xs", pnlColor(position.unrealizedPnl))}>
                {position.unrealizedPnl >= 0 ? "+" : ""}
                {currency(position.unrealizedPnl)}
              </span>
            </p>
          </div>
        )}
      </header>

      <div id="thread-scroll" className="min-h-0 flex-1 overflow-y-auto">
        <ChatThread items={items} ticker={asset.ticker} color={asset.color} />
      </div>
      <ScrollToBottom dep={`${ticker}-${today}-${items.length}`} />

      <TradeActions
        assetId={asset.id}
        messageId={latestMessageId}
        ticker={asset.ticker}
        betSize={BET_SIZE}
        canSell={Boolean(position && position.shares > 1e-9)}
        canBuy={view.cash >= BET_SIZE}
        tradeable={data.lookup.isTradeable(ticker, today)}
      />
    </div>
  );
}
