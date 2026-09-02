import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AssetAvatar } from "@/components/asset-avatar";
import { loadBacktestStats } from "@/lib/backtest-stats";
import { currency, signedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Landing() {
  const stats = loadBacktestStats();
  const reactive = stats?.strategies["Reactive"];
  const hold = stats?.strategies["Buy & hold (equal weight)"];
  const edge =
    reactive && hold ? reactive.totalReturnPct - hold.totalReturnPct : null;

  return (
    <main className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background">
            $
          </span>
          <span className="text-sm font-semibold">Stonks &amp; Texts</span>
        </div>
        <Button asChild size="sm">
          <Link href="/messages">
            Open app <ArrowRight />
          </Link>
        </Button>
      </header>

      <section className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <Badge variant="secondary" className="mb-4 font-normal">
            {stats ? `${stats.assets} assets · real market data` : "Real market data"}
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Your stocks are
            <br />
            texting you again.
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-muted-foreground">
            Every asset in your portfolio has opinions about its own price, and it will not stop
            sharing them. Reply with one tap — sell it, hold, buy more — and find out whether
            reacting actually beats sitting on your hands.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/messages">
                Open app <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/data">See the backtest</Link>
            </Button>
          </div>

          {stats && reactive && hold && edge !== null && (
            <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-7 sm:grid-cols-4">
              <Stat
                label="Following the texts"
                value={signedPercent(reactive.totalReturnPct)}
                accent={reactive.totalReturnPct >= 0}
              />
              <Stat label="Buy &amp; hold" value={signedPercent(hold.totalReturnPct)} />
              <Stat label="Starting balance" value={currency(stats.starting_cash)} />
              <Stat label="Texts generated" value={stats.messages.toLocaleString()} />
            </dl>
          )}

          {stats && edge !== null && (
            <p className="mt-4 text-xs text-muted-foreground">
              Over {stats.window.from} to {stats.window.to}, replying to every text beat equal-weight
              buy-and-hold by {edge >= 0 ? "+" : ""}
              {edge.toFixed(1)} points. Fills use the next session&apos;s close, so nothing here
              trades on a price it couldn&apos;t have known.{" "}
              <Link href="/data" className="underline underline-offset-2">
                Check the working
              </Link>
              .
            </p>
          )}
        </div>

        {/* Preview thread: the same bubble and receipt components the app uses. */}
        <Card className="shadow-none">
          <CardContent className="space-y-3 p-5">
            <p className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
              Fri, Mar 13, 2026
            </p>

            <PreviewIncoming
              ticker="TSLA" color="#FF375F"
              body="hey. so. we need to talk. i'm down 7.4% today."
              rule="Big drop" pct={-7.4} vol={2.1}
            />
            <PreviewReply action="sell" label="sold $500.00" />
            <PreviewIncoming
              ticker="NVDA" color="#30D158"
              body="UP 6.2% TODAY. UP. 6.2. PERCENT. i need you to react to this."
              rule="Big gain" pct={6.2} vol={1.8}
            />
            <PreviewReply action="buy" label="bought $500.00" />
            <PreviewIncoming
              ticker="BTC-USD" color="#F7931A"
              body="volume's 3.3x normal today. everyone is talking about me. i don't know what they know."
              rule="Volume spike" pct={0.4} vol={3.3}
            />

            <div className="flex gap-2 border-t pt-3">
              <FakeButton icon={<TrendingDown className="size-3.5 text-red-600" />} label="Sell it" />
              <FakeButton icon={<Minus className="size-3.5" />} label="Hold" />
              <FakeButton icon={<TrendingUp className="size-3.5 text-emerald-600" />} label="Buy more" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="border-t bg-muted/30">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-14 sm:grid-cols-3">
          <How
            step="1"
            title="The data is real"
            body={`Two years of daily OHLCV for ${stats?.assets ?? 12} stocks and coins, split- and dividend-adjusted. No live API calls — the dataset is committed, so every run is reproducible.`}
          />
          <How
            step="2"
            title="The personality is a rules engine"
            body="Eight deterministic rules map the day's move, volume and streaks to a tone. Same prices in, same texts out, every time. No random flavour text."
          />
          <How
            step="3"
            title="The verdict is a backtest"
            body="Your ledger is plotted against equal-weight buy-and-hold and a coin flip that trades on the same days but ignores what the text said."
          />
        </div>
      </section>

      <footer className="border-t px-6 py-6 text-center text-xs text-muted-foreground">
        Paper trading with fake money on historical data. Not investment advice — obviously.
      </footer>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums tracking-tight",
          accent && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function PreviewIncoming({
  ticker, color, body, rule, pct, vol,
}: {
  ticker: string; color: string; body: string; rule: string; pct: number; vol: number;
}) {
  return (
    <div className="flex items-end gap-2">
      <AssetAvatar ticker={ticker} color={color} size="sm" className="mb-5" />
      <div className="flex max-w-[85%] flex-col items-start gap-1">
        <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm leading-snug">{body}</div>
        <div className="flex items-center gap-1.5 pl-1 text-[10px] text-muted-foreground">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">{rule}</Badge>
          <span className="tabular-nums">{signedPercent(pct)}</span>
          <span>·</span>
          <span className="tabular-nums">{vol.toFixed(1)}× vol</span>
        </div>
      </div>
    </div>
  );
}

function PreviewReply({ action, label }: { action: "buy" | "sell"; label: string }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "rounded-2xl rounded-br-sm px-3.5 py-2 text-sm font-medium text-white",
          action === "buy" ? "bg-emerald-600" : "bg-red-600",
        )}
      >
        {label}
      </div>
    </div>
  );
}

function FakeButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium">
      {icon}
      {label}
    </div>
  );
}

function How({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div>
      <span className="flex size-7 items-center justify-center rounded-md border text-xs font-semibold">
        {step}
      </span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
