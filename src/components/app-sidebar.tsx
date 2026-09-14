"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, PieChart, LineChart } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar";
import { AssetAvatar } from "@/components/asset-avatar";
import { cn } from "@/lib/utils";
import { pnlColor, signedPercent } from "@/lib/format";

export interface ConversationItem {
  ticker: string;
  name: string;
  color: string;
  preview: string;
  unread: number;
  dayChangePct: number;
}

const NAV = [
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/data", label: "Data", icon: LineChart },
];

export function AppSidebar({
  conversations, simDate, sourceKind,
}: {
  conversations: ConversationItem[];
  simDate: string;
  sourceKind: "supabase" | "local";
}) {
  const pathname = usePathname();
  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <div className="flex items-center gap-2 px-1 py-1.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
            $
          </span>
          <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-semibold">Stonks &amp; Texts</span>
            <span className="truncate text-xs text-muted-foreground tabular-nums">{simDate}</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                        {item.href === "/messages" && totalUnread > 0 && (
                          <span className="ml-auto flex size-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white group-data-[collapsible=icon]:hidden">
                            {totalUnread > 99 ? "99+" : totalUnread}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Conversations</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.map((c) => {
                const href = `/messages/${encodeURIComponent(c.ticker)}`;
                const active = pathname === href;
                return (
                  <SidebarMenuItem key={c.ticker}>
                    <SidebarMenuButton
                      asChild
                      isActive={active}
                      tooltip={c.name}
                      // Taller than a nav row: this is a message preview, not a link.
                      className="h-auto items-start gap-2.5 py-2"
                    >
                      <Link href={href}>
                        <AssetAvatar ticker={c.ticker} color={c.color} size="sm" />
                        <span className="grid min-w-0 flex-1 gap-0.5 group-data-[collapsible=icon]:hidden">
                          <span className="flex items-baseline gap-1.5">
                            <span className="truncate text-xs font-semibold">{c.ticker}</span>
                            <span className={cn("ml-auto shrink-0 text-[10px] tabular-nums", pnlColor(c.dayChangePct))}>
                              {signedPercent(c.dayChangePct)}
                            </span>
                            {c.unread > 0 && <span className="size-1.5 shrink-0 rounded-full bg-red-500" />}
                          </span>
                          <span className={cn(
                            "truncate text-[11px] leading-tight",
                            c.unread > 0 ? "font-medium text-foreground" : "text-muted-foreground",
                          )}>
                            {c.preview}
                          </span>
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t">
        <p className="px-2 py-1 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          {sourceKind === "supabase" ? "Live from Supabase" : "Local dataset (no DB configured)"}
        </p>
      </SidebarFooter>
    </Sidebar>
  );
}
