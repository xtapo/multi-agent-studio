import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import { startWorkflowRun } from "@/lib/orchestration/runner";
import type { RunBudget } from "@/types/run";
import * as repo from "@/server/repositories/run-repo";

export async function startRun(params: {
  workspaceId: string;
  userId: string;
  workflowId: string;
  input: string;
  variables?: Record<string, unknown>;
  budget?: Partial<RunBudget>;
}) {
  // One in-flight run per workflow. Concurrent runs of the same graph confuse
  // the timeline UI and multiply cost without adding value.
  const active = await prisma.workflowRun.findFirst({
    where: { workflowId: params.workflowId, status: { in: ["QUEUED", "RUNNING"] } },
    select: { id: true },
  });
  if (active) {
    throw new AppError("CONFLICT", "This workflow is already running.", { runId: active.id });
  }

  return startWorkflowRun(params);
}

export async function getRun(workspaceId: string, runId: string) {
  const run = await repo.getRunDetail(workspaceId, runId);
  if (!run) throw new AppError("NOT_FOUND", "Run not found.");
  return run;
}

export async function listRuns(workspaceId: string, options: { workflowId?: string; limit?: number } = {}) {
  return repo.listRuns(workspaceId, options);
}

/**
 * Cooperative cancellation. The executor checks the budget signal between
 * steps; marking the row CANCELLED is picked up on the next boundary, so a run
 * stops after the current model call rather than leaving an orphaned request.
 */
export async function cancelRun(workspaceId: string, runId: string) {
  const result = await prisma.workflowRun.updateMany({
    where: { id: runId, workspaceId, status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", completedAt: new Date(), error: "Cancelled by user." },
  });
  if (result.count === 0) throw new AppError("CONFLICT", "This run is not active.");
  return { cancelled: true };
}

export async function assertRunAccess(workspaceId: string, runId: string) {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, workspaceId }, select: { id: true } });
  if (!run) throw new AppError("NOT_FOUND", "Run not found.");
}
