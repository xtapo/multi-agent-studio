import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { auth } from "@/server/auth";
import { getAnalytics } from "@/server/services/analytics-service";
import { listRuns } from "@/server/repositories/run-repo";
import { resolveWorkspaceId } from "@/server/auth";
import { formatCost, formatNumber, relativeTime, formatDuration } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { WorkflowList } from "@/components/workflows/workflow-list";

/**
 * Dashboard. Stats and recent runs are rendered on the server (one round trip,
 * no loading flash); the workflow grid is a client component because it has
 * interactive run/duplicate/delete actions.
 */
export default async function DashboardPage() {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));

  const [analytics, recentRuns] = await Promise.all([
    getAnalytics(workspaceId, 30),
    listRuns(workspaceId, { limit: 5 }),
  ]);

  const stats = [
    { label: "Runs (30d)", value: formatNumber(analytics.totalRuns) },
    { label: "Success rate", value: `${Math.round(analytics.successRate * 100)}%` },
    { label: "Tokens", value: formatNumber(analytics.totalTokens) },
    { label: "Estimated cost", value: formatCost(analytics.totalCost) },
  ];

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title={`Welcome back${session?.user?.name ? `, ${session.user.name}` : ""}`}
        description="Design agent teams, wire them into a workflow and watch them work."
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Workflows</h2>
        <WorkflowList />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent runs</h2>
          <Link href="/runs" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            All runs <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {recentRuns.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              recentRuns.map((run) => (
                <Link
                  key={run.id}
                  href={`/runs/${run.id}`}
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{run.workflow.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{run.input}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span>{run._count.steps} steps</span>
                    <span>{run.durationMs ? formatDuration(run.durationMs) : "—"}</span>
                    <span>{relativeTime(run.startedAt)}</span>
                    <Badge variant={statusVariant(run.status)}>{run.status.toLowerCase()}</Badge>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
