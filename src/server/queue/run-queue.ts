import { prisma } from "@/server/db";
import { env } from "@/lib/env";
import type { RunBudget } from "@/types/run";
import { getBoss } from "./boss";

export const RUN_QUEUE = "workflow-run";

export interface RunJobData {
  runId: string;
  workspaceId: string;
  workflowId: string;
  userId?: string;
  input: string;
  variables?: Record<string, unknown>;
  budget?: Partial<RunBudget>;
}

/**
 * Hand a run to the durable queue.
 *
 * `retryLimit: 0` is deliberate. Automatically retrying a half-finished
 * multi-agent run would re-spend real money on model calls and could duplicate
 * side effects from tools. A crashed run is surfaced as failed and the user
 * decides whether to run it again — explicit and cheap beats automatic and
 * surprising.
 */
export async function enqueueRun(data: RunJobData): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(RUN_QUEUE, data, {
    retryLimit: 0,
    // Give the job a hard ceiling slightly above the run timeout so a wedged
    // worker eventually releases it instead of holding it forever.
    expireInSeconds: Math.ceil(env.RUN_TIMEOUT_MS / 1000) + 120,
  });
}

/**
 * Reap runs whose worker died mid-execution.
 *
 * A RUNNING row with no event written for RUN_STALE_AFTER_MS cannot make
 * progress: the process that owned it is gone. We close it out as failed so it
 * stops spinning forever in the UI. QUEUED rows older than the same window are
 * treated the same way — if they had been picked up, they would be RUNNING.
 */
export async function recoverOrphanedRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - env.RUN_STALE_AFTER_MS);

  const candidates = await prisma.workflowRun.findMany({
    where: { status: { in: ["RUNNING", "QUEUED"] }, startedAt: { lt: cutoff } },
    select: { id: true, startedAt: true },
  });
  if (candidates.length === 0) return 0;

  // A long run is legitimately quiet only between events; the last event is a
  // better liveness signal than startedAt alone.
  const stale: string[] = [];
  for (const run of candidates) {
    const lastEvent = await prisma.runEvent.findFirst({
      where: { runId: run.id },
      orderBy: { seq: "desc" },
      select: { createdAt: true },
    });
    const lastActivity = lastEvent?.createdAt ?? run.startedAt;
    if (lastActivity < cutoff) stale.push(run.id);
  }
  if (stale.length === 0) return 0;

  await prisma.workflowRun.updateMany({
    where: { id: { in: stale } },
    data: {
      status: "FAILED",
      error: "Run was interrupted (worker restarted or crashed).",
      completedAt: new Date(),
    },
  });

  return stale.length;
}

/**
 * Start consuming runs. Called only from the worker entrypoint, never from the
 * Next.js server — keeping execution out of the web process is the whole point.
 */
export async function startRunWorker(): Promise<void> {
  const boss = await getBoss();

  await boss.work<RunJobData>(
    RUN_QUEUE,
    { teamSize: env.RUN_WORKER_CONCURRENCY, teamConcurrency: env.RUN_WORKER_CONCURRENCY },
    async (job) => {
      // Imported lazily so this module stays importable from the web process
      // (for enqueueRun) without pulling in the whole engine.
      const { executeRun } = await import("@/lib/orchestration/runner");

      const { runId } = job.data;

      // The row may have been cancelled while the job sat in the queue.
      const current = await prisma.workflowRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (!current || current.status === "CANCELLED") {
        console.log(`[worker] skipping ${runId} (${current?.status ?? "deleted"})`);
        return;
      }

      console.log(`[worker] executing run ${runId}`);
      // executeRun handles its own errors and always writes a terminal status,
      // so we never rethrow: a throw here would mark the pg-boss job failed and
      // add nothing the WorkflowRun row does not already record.
      await executeRun(job.data);
    },
  );

  console.log(`[worker] listening on "${RUN_QUEUE}" (concurrency ${env.RUN_WORKER_CONCURRENCY})`);
}
