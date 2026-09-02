import { Badge } from "@/components/ui/badge";
import { AssetAvatar } from "@/components/asset-avatar";
import { cn } from "@/lib/utils";
import { longDate, signedPercent, currency } from "@/lib/format";
import { RULE_META, type RuleId } from "@/lib/messages/rules";

export interface ThreadMessage {
  kind: "message";
  id: number;
  date: string;
  body: string;
  rule: string;
  pctChange: number;
  volumeRatio: number;
}

export interface ThreadReply {
  kind: "reply";
  id: number;
  date: string;
  action: "buy" | "sell" | "hold";
  notional: number;
  price: number;
  quantity: number;
}

export type ThreadItem = ThreadMessage | ThreadReply;

/**
 * The iMessage-style transcript.
 *
 * Incoming texts sit left, your replies right. Every incoming bubble carries a
 * caption with the numbers that triggered it -- the day's move, the volume
 * multiple and which rule fired. That caption is the honest part of the
 * conceit: the personality is generated, but it is generated from real data,
 * and the reader can check it against the Data tab.
 */
export function ChatThread({
  items, ticker, color,
}: {
  items: ThreadItem[];
  ticker: string;
  color: string;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          {ticker} hasn&apos;t sent anything yet. Advance the clock and it will.
        </p>
      </div>
    );
  }

  // Precomputed rather than tracked with a mutable cursor inside the map: React
  // treats reassignment during render as a bug, and it genuinely is one -- a
  // re-render would resume from a stale value.
  const rows = items.map((item, i) => ({
    item,
    showDate: i === 0 || items[i - 1].date !== item.date,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-1 p-4 pb-8">
      {rows.map(({ item, showDate }) => {
        return (
          <div key={`${item.kind}-${item.id}`} className="contents">
            {showDate && (
              <div className="py-3 text-center text-[11px] font-medium text-muted-foreground">
                {longDate(item.date)}
              </div>
            )}

            {item.kind === "message" ? (
              <IncomingBubble item={item} ticker={ticker} color={color} />
            ) : (
              <ReplyBubble item={item} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function IncomingBubble({
  item, ticker, color,
}: {
  item: ThreadMessage;
  ticker: string;
  color: string;
}) {
  const meta = RULE_META[item.rule as RuleId];

  return (
    <div className="mb-2 flex items-end gap-2">
      <AssetAvatar ticker={ticker} color={color} size="sm" className="mb-5" />
      <div className="flex max-w-[75%] flex-col items-start gap-1">
        <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm leading-snug">
          {item.body}
        </div>
        {/* The receipt: what the rules engine actually saw that day. */}
        <div className="flex flex-wrap items-center gap-1.5 pl-1 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
            {meta?.label ?? item.rule}
          </Badge>
          <span className="tabular-nums">{signedPercent(item.pctChange)}</span>
          <span>·</span>
          <span className="tabular-nums">{item.volumeRatio.toFixed(1)}× vol</span>
        </div>
      </div>
    </div>
  );
}

function ReplyBubble({ item }: { item: ThreadReply }) {
  // Replies are colour-coded the same way P&L is, so a glance down the thread
  // reads as a history of what you did, not just that you did something.
  const styles = {
    buy: "bg-emerald-600 text-white",
    sell: "bg-red-600 text-white",
    hold: "bg-neutral-500 text-white",
  } as const;

  const label =
    item.action === "hold"
      ? "held"
      : `${item.action === "buy" ? "bought" : "sold"} ${currency(item.notional)}`;

  return (
    <div className="mb-2 flex flex-col items-end gap-1">
      <div className={cn("rounded-2xl rounded-br-sm px-3.5 py-2 text-sm font-medium", styles[item.action])}>
        {label}
      </div>
      {item.action !== "hold" && (
        <span className="pr-1 text-[10px] tabular-nums text-muted-foreground">
          {item.quantity.toFixed(4)} @ {currency(item.price, { decimals: 2 })}
        </span>
      )}
    </div>
  );
}
