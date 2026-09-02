import { Badge } from "@/components/ui/badge";
import { AssetAvatar } from "@/components/asset-avatar";
import { cn } from "@/lib/utils";
import { longDate, signedPercent, currency } from "@/lib/format";
import { RULE_META, type RuleId } from "@/lib/messages/rules";
import type { ReactionMood } from "@/lib/messages/reactions";

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

/** The asset answering back. Derived at render time, never stored. */
export interface ThreadReaction {
  kind: "reaction";
  id: number;
  date: string;
  body: string;
  mood: ReactionMood;
}

export type ThreadItem = ThreadMessage | ThreadReply | ThreadReaction;

/** How many trailing bubbles get an entrance animation. */
const ANIMATED_TAIL = 8;

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
          {ticker} hasn&apos;t sent anything yet. Press play and it will.
        </p>
      </div>
    );
  }

  const rows = items.map((item, i) => ({
    item,
    showDate: i === 0 || items[i - 1].date !== item.date,
    // Only the tail animates; a hundred bubbles sliding in is noise.
    animIndex: i >= items.length - ANIMATED_TAIL ? i - (items.length - ANIMATED_TAIL) : -1,
    isLast: i === items.length - 1,
  }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-1 p-4 pb-8">
      {rows.map(({ item, showDate, animIndex, isLast }) => {
        const anim = animIndex >= 0;
        // Stagger the tail so it cascades instead of arriving as a block.
        const delay = anim ? `${animIndex * 45}ms` : undefined;

        return (
          <div key={`${item.kind}-${item.id}`} className="contents">
            {showDate && (
              <div className="py-3 text-center text-[11px] font-medium text-muted-foreground">
                {longDate(item.date)}
              </div>
            )}

            {item.kind === "message" ? (
              <IncomingBubble item={item} ticker={ticker} color={color} anim={anim} delay={delay} />
            ) : item.kind === "reply" ? (
              <ReplyBubble item={item} anim={anim} delay={delay} />
            ) : (
              <ReactionBubble
                item={item} ticker={ticker} color={color}
                anim={anim} delay={delay}
                // Only the newest reaction gets the typing beat -- replaying it
                // on every bubble in the backlog would be absurd.
                showTyping={isLast}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function IncomingBubble({
  item, ticker, color, anim, delay,
}: {
  item: ThreadMessage; ticker: string; color: string; anim: boolean; delay?: string;
}) {
  const meta = RULE_META[item.rule as RuleId];

  return (
    <div
      className={cn("mb-2 flex items-end gap-2", anim && "animate-bubble-in")}
      style={{ animationDelay: delay }}
    >
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

function ReplyBubble({ item, anim, delay }: { item: ThreadReply; anim: boolean; delay?: string }) {
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
    <div
      className={cn("mb-2 flex flex-col items-end gap-1", anim && "animate-bubble-in")}
      style={{ animationDelay: delay }}
    >
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

function ReactionBubble({
  item, ticker, color, anim, delay, showTyping,
}: {
  item: ThreadReaction; ticker: string; color: string;
  anim: boolean; delay?: string; showTyping: boolean;
}) {
  // The newest reaction waits behind a typing indicator so the asset feels like
  // it's answering rather than pre-empting you. Pure CSS timing -- no client
  // state, so it survives a server re-render without flickering.
  const TYPING_MS = 900;
  const reactionDelay = showTyping ? `${TYPING_MS}ms` : delay;

  return (
    <>
      {showTyping && (
        <div className="animate-typing-out mb-2 flex items-end gap-2">
          <AssetAvatar ticker={ticker} color={color} size="sm" />
          <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-muted px-3.5 py-3">
            <span className="typing-dot size-1.5 rounded-full bg-foreground/60" />
            <span className="typing-dot size-1.5 rounded-full bg-foreground/60" />
            <span className="typing-dot size-1.5 rounded-full bg-foreground/60" />
          </div>
        </div>
      )}

      <div
        className={cn("mb-2 flex items-end gap-2", (anim || showTyping) && "animate-bubble-in")}
        style={{ animationDelay: reactionDelay }}
      >
        <AssetAvatar ticker={ticker} color={color} size="sm" />
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm leading-snug">
          {item.body}
        </div>
      </div>
    </>
  );
}
