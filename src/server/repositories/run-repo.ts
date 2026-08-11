import { prisma } from "@/server/db";

/** Read models for the run history and realtime viewer. */
export async function getRunDetail(workspaceId: string, runId: string) {
  return prisma.workflowRun.findFirst({
    where: { id: runId, workspaceId },
    include: {
      workflow: { select: { id: true, name: true, executionMode: true } },
      steps: { orderBy: { stepIndex: "asc" } },
    },
  });
}

export async function listRuns(workspaceId: string, options: { workflowId?: string; limit?: number } = {}) {
  return prisma.workflowRun.findMany({
    where: { workspaceId, ...(options.workflowId ? { workflowId: options.workflowId } : {}) },
    orderBy: { startedAt: "desc" },
    take: options.limit ?? 50,
    include: {
      workflow: { select: { id: true, name: true } },
      _count: { select: { steps: true } },
    },
  });
}

/** Cursor read used by the SSE endpoint. `after` is the last delivered seq. */
export async function getRunEvents(runId: string, after = 0, limit = 200) {
  return prisma.runEvent.findMany({
    where: { runId, seq: { gt: after } },
    orderBy: { seq: "asc" },
    take: limit,
  });
}

export async function getRunStatus(runId: string) {
  return prisma.workflowRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, output: true, error: true, completedAt: true },
  });
}
