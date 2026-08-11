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

  const [totals, byStatus, agentStats, recent] = await Promise.all([
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
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const totalRuns = totals._count._all;
  const completed = statusCounts.COMPLETED ?? 0;

  // Per-agent failure rate, which is the number that actually tells you which
  // prompt to fix.
  const agents = new Map<string, { name: string; runs: number; failures: number; avgLatencyMs: number; cost: number; tokens: number }>();
  for (const stat of agentStats) {
    const entry = agents.get(stat.agentName) ?? {
      name: stat.agentName,
      runs: 0,
      failures: 0,
      avgLatencyMs: 0,
      cost: 0,
      tokens: 0,
    };
    const count = stat._count._all;
    entry.avgLatencyMs = (entry.avgLatencyMs * entry.runs + (stat._avg.durationMs ?? 0) * count) / (entry.runs + count);
    entry.runs += count;
    if (stat.status === "FAILED") entry.failures += count;
    entry.cost += stat._sum.estimatedCost ?? 0;
    entry.tokens += (stat._sum.inputTokens ?? 0) + (stat._sum.outputTokens ?? 0);
    agents.set(stat.agentName, entry);
  }

  return {
    periodDays: days,
    totalRuns,
    successRate: totalRuns > 0 ? completed / totalRuns : 0,
    statusCounts,
    totalTokens: totals._sum.totalTokens ?? 0,
    totalCost: totals._sum.estimatedCost ?? 0,
    totalSteps: totals._sum.stepCount ?? 0,
    totalToolCalls: totals._sum.toolCallCount ?? 0,
    averageLatencyMs: Math.round(totals._avg.durationMs ?? 0),
    agents: [...agents.values()]
      .map((a) => ({ ...a, failureRate: a.runs > 0 ? a.failures / a.runs : 0, avgLatencyMs: Math.round(a.avgLatencyMs) }))
      .sort((a, b) => b.runs - a.runs),
    recentRuns: recent,
  };
}
