import Link from "next/link";
import { Bot, Plus } from "lucide-react";
import { auth, resolveWorkspaceId } from "@/server/auth";
import { listAgents } from "@/server/services/agent-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";

export default async function AgentsPage() {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));
  const agents = await listAgents(workspaceId);

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Agents"
        description="Reusable specialists. One agent can appear in many workflows."
        actions={
          <Button asChild>
            <Link href="/agents/new">
              <Plus /> New agent
            </Link>
          </Button>
        }
      />

      {agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create one, or start from a workflow template to get a full team at once."
          action={
            <Button asChild>
              <Link href="/agents/new">Create your first agent</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{agent.name}</p>
                    <Badge variant="outline">{agent.model.split(":")[1] ?? agent.model}</Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{agent.role}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary">temp {agent.temperature}</Badge>
                    <Badge variant="secondary">{agent.outputFormat.toLowerCase()}</Badge>
                    {agent.tools.filter((t) => t.enabled).map((t) => (
                      <Badge key={t.name} variant="default">
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
