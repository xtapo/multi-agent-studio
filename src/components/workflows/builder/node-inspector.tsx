"use client";

import Link from "next/link";
import { Copy, ExternalLink, Flag, LogIn, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import type { AgentNodeData, AgentSummary, BuilderNode } from "./types";

/**
 * Right pane. Edits the *node* (its wiring and context policy), not the agent
 * itself — agent prompt/model edits live in the Agent Builder so a change is
 * shared consistently across every workflow that uses that agent.
 */
export function NodeInspector({
  node,
  agents,
  executionMode,
  onChange,
  onDelete,
  onDuplicate,
  onSetEntry,
  onSetFinal,
}: {
  node: BuilderNode | null;
  agents: AgentSummary[];
  executionMode: string;
  onChange: (patch: Partial<AgentNodeData>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetEntry: () => void;
  onSetFinal: () => void;
}) {
  if (!node) {
    return (
      <aside className="w-80 shrink-0 border-l border-border bg-card/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inspector</p>
        <p className="mt-3 text-sm text-muted-foreground">
          Select a node to configure its agent, entry/final role and how much context it receives.
        </p>
      </aside>
    );
  }

  const data = node.data;
  const policy = data.contextPolicy;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card/40">
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Node</p>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" title="Duplicate node" onClick={onDuplicate}>
              <Copy />
            </Button>
            <Button variant="ghost" size="icon" title="Delete node" className="text-destructive" onClick={onDelete}>
              <Trash2 />
            </Button>
          </div>
        </div>

        <Field label="Label">
          <Input value={data.label} onChange={(e) => onChange({ label: e.target.value })} />
        </Field>

        <Field label="Agent" hint="The prompt, model and tools come from this agent.">
          <Select
            value={data.agentId ?? ""}
            onChange={(e) => {
              const agent = agents.find((a) => a.id === e.target.value) ?? null;
              onChange({
                agentId: agent?.id ?? null,
                agent,
                label: data.label || agent?.name || "Node",
              });
            }}
          >
            <option value="">— none —</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </Select>
        </Field>

        {data.agentId ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={`/agents/${data.agentId}`} target="_blank">
              <ExternalLink /> Edit agent config
            </Link>
          </Button>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Button variant={data.isEntry ? "default" : "outline"} size="sm" onClick={onSetEntry}>
            <LogIn /> Entry
          </Button>
          <Button variant={data.isFinal ? "default" : "outline"} size="sm" onClick={onSetFinal}>
            <Flag /> Final
          </Button>
        </div>

        {/* Mode-specific wiring. Only shown where the engine actually reads it. */}
        {executionMode === "SUPERVISOR" ? (
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Supervisor</p>
              <p className="text-xs text-muted-foreground">Delegates and decides when to finish.</p>
            </div>
            <Switch
              checked={Boolean(data.config.isSupervisor)}
              onCheckedChange={(on) => onChange({ config: { ...data.config, isSupervisor: on } })}
            />
          </div>
        ) : null}

        {executionMode === "ROUTER" ? (
          <Field label="Route key" hint="The router returns one of these keys to pick this branch.">
            <Input
              value={data.config.routeKey ?? ""}
              onChange={(e) => onChange({ config: { ...data.config, routeKey: e.target.value || undefined } })}
              placeholder="research"
            />
          </Field>
        ) : null}

        {executionMode === "DEBATE" ? (
          <Field label="Debate role" hint="Order is proponent → opponent → judge → synthesizer.">
            <Select
              value={data.config.debateRole ?? ""}
              onChange={(e) =>
                onChange({
                  config: {
                    ...data.config,
                    debateRole: (e.target.value || undefined) as AgentNodeData["config"]["debateRole"],
                  },
                })
              }
            >
              <option value="">— none —</option>
              <option value="PROPONENT">Proponent</option>
              <option value="OPPONENT">Opponent</option>
              <option value="JUDGE">Judge</option>
              <option value="SYNTHESIZER">Synthesizer</option>
            </Select>
          </Field>
        ) : null}

        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Context policy</p>
          <p className="text-xs text-muted-foreground">
            Controls what this node can see. Narrow context keeps prompts cheap and stops errors from propagating.
          </p>
          {[
            { key: "includeOriginalTask" as const, label: "Original task" },
            { key: "includeUpstreamOutputs" as const, label: "Upstream outputs" },
            { key: "includeSharedNotes" as const, label: "Shared notes" },
          ].map((row) => (
            <div key={row.key} className="flex items-center justify-between">
              <span className="text-sm">{row.label}</span>
              <Switch
                checked={policy[row.key]}
                onCheckedChange={(on) => onChange({ contextPolicy: { ...policy, [row.key]: on } })}
              />
            </div>
          ))}
          <Field label="Extra instructions" hint="Appended for this node only.">
            <Textarea
              rows={3}
              value={policy.extraInstructions ?? ""}
              onChange={(e) =>
                onChange({ contextPolicy: { ...policy, extraInstructions: e.target.value || undefined } })
              }
            />
          </Field>
        </div>
      </div>
    </aside>
  );
}
