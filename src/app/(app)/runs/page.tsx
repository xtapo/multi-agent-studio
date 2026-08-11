import Link from "next/link";
import { ListChecks } from "lucide-react";
import { auth, resolveWorkspaceId } from "@/server/auth";
import { listRuns } from "@/server/repositories/run-repo";
import { formatCost, formatDuration, formatNumber, relativeTime } from "@/lib/utils";
import { Badge, statusVariant } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";

export default async function RunsPage({ searchParams }: { searchParams: { workflowId?: string } }) {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));
  const runs = await listRuns(workspaceId, { workflowId: searchParams.workflowId, limit: 50 });

  return (
    <div className="p-6 lg:p-8">
      <PageHeader title="Runs" description="Every execution is replayable, with per-agent inputs, outputs and cost." />

      {runs.length === 0 ? (
        <EmptyState icon={ListChecks} title="No runs yet" description="Run a workflow to see its timeline here." />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/runs/${run.id}`}
                className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:bg-accent/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{run.workflow.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{run.input}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
                  <span>{run._count.steps} steps</span>
                  <span>{formatNumber(run.totalTokens)} tok</span>
                  <span>{formatCost(run.estimatedCost)}</span>
                  <span>{run.durationMs ? formatDuration(run.durationMs) : "—"}</span>
                  <span>{relativeTime(run.startedAt)}</span>
                  <Badge variant={statusVariant(run.status)}>{run.status.toLowerCase()}</Badge>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
