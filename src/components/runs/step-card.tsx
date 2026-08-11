"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { cn, formatCost, formatDuration, formatNumber } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";

export interface StepView {
  id: string;
  stepIndex: number;
  agentName: string;
  status: string;
  input: string | null;
  prompt: string | null;
  outputText: string | null;
  outputJson: unknown;
  reasoningSummary: string | null;
  toolCalls: Array<{
    id: string;
    name: string;
    input: unknown;
    output?: unknown;
    error?: string;
    ok: boolean;
    durationMs: number;
  }>;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  retryCount: number;
  error: string | null;
  errorCode: string | null;
  durationMs: number | null;
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs">
      {text}
    </pre>
  );
}

/**
 * One agent step in the timeline.
 *
 * Deliberately renders `reasoningSummary` only. The runtime never persists raw
 * chain-of-thought, so there is nothing here that could leak it.
 */
export function StepCard({ step, defaultOpen = false }: { step: StepView; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const totalTokens = step.inputTokens + step.outputTokens;

  return (
    <div className="relative pl-8">
      <span
        className={cn(
          "absolute left-[11px] top-5 h-full w-px bg-border",
        )}
      />
      <span
        className={cn(
          "absolute left-1.5 top-4 h-3 w-3 rounded-full border-2 border-background",
          step.status === "COMPLETED" && "bg-[hsl(var(--success))]",
          step.status === "RUNNING" && "animate-pulse bg-primary",
          step.status === "FAILED" && "bg-destructive",
          step.status === "PENDING" && "bg-muted-foreground/40",
          step.status === "SKIPPED" && "bg-[hsl(var(--warning))]",
        )}
      />

      <div className="mb-3 rounded-xl border border-border bg-card">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{step.agentName}</span>
              <Badge variant={statusVariant(step.status)}>{step.status.toLowerCase()}</Badge>
              {step.retryCount > 0 ? <Badge variant="warning">{step.retryCount} retries</Badge> : null}
              {step.toolCalls.length ? (
                <Badge variant="secondary">
                  <Wrench className="h-3 w-3" /> {step.toolCalls.length}
                </Badge>
              ) : null}
            </div>
            {step.reasoningSummary ? (
              <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{step.reasoningSummary}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">
            <p>{step.durationMs ? formatDuration(step.durationMs) : "—"}</p>
            <p>{formatNumber(totalTokens)} tok</p>
          </div>
        </button>

        {open ? (
          <div className="space-y-4 border-t border-border p-4">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Model: {step.model ?? "—"}</span>
              <span>In: {formatNumber(step.inputTokens)}</span>
              <span>Out: {formatNumber(step.outputTokens)}</span>
              <span>Cost: {formatCost(step.estimatedCost)}</span>
              <span>Latency: {step.durationMs ? formatDuration(step.durationMs) : "—"}</span>
            </div>

            {step.error ? (
              <Block title={`Error${step.errorCode ? ` (${step.errorCode})` : ""}`}>
                <p className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{step.error}</p>
              </Block>
            ) : null}

            {step.reasoningSummary ? (
              <Block title="Reasoning summary">
                <p className="rounded-lg bg-muted p-3 text-xs">{step.reasoningSummary}</p>
              </Block>
            ) : null}

            {step.input ? (
              <Block title="Input">
                <Pre text={step.input} />
              </Block>
            ) : null}

            {step.prompt ? (
              <Block title="System prompt">
                <Pre text={step.prompt} />
              </Block>
            ) : null}

            {step.toolCalls.length ? (
              <Block title="Tool calls">
                <div className="space-y-2">
                  {step.toolCalls.map((call) => (
                    <div key={call.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-medium">{call.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={call.ok ? "success" : "destructive"}>{call.ok ? "ok" : "failed"}</Badge>
                          <span className="text-xs text-muted-foreground">{formatDuration(call.durationMs)}</span>
                        </div>
                      </div>
                      <Pre text={JSON.stringify(call.input, null, 2)} />
                      {call.error ? (
                        <p className="mt-2 text-xs text-destructive">{call.error}</p>
                      ) : (
                        <Pre text={JSON.stringify(call.output, null, 2)} />
                      )}
                    </div>
                  ))}
                </div>
              </Block>
            ) : null}

            {step.outputJson ? (
              <Block title="Structured output">
                <Pre text={JSON.stringify(step.outputJson, null, 2)} />
              </Block>
            ) : null}

            {step.outputText ? (
              <Block title="Output">
                <Pre text={step.outputText} />
              </Block>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
