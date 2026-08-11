import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import type { WorkflowDefinition, WorkflowNodeDefinition } from "@/types/workflow";
import { DEFAULT_CONTEXT_POLICY } from "@/types/agent";
import type { RunBudget } from "@/types/run";
import { toAgentDefinition } from "./agent-repo";

const withGraph = {
  nodes: { include: { agent: true }, orderBy: { createdAt: "asc" } },
  edges: { orderBy: { createdAt: "asc" } },
} as const;

/**
 * Loads a workflow as the immutable definition the engine consumes.
 *
 * The engine never queries the database mid-run: everything it needs — nodes,
 * edges and the full agent configuration — is materialised up front. That makes
 * a run reproducible and stops a mid-run edit in the builder from changing the
 * behaviour of an execution already in flight.
 */
export async function loadWorkflowDefinition(workspaceId: string, workflowId: string): Promise<WorkflowDefinition> {
  const row = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, include: withGraph });
  if (!row) throw new AppError("NOT_FOUND", "Workflow not found.");

  const nodes: WorkflowNodeDefinition[] = row.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    label: node.label ?? node.agent?.name ?? "Node",
    position: { x: node.positionX, y: node.positionY },
    agent: node.agent ? toAgentDefinition(node.agent) : undefined,
    contextPolicy: { ...DEFAULT_CONTEXT_POLICY, ...((node.contextPolicy as object) ?? {}) },
    config: ((node.config as object) ?? {}) as WorkflowNodeDefinition["config"],
  }));

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    executionMode: row.executionMode,
    entryNodeId: row.entryNodeId ?? undefined,
    finalNodeId: row.finalNodeId ?? undefined,
    budget: ((row.budget as object) ?? undefined) as Partial<RunBudget> | undefined,
    isTemplate: row.isTemplate,
    nodes,
    edges: row.edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      label: edge.label ?? undefined,
      condition: (edge.condition as { route?: string } | null) ?? undefined,
    })),
  };
}

export async function listWorkflows(workspaceId: string) {
  const rows = await prisma.workflow.findMany({
    where: { workspaceId, archived: false },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { nodes: true, runs: true } },
      runs: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, status: true, startedAt: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    executionMode: row.executionMode,
    isTemplate: row.isTemplate,
    templateKey: row.templateKey,
    agentCount: row._count.nodes,
    runCount: row._count.runs,
    lastRun: row.runs[0] ?? null,
    updatedAt: row.updatedAt,
  }));
}

export interface GraphInput {
  nodes: Array<{
    id?: string;
    tempId?: string;
    agentId?: string | null;
    kind?: "AGENT" | "START" | "END";
    label?: string;
    position: { x: number; y: number };
    contextPolicy?: Record<string, unknown>;
    config?: Record<string, unknown>;
  }>;
  edges: Array<{
    sourceNodeId: string;
    targetNodeId: string;
    label?: string;
    condition?: Record<string, unknown> | null;
  }>;
  entryNodeId?: string | null;
  finalNodeId?: string | null;
}

/**
 * Replaces the whole graph in one transaction.
 *
 * Trade-off: diffing node-by-node would preserve ids across saves, but the
 * canvas can reshape arbitrarily between saves and a partial diff failure would
 * leave a半 graph. Full replacement inside a transaction is simpler and always
 * consistent; client-generated temp ids are remapped to real ids afterwards.
 */
export async function replaceGraph(workflowId: string, graph: GraphInput) {
  return prisma.$transaction(async (tx) => {
    await tx.workflowEdge.deleteMany({ where: { workflowId } });
    await tx.workflowNode.deleteMany({ where: { workflowId } });

    const idMap = new Map<string, string>();

    for (const node of graph.nodes) {
      const created = await tx.workflowNode.create({
        data: {
          workflowId,
          agentId: node.agentId ?? null,
          kind: node.kind ?? "AGENT",
          label: node.label,
          positionX: node.position.x,
          positionY: node.position.y,
          contextPolicy: (node.contextPolicy ?? undefined) as object | undefined,
          config: (node.config ?? undefined) as object | undefined,
        },
      });
      const key = node.tempId ?? node.id;
      if (key) idMap.set(key, created.id);
    }

    const resolve = (id: string) => idMap.get(id) ?? id;

    for (const edge of graph.edges) {
      const source = resolve(edge.sourceNodeId);
      const target = resolve(edge.targetNodeId);
      if (!idMap.has(edge.sourceNodeId) && !idMap.has(edge.targetNodeId)) continue;
      await tx.workflowEdge.create({
        data: {
          workflowId,
          sourceNodeId: source,
          targetNodeId: target,
          label: edge.label,
          condition: (edge.condition ?? undefined) as object | undefined,
        },
      });
    }

    await tx.workflow.update({
      where: { id: workflowId },
      data: {
        entryNodeId: graph.entryNodeId ? resolve(graph.entryNodeId) : null,
        finalNodeId: graph.finalNodeId ? resolve(graph.finalNodeId) : null,
      },
    });

    return idMap;
  });
}

export async function duplicateWorkflow(workspaceId: string, workflowId: string, name?: string) {
  const source = await prisma.workflow.findFirst({ where: { id: workflowId, workspaceId }, include: withGraph });
  if (!source) throw new AppError("NOT_FOUND", "Workflow not found.");

  const copy = await prisma.workflow.create({
    data: {
      workspaceId,
      name: name ?? `${source.name} (copy)`,
      description: source.description,
      executionMode: source.executionMode,
      budget: (source.budget ?? undefined) as object | undefined,
      isTemplate: false,
      templateKey: null,
    },
  });

  await replaceGraph(copy.id, {
    nodes: source.nodes.map((n) => ({
      tempId: n.id,
      agentId: n.agentId,
      kind: n.kind,
      label: n.label ?? undefined,
      position: { x: n.positionX, y: n.positionY },
      contextPolicy: (n.contextPolicy as Record<string, unknown>) ?? undefined,
      config: (n.config as Record<string, unknown>) ?? undefined,
    })),
    edges: source.edges.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      label: e.label ?? undefined,
      condition: (e.condition as Record<string, unknown>) ?? null,
    })),
    entryNodeId: source.entryNodeId,
    finalNodeId: source.finalNodeId,
  });

  return copy;
}
