"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { TrendingDown, Minus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { placeTrade } from "@/app/actions";
import { currency } from "@/lib/format";
import { TRADE_SIZES, TRADE_SIZE_COOKIE, type TradeSize } from "@/lib/config";
import { cn } from "@/lib/utils";
import { setPreferenceCookie } from "@/lib/client-cookies";

/**
 * The reply bar: pick a size, then answer with one of three buttons.
 *
 * Still no free text input -- the size is a small set of presets rather than an
 * amount field, so the interaction stays "tap an answer" rather than becoming a
 * trade ticket.
 *
 * The chosen size is remembered in a cookie rather than local state, because
 * this component remounts every time you switch threads and having the size
 * snap back to the default mid-session is maddening. A cookie also means the
 * server renders the same value the client hydrates with -- localStorage would
 * need an effect and would flash the wrong size on first paint.
 */
export function TradeActions({
  assetId, messageId, ticker, initialSize, cash, positionValue, tradeable,
}: {
  assetId: number;
  messageId: number | null;
  ticker: string;
  initialSize: TradeSize;
  cash: number;
  positionValue: number;
  tradeable: boolean;
}) {
  const [pending, start] = useTransition();
  const [size, setSize] = useState<TradeSize>(initialSize);

  function chooseSize(next: TradeSize) {
    setSize(next);
    // A UI preference, so it's written client-side: a server round trip per tap
    // would make the selector feel broken. The server re-validates the size on
    // every trade anyway, so a tampered cookie buys nothing.
    setPreferenceCookie(TRADE_SIZE_COOKIE, String(next));
  }

  function reply(action: "sell" | "hold" | "buy") {
    start(async () => {
      const res = await placeTrade(assetId, messageId, action, size);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  const holdsSomething = positionValue > 0.005;
  const buyAmount = size === "max" ? cash : size;
  const canBuy = buyAmount >= 1 && buyAmount <= cash + 1e-9;

  const sellLabel = size === "max" ? "Sell all" : `Sell ${currency(size, { decimals: 0 })}`;
  const buyLabel = size === "max" ? "Buy max" : `Buy ${currency(size, { decimals: 0 })}`;

  return (
    <div className="border-t bg-background/95 p-3 backdrop-blur">
      {!tradeable && (
        <p className="mb-2 text-center text-xs text-muted-foreground">
          {ticker} didn&apos;t trade today — markets are closed. Advance the clock to reply.
        </p>
      )}

      {/* Size picker */}
      <div className="mx-auto mb-2 flex max-w-3xl items-center justify-center gap-1">
        <span className="mr-1 text-[11px] text-muted-foreground">Size</span>
        {[...TRADE_SIZES, "max" as const].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => chooseSize(s)}
            aria-pressed={size === s}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors",
              size === s
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {s === "max" ? "Max" : currency(s, { decimals: 0 })}
          </button>
        ))}
      </div>

      <div className="mx-auto flex max-w-3xl gap-2">
        <Button
          variant="outline" className="flex-1 transition-transform active:scale-[0.97]"
          disabled={pending || !tradeable || !holdsSomething}
          onClick={() => reply("sell")}
        >
          <TrendingDown className="text-red-600 dark:text-red-400" />
          {sellLabel}
        </Button>
        <Button
          variant="outline" className="flex-1 transition-transform active:scale-[0.97]"
          disabled={pending || !tradeable}
          onClick={() => reply("hold")}
        >
          <Minus /> Hold
        </Button>
        <Button
          variant="outline" className="flex-1 transition-transform active:scale-[0.97]"
          disabled={pending || !tradeable || !canBuy}
          onClick={() => reply("buy")}
        >
          <TrendingUp className="text-emerald-600 dark:text-emerald-400" />
          {buyLabel}
        </Button>
      </div>

      <p className="mt-2 text-center text-[11px] text-muted-foreground tabular-nums">
        {currency(cash)} cash
        {holdsSomething && ` · ${currency(positionValue)} in ${ticker}`}
        {!canBuy && cash >= 1 && ` · not enough cash for ${currency(buyAmount, { decimals: 0 })}`}
        {cash < 1 && " · out of cash"}
        {holdsSomething && size !== "max" && positionValue < size &&
          ` · selling ${currency(size, { decimals: 0 })} closes the position`}
      </p>
    </div>
  );
}
