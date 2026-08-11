import { prisma } from "@/server/db";
import { env } from "@/lib/env";
import { AppError, toAppError } from "@/lib/errors";
import { MemoryStore } from "@/lib/memory/memory-store";
import { loadWorkflowDefinition } from "@/server/repositories/workflow-repo";
import type { RunBudget } from "@/types/run";
import { truncate } from "@/lib/utils";
import { BudgetTracker, resolveBudget } from "./budget";
import { RunEventBus } from "./event-bus";
import { runWorkflow } from "./engine";
import { createInitialState, snapshotState } from "./state";

/**
 * Run orchestrator — the boundary between HTTP and the engine.
 *
 * Architecture decision: POST /run returns a runId immediately and the
 * execution continues elsewhere, writing every event to the RunEvent table.
 * The client subscribes over SSE, which is just a cursor over that table.
 *
 * Trade-off: ~250ms of polling latency per event and one extra table, in
 * exchange for three properties an in-memory stream cannot give us — the run
 * survives the request being aborted, the timeline is fully replayable after
 * the fact, and it works unchanged behind multiple instances where the reader
 * is never the process that wrote the event.
 *
 * Two dispatch modes share the exact same `executeRun`:
 *   - RUN_QUEUE_ENABLED=false (default, dev): fire-and-forget in the web
 *     process. Zero setup, but a restart kills the run.
 *   - RUN_QUEUE_ENABLED=true (production): pushed to pg-boss and executed by
 *     `npm run worker`, so deploys and crashes no longer lose work.
 */
export interface StartRunParams {
  workspaceId: string;
  workflowId: string;
  userId?: string;
  input: string;
  variables?: Record<string, unknown>;
  budget?: Partial<RunBudget>;
}

export async function startWorkflowRun(params: StartRunParams): Promise<{ runId: string }> {
  const { workspaceId, workflowId, userId, input } = params;

  // Validate the graph before promising the user a run.
  const definition = await loadWorkflowDefinition(workspaceId, workflowId);
  if (definition.nodes.filter((n) => n.kind === "AGENT" && n.agent).length === 0) {
    throw new AppError("VALIDATION", "Add at least one agent node before running this workflow.");
  }

  const run = await prisma.workflowRun.create({
    data: {
      workspaceId,
      workflowId,
      triggeredById: userId,
      input,
      status: "QUEUED",
    },
  });

  if (env.RUN_QUEUE_ENABLED) {
    // Imported lazily so the queue driver is never loaded (or required) in
    // deployments that run single-process.
    const { enqueueRun } = await import("@/server/queue/run-queue");
    try {
      await enqueueRun({ ...params, runId: run.id });
      return { runId: run.id };
    } catch (err) {
      // If the queue is unreachable we fail loudly rather than silently running
      // in-process: the operator asked for durability and should get it.
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: "FAILED", error: "Could not enqueue run.", completedAt: new Date() },
      });
      throw toAppError(err);
    }
  }

  // Fire-and-forget. The catch is mandatory: an unhandled rejection here would
  // take the whole Node process down and lose every concurrent run.
  void executeRun({ ...params, runId: run.id }).catch((err) => {
    console.error(`[run ${run.id}] unhandled failure`, err);
  });

  return { runId: run.id };
}

/**
 * Watch for a cancellation issued by another process.
 *
 * With a separate worker, DELETE /api/runs/:id can no longer reach the
 * in-memory AbortSignal that owns the execution. The database row is the one
 * thing both processes share, so we poll it and translate a CANCELLED status
 * into a real abort. Cheap: one indexed lookup every few seconds.
 */
function watchForCancellation(runId: string, budget: BudgetTracker): () => void {
  const timer = setInterval(() => {
    void prisma.workflowRun
      .findUnique({ where: { id: runId }, select: { status: true } })
      .then((row) => {
        if (row?.status === "CANCELLED") budget.cancel("Run cancelled by user");
      })
      .catch(() => undefined);
  }, env.RUN_CANCEL_POLL_MS);

  // Never keep the process alive just for this poller.
  timer.unref?.();
  return () => clearInterval(timer);
}

export async function executeRun(params: StartRunParams & { runId: string }): Promise<void> {
  const { runId, workspaceId, workflowId, userId, input, variables } = params;
  const bus = new RunEventBus(runId);
  const startedAt = Date.now();

  let budget: BudgetTracker | null = null;
  let stopWatching: (() => void) | null = null;

  try {
    const definition = await loadWorkflowDefinition(workspaceId, workflowId);
    budget = new BudgetTracker(resolveBudget(definition.budget, params.budget));
    stopWatching = watchForCancellation(runId, budget);

    await prisma.workflowRun.update({ where: { id: runId }, data: { status: "RUNNING" } });

    bus.emit("run.started", {
      runId,
      workflowId,
      workflowName: definition.name,
      executionMode: definition.executionMode,
      input: truncate(input, 1000),
      nodes: definition.nodes
        .filter((n) => n.agent)
        .map((n) => ({ id: n.id, label: n.label, agentName: n.agent!.name, model: n.agent!.model })),
      limits: budget.limits,
    });

    const state = createInitialState({ runId, workflowId, task: input, variables });
    const memory = new MemoryStore(workspaceId, workflowId, userId);

    const result = await runWorkflow({
      workflow: definition,
      state,
      budget,
      bus,
      runId,
      workspaceId,
      memory,
    });

    const finalText = result.finalText ?? result.finalOutput?.text ?? "";
    const usage = budget.usage();
    const durationMs = Date.now() - startedAt;

    await prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: "COMPLETED",
        output: finalText,
        finalState: snapshotState(state) as unknown as object,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        estimatedCost: usage.costUsd,
        stepCount: usage.steps,
        toolCallCount: usage.toolCalls,
        completedAt: new Date(),
        durationMs,
      },
    });

    // Persist the run's conclusion as workflow memory so later runs of the same
    // workflow can build on it. Only the final answer — storing intermediate
    // chatter would poison future context.
    if (finalText) {
      await new MemoryStore(workspaceId, workflowId, userId).remember({
        scope: "WORKFLOW",
        key: truncate(input, 120),
        value: { task: input, answer: truncate(finalText, 4000) },
        runId,
        weight: 1,
      });
    }

    bus.emit("run.completed", {
      runId,
      durationMs,
      output: truncate(finalText, 2000),
      usage,
    });
  } catch (err) {
    const appErr = toAppError(err);
    const usage = budget?.usage();
    const durationMs = Date.now() - startedAt;

    await prisma.workflowRun
      .update({
        where: { id: runId },
        data: {
          status: appErr.code === "CANCELLED" ? "CANCELLED" : "FAILED",
          error: appErr.message,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          totalTokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
          estimatedCost: usage?.costUsd ?? 0,
          stepCount: usage?.steps ?? 0,
          toolCallCount: usage?.toolCalls ?? 0,
          completedAt: new Date(),
          durationMs,
        },
      })
      .catch(() => undefined);

    bus.emit(appErr.code === "CANCELLED" ? "run.cancelled" : "run.failed", {
      runId,
      code: appErr.code,
      error: appErr.message,
      durationMs,
    });
  } finally {
    stopWatching?.();
    // Guarantees the terminal event is written before the process may idle out.
    await bus.flush();
  }
}
