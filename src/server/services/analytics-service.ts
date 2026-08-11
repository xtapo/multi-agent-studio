import { prisma } from "@/server/db";

/**
 * Analytics — aggregated in SQL rather than in JS.
 *
 * These are read-only rollups over WorkflowRun and AgentRun, the two tables the
 * executor already writes on every step, so observability costs nothing extra
 * at run time.
 */
export async function getAnalytics(workspaceId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where = { workspaceId, startedAt: { gte: since } };

  const [totals, byStatus, agentStatsRaw, recent, modelStatsRaw] = await Promise.all([
    prisma.workflowRun.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalTokens: true, estimatedCost: true, stepCount: true, toolCallCount: true },
      _avg: { durationMs: true },
    }),
    prisma.workflowRun.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.agentRun.groupBy({
      by: ["agentName", "status"],
      where: { run: where },
      _count: { _all: true },
      _avg: { durationMs: true },
      _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
    }),
    prisma.workflowRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 30,
      select: { id: true, status: true, startedAt: true, durationMs: true, estimatedCost: true, totalTokens: true },
    }),
    prisma.agentRun.groupBy({
      by: ["model"],
      where: { run: where },
      _count: { _all: true },
      _sum: { estimatedCost: true, inputTokens: true, outputTokens: true },
    }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const totalRuns = totals._count._all;
  const completed = statusCounts.COMPLETED ?? 0;
  const failedRuns = statusCounts.FAILED ?? 0;

  // Per-agent failure rate, which is the number that actually tells you which
  // prompt to fix.
  const agents = new Map<string, { agentName: string; runs: number; failures: number; averageDurationMs: number; cost: number; tokens: number }>();
  for (const stat of agentStatsRaw) {
    const entry = agents.get(stat.agentName) ?? {
      agentName: stat.agentName,
      runs: 0,
      failures: 0,
      averageDurationMs: 0,
      cost: 0,
      tokens: 0,
    };
    const count = stat._count._all;
    entry.averageDurationMs = (entry.averageDurationMs * entry.runs + (stat._avg.durationMs ?? 0) * count) / (entry.runs + count);
    entry.runs += count;
    if (stat.status === "FAILED") entry.failures += count;
    entry.cost += stat._sum.estimatedCost ?? 0;
    entry.tokens += (stat._sum.inputTokens ?? 0) + (stat._sum.outputTokens ?? 0);
    agents.set(stat.agentName, entry);
  }

  const modelStats = modelStatsRaw.map(m => ({
    model: m.model ?? "unknown",
    calls: m._count._all,
    tokens: (m._sum.inputTokens ?? 0) + (m._sum.outputTokens ?? 0),
    cost: m._sum.estimatedCost ?? 0
  })).sort((a, b) => b.calls - a.calls);

  return {
    days,
    totalRuns,
    successRate: totalRuns > 0 ? completed / totalRuns : 0,
    failedRuns,
    statusCounts,
    totalTokens: totals._sum.totalTokens ?? 0,
    totalCost: totals._sum.estimatedCost ?? 0,
    totalSteps: totals._sum.stepCount ?? 0,
    totalToolCalls: totals._sum.toolCallCount ?? 0,
    averageDurationMs: Math.round(totals._avg.durationMs ?? 0),
    agentStats: [...agents.values()]
      .map((a) => ({ ...a, failureRate: a.runs > 0 ? a.failures / a.runs : 0, averageDurationMs: Math.round(a.averageDurationMs) }))
      .sort((a, b) => b.runs - a.runs),
    modelStats,
    recentRuns: recent,
  };
}
