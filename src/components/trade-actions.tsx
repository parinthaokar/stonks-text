"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { TrendingDown, Minus, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { placeTrade } from "@/app/actions";
import { currency } from "@/lib/format";

/**
 * The three reply buttons. No free text input -- the entire interaction model
 * is "the asset texts you, you tap one of three answers".
 */
export function TradeActions({
  assetId, messageId, ticker, betSize, canSell, canBuy, tradeable,
}: {
  assetId: number;
  messageId: number | null;
  ticker: string;
  betSize: number;
  canSell: boolean;
  canBuy: boolean;
  tradeable: boolean;
}) {
  const [pending, start] = useTransition();

  function reply(action: "sell" | "hold" | "buy") {
    start(async () => {
      const res = await placeTrade(assetId, messageId, action);
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    });
  }

  return (
    <div className="border-t bg-background/95 p-3 backdrop-blur">
      {!tradeable && (
        <p className="mb-2 text-center text-xs text-muted-foreground">
          {ticker} didn&apos;t trade today — markets are closed. Advance the clock to reply.
        </p>
      )}
      <div className="mx-auto flex max-w-3xl gap-2">
        <Button
          variant="outline" className="flex-1 transition-transform active:scale-[0.97]" disabled={pending || !tradeable || !canSell}
          onClick={() => reply("sell")}
        >
          <TrendingDown className="text-red-600 dark:text-red-400" />
          Sell it
        </Button>
        <Button
          variant="outline" className="flex-1 transition-transform active:scale-[0.97]" disabled={pending || !tradeable}
          onClick={() => reply("hold")}
        >
          <Minus /> Hold
        </Button>
        <Button
          variant="outline" className="flex-1 transition-transform active:scale-[0.97]" disabled={pending || !tradeable || !canBuy}
          onClick={() => reply("buy")}
        >
          <TrendingUp className="text-emerald-600 dark:text-emerald-400" />
          Buy more
        </Button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Each tap trades {currency(betSize)} at today&apos;s close
        {!canBuy && " · not enough cash to buy"}
        {!canSell && canBuy && ` · you don't own any ${ticker}`}
      </p>
    </div>
  );
}
