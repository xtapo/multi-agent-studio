"use client";

import Link from "next/link";
import { useState } from "react";
import { Bot, ExternalLink, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AgentSummary } from "./types";

/**
 * Left pane. Agents are added by drag & drop (HTML5 DnD carries the agent id)
 * or by clicking, which drops the node in the middle of the viewport.
 */
export function AgentLibrary({
  agents,
  onAdd,
}: {
  agents: AgentSummary[];
  onAdd: (agent: AgentSummary | null) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = agents.filter((a) =>
    `${a.name} ${a.role}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="space-y-2 border-b border-border p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agent library</p>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="pl-8" />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => onAdd(null)}>
          <Plus /> Empty node
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {filtered.map((agent) => (
          <div
            key={agent.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/mas-agent", agent.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAdd(agent)}
            className="cursor-grab rounded-lg border border-border bg-background p-2.5 transition-colors hover:border-primary/50 active:cursor-grabbing"
          >
            <div className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <p className="truncate text-sm font-medium">{agent.name}</p>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{agent.role}</p>
            <Badge variant="outline" className="mt-1.5">
              {agent.model.split(":")[1] ?? agent.model}
            </Badge>
          </div>
        ))}
        {filtered.length === 0 ? <p className="text-xs text-muted-foreground">No matching agents.</p> : null}
      </div>

      <div className="border-t border-border p-3">
        <Button asChild variant="ghost" size="sm" className="w-full">
          <Link href="/agents/new" target="_blank">
            <ExternalLink /> Create new agent
          </Link>
        </Button>
      </div>
    </aside>
  );
}
