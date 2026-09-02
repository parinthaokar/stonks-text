import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar, type ConversationItem } from "@/components/app-sidebar";
import { SimClock } from "@/components/sim-clock";
import { loadAppData, conversations, nextMessageDate } from "@/lib/app-data";
import { currency } from "@/lib/format";
import { portfolio } from "@/lib/app-data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const data = await loadAppData();
  const convos = conversations(data);
  const view = portfolio(data);

  const items: ConversationItem[] = convos.map((c) => ({
    ticker: c.asset.ticker,
    name: c.asset.name,
    color: c.asset.color,
    preview: c.lastMessage?.body ?? "no messages yet",
    unread: c.unread,
    dayChangePct: c.dayChangePct,
  }));

  return (
    <TooltipProvider delayDuration={300}>
    <SidebarProvider>
      <AppSidebar conversations={items} simDate={data.sim.simDate} sourceKind={data.sourceKind} />
      <SidebarInset className="min-w-0">
        <header className="relative flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <SimClock
            simDate={data.sim.simDate}
            windowEnd={data.windowEnd}
            hasNextMessage={nextMessageDate(data) !== null}
          />
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              Cash <span className="font-medium tabular-nums text-foreground">{currency(view.cash)}</span>
            </span>
            <span className="text-muted-foreground">
              Value <span className="font-medium tabular-nums text-foreground">{currency(view.totalValue)}</span>
            </span>
          </div>
        </header>
        <div className="min-h-0 flex-1">{children}</div>
      </SidebarInset>
      <Toaster position="top-center" />
    </SidebarProvider>
    </TooltipProvider>
  );
}
