import { auth, resolveWorkspaceId } from "@/server/auth";
import { getAnalytics } from "@/server/services/analytics-service";
import { formatCost, formatDuration, formatNumber } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";

/** Observability dashboard: aggregates AgentRun rows written by the runtime. */
export default async function AnalyticsPage({ searchParams }: { searchParams: { days?: string } }) {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));
  const days = Number(searchParams.days ?? 30);
  const analytics = await getAnalytics(workspaceId, Number.isFinite(days) ? days : 30);

  const cards = [
    { label: "Total runs", value: formatNumber(analytics.totalRuns) },
    { label: "Success rate", value: `${Math.round(analytics.successRate * 100)}%` },
    { label: "Failed runs", value: formatNumber(analytics.failedRuns) },
    { label: "Tokens", value: formatNumber(analytics.totalTokens) },
    { label: "Estimated cost", value: formatCost(analytics.totalCost) },
    { label: "Avg latency", value: analytics.averageDurationMs ? formatDuration(analytics.averageDurationMs) : "—" },
  ];

  return (
    <div className="p-6 lg:p-8">
      <PageHeader title="Analytics" description={`Aggregated across the last ${analytics.days} days.`} />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent reliability</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-5 pt-0">
            {analytics.agentStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agent runs recorded yet.</p>
            ) : (
              analytics.agentStats.map((agent) => (
                <div key={agent.agentName} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{agent.agentName}</span>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span>{agent.runs} runs</span>
                    <span>{formatNumber(agent.tokens)} tok</span>
                    <span>{agent.averageDurationMs ? formatDuration(agent.averageDurationMs) : "—"}</span>
                    <Badge variant={agent.failureRate > 0.2 ? "destructive" : "success"}>
                      {Math.round(agent.failureRate * 100)}% fail
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Model usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-5 pt-0">
            {analytics.modelStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No model calls recorded yet.</p>
            ) : (
              analytics.modelStats.map((model) => (
                <div key={model.model} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-mono text-xs">{model.model}</span>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span>{model.calls} calls</span>
                    <span>{formatNumber(model.tokens)} tok</span>
                    <span>{formatCost(model.cost)}</span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
