"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, LayoutDashboard, ListChecks, Settings, Workflow, Wrench, Menu } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-provider";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/runs", label: "Runs", icon: ListChecks },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ userName }: { userName?: string | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav className="flex-1 space-y-1 px-3">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
          <Menu />
        </Button>
        <span className="font-semibold">Multi-Agent Studio</span>
        <ThemeToggle />
      </div>
      {open ? <div className="border-b border-border py-3 md:hidden">{nav}</div> : null}

      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/50 py-4 md:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Workflow className="h-4 w-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Multi-Agent</p>
            <p className="text-xs text-muted-foreground">Studio</p>
          </div>
        </Link>

        {nav}

        <div className="mt-4 flex items-center justify-between border-t border-border px-5 pt-4">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium">{userName ?? "Signed in"}</p>
            <Link href="/api/auth/signout" className="text-xs text-muted-foreground hover:text-foreground">
              Sign out
            </Link>
          </div>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
