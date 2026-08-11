"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Ban, Radio, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { formatCost, formatDuration, formatNumber, relativeTime } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StepCard, type StepView } from "./step-card";
import { useRunStream } from "./use-run-stream";

export interface RunDetail {
  id: string;
  workflow: { id: string; name: string };
  input: string;
  output: string | null;
  status: string;
  error: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  stepCount: number;
  toolCallCount: number;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  steps: StepView[];
}

const LIVE = new Set(["QUEUED", "RUNNING"]);

/**
 * Realtime execution viewer.
 *
 * Strategy: the SSE stream is the *signal*, not the source of truth. Whenever a
 * step-level event arrives we refetch the run detail. That keeps the rendered
 * state exactly consistent with the database (no client-side event reducer to
 * drift), while still updating within a few hundred milliseconds.
 */
export function RunViewer({ initial }: { initial: RunDetail }) {
  const [run, setRun] = useState(initial);
  const live = LIVE.has(run.status);
  const { events, connected } = useRunStream(run.id, live);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ run: RunDetail }>(`/api/runs/${run.id}`);
      setRun(data.run);
    } catch {
      /* transient; the next event triggers another refresh */
    }
  }, [run.id]);

  const lastSeq = events.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (lastSeq > 0) void refresh();
  }, [lastSeq, refresh]);

  // Safety net in case the stream is blocked by a proxy that buffers SSE.
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [live, refresh]);

  async function cancel() {
    try {
      await api.delete(`/api/runs/${run.id}`);
      toast.success("Cancellation requested.");
      void refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const stats = useMemo(
    () => [
      { label: "Status", value: run.status.toLowerCase() },
      { label: "Steps", value: String(run.steps.length) },
      { label: "Tokens", value: formatNumber(run.totalTokens) },
      { label: "Cost", value: formatCost(run.estimatedCost) },
      { label: "Duration", value: run.durationMs ? formatDuration(run.durationMs) : live ? "running" : "—" },
    ],
    [live, run],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/workflows/${run.workflow.id}`} className="text-lg font-semibold hover:text-primary">
              {run.workflow.name}
            </Link>
            <Badge variant={statusVariant(run.status)}>{run.status.toLowerCase()}</Badge>
            {live && connected ? (
              <span className="inline-flex items-center gap-1 text-xs text-[hsl(var(--success))]">
                <Radio className="h-3 w-3 animate-pulse" /> live
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Started {relativeTime(run.startedAt)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw /> Refresh
          </Button>
          {live ? (
            <Button variant="outline" size="sm" className="text-destructive" onClick={cancel}>
              <Ban /> Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Task</p>
          <p className="whitespace-pre-wrap text-sm">{run.input}</p>
        </CardContent>
      </Card>

      {run.error ? (
        <Card className="border-destructive/40">
          <CardContent className="p-5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-destructive">Run failed</p>
            <p className="text-sm text-destructive">{run.error}</p>
          </CardContent>
        </Card>
      ) : null}

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</p>
        {run.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">Waiting for the first agent to start…</p>
        ) : (
          run.steps.map((step) => (
            <StepCard key={step.id} step={step} defaultOpen={step.status === "FAILED"} />
          ))
        )}
      </div>

      {run.output ? (
        <Card>
          <CardContent className="p-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Final result</p>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{run.output}</div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
