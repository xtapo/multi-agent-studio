import { notFound } from "next/navigation";
import { auth, resolveWorkspaceId } from "@/server/auth";
import { getAgent } from "@/server/repositories/agent-repo";
import { AgentBuilder, type AgentFormValue } from "@/components/agents/agent-builder";
import { DeleteAgentButton } from "@/components/agents/delete-agent-button";
import { PageHeader } from "@/components/ui/misc";

export default async function EditAgentPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));
  const agent = await getAgent(workspaceId, params.id);
  if (!agent) notFound();

  const initial: AgentFormValue = {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    role: agent.role,
    systemPrompt: agent.systemPrompt,
    model: agent.model,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    outputFormat: agent.outputFormat,
    outputSchema: agent.outputSchema ?? null,
    tools: agent.tools,
    memoryConfig: agent.memoryConfig,
    retryConfig: { maxRetries: agent.retryConfig.maxRetries },
  };

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title={agent.name}
        description="Changes apply to every workflow that uses this agent, but never to a run already in flight."
        actions={<DeleteAgentButton agentId={agent.id} agentName={agent.name} />}
      />
      <AgentBuilder initial={initial} />
    </div>
  );
}
