"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, Crown, Flag, LogIn, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { BuilderNode } from "./types";

/** Canvas card for a single agent node. Purely presentational. */
function AgentNodeComponent({ data, selected }: NodeProps<BuilderNode>) {
  const tools = data.agent?.tools.filter((t) => t.enabled) ?? [];

  return (
    <div
      className={cn(
        "w-60 rounded-xl border-2 bg-card p-3 shadow-sm transition-colors",
        selected ? "border-primary" : "border-border",
        !data.agentId && "border-dashed border-destructive/60",
      )}
    >
      <Handle type="target" position={Position.Left} />

      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {data.config.isSupervisor ? <Crown className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
          </div>
          <p className="truncate text-sm font-medium">{data.label}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {data.isEntry ? <LogIn className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> : null}
          {data.isFinal ? <Flag className="h-3.5 w-3.5 text-primary" /> : null}
        </div>
      </div>

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {data.agent?.role ?? "No agent assigned — pick one in the inspector."}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {data.agent ? <Badge variant="outline">{data.agent.model.split(":")[1] ?? data.agent.model}</Badge> : null}
        {data.config.debateRole ? <Badge variant="secondary">{data.config.debateRole.toLowerCase()}</Badge> : null}
        {data.config.routeKey ? <Badge variant="secondary">route: {data.config.routeKey}</Badge> : null}
        {tools.length ? (
          <Badge variant="secondary">
            <Wrench className="h-3 w-3" /> {tools.length}
          </Badge>
        ) : null}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export const AgentNode = memo(AgentNodeComponent);
