import type { z } from "zod";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import type { createWorkflowSchema, updateWorkflowSchema } from "@/lib/validation/schemas";
import { WORKFLOW_TEMPLATES, getTemplate } from "@/lib/templates";
import * as repo from "@/server/repositories/workflow-repo";
import { indexGraph, resolveEntryNode } from "@/lib/orchestration/graph";

export async function listWorkflows(workspaceId: string) {
  return repo.listWorkflows(workspaceId);
}

export async function getWorkflow(workspaceId: string, id: string) {
  return repo.loadWorkflowDefinition(workspaceId, id);
}

export async function createWorkflow(workspaceId: string, input: z.infer<typeof createWorkflowSchema>) {
  const workflow = await prisma.workflow.create({
    data: {
      workspaceId,
      name: input.name,
      description: input.description,
      executionMode: input.executionMode,
      budget: input.budget as object | undefined,
    },
  });

  if (input.nodes?.length) {
    await repo.replaceGraph(workflow.id, {
      nodes: input.nodes,
      edges: input.edges ?? [],
      entryNodeId: input.entryNodeId,
      finalNodeId: input.finalNodeId,
    });
  }

  return repo.loadWorkflowDefinition(workspaceId, workflow.id);
}

export async function updateWorkflow(workspaceId: string, id: string, input: z.infer<typeof updateWorkflowSchema>) {
  const existing = await prisma.workflow.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Workflow not found.");

  await prisma.workflow.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      executionMode: input.executionMode,
      budget: input.budget as object | undefined,
      isTemplate: input.isTemplate,
    },
  });

  // nodes and edges are replaced together or not at all — a graph is only
  // meaningful as a whole.
  if (input.nodes) {
    await repo.replaceGraph(id, {
      nodes: input.nodes,
      edges: input.edges ?? [],
      entryNodeId: input.entryNodeId,
      finalNodeId: input.finalNodeId,
    });
  } else if (input.entryNodeId !== undefined || input.finalNodeId !== undefined) {
    await prisma.workflow.update({
      where: { id },
      data: { entryNodeId: input.entryNodeId ?? null, finalNodeId: input.finalNodeId ?? null },
    });
  }

  return repo.loadWorkflowDefinition(workspaceId, id);
}

export async function deleteWorkflow(workspaceId: string, id: string) {
  const runCount = await prisma.workflowRun.count({ where: { workflowId: id, workspaceId } });
  if (runCount > 0) {
    // Preserve history: archive instead of cascading a delete through runs.
    const result = await prisma.workflow.updateMany({ where: { id, workspaceId }, data: { archived: true } });
    if (result.count === 0) throw new AppError("NOT_FOUND", "Workflow not found.");
    return { archived: true };
  }
  const result = await prisma.workflow.deleteMany({ where: { id, workspaceId } });
  if (result.count === 0) throw new AppError("NOT_FOUND", "Workflow not found.");
  return { deleted: true };
}

export async function duplicateWorkflow(workspaceId: string, id: string, name?: string) {
  const copy = await repo.duplicateWorkflow(workspaceId, id, name);
  return repo.loadWorkflowDefinition(workspaceId, copy.id);
}

/** Pre-flight validation surfaced in the builder before the user hits Run. */
export async function validateWorkflow(workspaceId: string, id: string) {
  const definition = await repo.loadWorkflowDefinition(workspaceId, id);
  const issues: string[] = [];

  const agentNodes = definition.nodes.filter((n) => n.kind === "AGENT");
  if (agentNodes.length === 0) issues.push("The workflow has no agent nodes.");
  for (const node of agentNodes) if (!node.agent) issues.push(`Node "${node.label}" has no agent assigned.`);

  const index = indexGraph(definition);
  try {
    resolveEntryNode(definition, index);
  } catch (err) {
    issues.push((err as Error).message);
  }

  if (definition.executionMode === "DEBATE" && !agentNodes.some((n) => n.config.debateRole)) {
    issues.push("Debate mode requires debate roles on the nodes.");
  }
  if (definition.executionMode === "SUPERVISOR" && agentNodes.length < 2) {
    issues.push("Supervisor mode requires a supervisor and at least one worker.");
  }

  return { valid: issues.length === 0, issues };
}

export function listTemplates() {
  return WORKFLOW_TEMPLATES.map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    executionMode: t.executionMode,
    agentCount: t.agents.length,
  }));
}

/**
 * Materialises a template into real agents and a real workflow. The copy is
 * fully owned by the workspace — editing it never affects the template.
 */
export async function instantiateTemplate(workspaceId: string, templateKey: string, name?: string) {
  const template = getTemplate(templateKey);
  if (!template) throw new AppError("NOT_FOUND", `Template "${templateKey}" not found.`);

  const agentIdByKey = new Map<string, string>();
  for (const spec of template.agents) {
    const agent = await prisma.agent.create({
      data: {
        workspaceId,
        name: spec.name,
        role: spec.role,
        systemPrompt: spec.systemPrompt,
        model: spec.model ?? "openai:gpt-4o-mini",
        temperature: spec.temperature ?? 0.3,
        maxTokens: spec.maxTokens ?? 2048,
        outputFormat: spec.outputFormat ?? "MARKDOWN",
        outputSchema: spec.outputSchema as object | undefined,
        tools: (spec.tools ?? []) as unknown as object,
      },
    });
    agentIdByKey.set(spec.key, agent.id);
  }

  const workflow = await prisma.workflow.create({
    data: {
      workspaceId,
      name: name ?? template.name,
      description: template.description,
      executionMode: template.executionMode,
    },
  });

  await repo.replaceGraph(workflow.id, {
    nodes: template.nodes.map((node) => ({
      tempId: node.key,
      agentId: agentIdByKey.get(node.agentKey),
      kind: "AGENT" as const,
      label: node.label,
      position: node.position,
      contextPolicy: node.contextPolicy,
      config: node.config,
    })),
    edges: template.edges.map((edge) => ({
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      label: edge.label,
      condition: edge.condition ?? null,
    })),
    entryNodeId: template.entryNodeKey,
    finalNodeId: template.finalNodeKey,
  });

  return repo.loadWorkflowDefinition(workspaceId, workflow.id);
}

/** Saves an existing workflow as a reusable template inside the workspace. */
export async function saveAsTemplate(workspaceId: string, id: string, name: string) {
  const copy = await repo.duplicateWorkflow(workspaceId, id, name);
  await prisma.workflow.update({ where: { id: copy.id }, data: { isTemplate: true } });
  return repo.loadWorkflowDefinition(workspaceId, copy.id);
}
