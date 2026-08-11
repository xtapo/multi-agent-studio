import { notFound } from "next/navigation";
import { auth, resolveWorkspaceId } from "@/server/auth";
import { getWorkflow } from "@/server/services/workflow-service";
import { listAgents } from "@/server/services/agent-service";
import { WorkflowBuilder } from "@/components/workflows/builder/workflow-builder";

export default async function WorkflowBuilderPage({ params }: { params: { id: string } }) {
  const session = await auth();
  const workspaceId = session!.workspaceId ?? (await resolveWorkspaceId(session!.user.id));

  const [workflow, agents] = await Promise.all([
    getWorkflow(workspaceId, params.id).catch(() => null),
    listAgents(workspaceId),
  ]);
  if (!workflow) notFound();

  return (
    <WorkflowBuilder
      workflow={{
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? null,
        executionMode: workflow.executionMode,
        entryNodeId: workflow.entryNodeId ?? null,
        finalNodeId: workflow.finalNodeId ?? null,
        nodes: workflow.nodes.map((node) => ({
          id: node.id,
          label: node.label ?? null,
          positionX: node.position.x,
          positionY: node.position.y,
          agentId: node.agent?.id ?? null,
          contextPolicy: node.contextPolicy,
          config: node.config,
        })),
        edges: workflow.edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          label: edge.label ?? null,
        })),
      }}
      agents={agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        model: agent.model,
        temperature: agent.temperature,
        outputFormat: agent.outputFormat,
        tools: agent.tools,
      }))}
    />
  );
}
