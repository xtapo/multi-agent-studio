import type { z } from "zod";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import { getToolRegistry } from "@/lib/tools/registry";
import { getModelInfo } from "@/lib/providers/registry";
import type { createAgentSchema, updateAgentSchema } from "@/lib/validation/schemas";
import * as repo from "@/server/repositories/agent-repo";

/**
 * Agent service — business rules that must hold regardless of the caller.
 *
 * Validation here is semantic (does this tool exist, is this model known,
 * is this JSON Schema usable), as opposed to the structural validation Zod
 * already performed at the route boundary.
 */
function assertToolsExist(tools: Array<{ name: string }> | undefined) {
  if (!tools?.length) return;
  const registry = getToolRegistry();
  const unknown = tools.filter((t) => !registry.has(t.name)).map((t) => t.name);
  if (unknown.length) {
    throw new AppError("VALIDATION", `Unknown tool(s): ${unknown.join(", ")}.`, {
      available: registry.list().map((t) => t.name),
    });
  }
}

function assertModelExists(model: string | undefined) {
  if (!model) return;
  if (!getModelInfo(model)) throw new AppError("VALIDATION", `Unknown model "${model}".`);
}

function assertSchemaUsable(outputFormat: string | undefined, schema: unknown) {
  if (outputFormat !== "JSON") return;
  if (!schema || typeof schema !== "object") {
    throw new AppError("VALIDATION", "JSON output format requires an output schema.");
  }
  if ((schema as { type?: string }).type !== "object") {
    throw new AppError("VALIDATION", "Output schema must be a JSON Schema of type \"object\".");
  }
}

export async function listAgents(workspaceId: string) {
  return repo.listAgents(workspaceId);
}

export async function getAgent(workspaceId: string, id: string) {
  const agent = await repo.getAgent(workspaceId, id);
  if (!agent) throw new AppError("NOT_FOUND", "Agent not found.");
  return agent;
}

export async function createAgent(workspaceId: string, input: z.infer<typeof createAgentSchema>) {
  assertToolsExist(input.tools);
  assertModelExists(input.model);
  assertSchemaUsable(input.outputFormat, input.outputSchema);

  return repo.createAgent(workspaceId, {
    workspaceId,
    name: input.name,
    description: input.description,
    role: input.role,
    systemPrompt: input.systemPrompt,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    outputFormat: input.outputFormat,
    outputSchema: input.outputSchema as object | undefined,
    tools: (input.tools ?? []) as unknown as object,
    memoryConfig: input.memoryConfig as object | undefined,
    retryConfig: input.retryConfig as object | undefined,
  });
}

export async function updateAgent(workspaceId: string, id: string, input: z.infer<typeof updateAgentSchema>) {
  assertToolsExist(input.tools);
  assertModelExists(input.model);
  const existing = await getAgent(workspaceId, id);
  assertSchemaUsable(input.outputFormat ?? existing.outputFormat, input.outputSchema ?? existing.outputSchema);

  const updated = await repo.updateAgent(workspaceId, id, {
    ...input,
    outputSchema: input.outputSchema as object | undefined,
    tools: input.tools ? ((input.tools as unknown) as object) : undefined,
    memoryConfig: input.memoryConfig as object | undefined,
    retryConfig: input.retryConfig as object | undefined,
  });
  if (!updated) throw new AppError("NOT_FOUND", "Agent not found.");
  return updated;
}

/**
 * Agents are archived rather than deleted while they are still wired into a
 * workflow or referenced by a historical run — hard-deleting would silently
 * break run history, which is the one thing users rely on being immutable.
 */
export async function deleteAgent(workspaceId: string, id: string) {
  const nodeCount = await prisma.workflowNode.count({ where: { agentId: id, workflow: { workspaceId } } });
  if (nodeCount > 0) {
    throw new AppError("CONFLICT", `This agent is used by ${nodeCount} workflow node(s). Remove it from those workflows first.`);
  }

  const runCount = await prisma.agentRun.count({ where: { agentId: id } });
  if (runCount > 0) {
    await repo.archiveAgent(workspaceId, id);
    return { archived: true };
  }

  const result = await prisma.agent.deleteMany({ where: { id, workspaceId } });
  if (result.count === 0) throw new AppError("NOT_FOUND", "Agent not found.");
  return { deleted: true };
}

export async function duplicateAgent(workspaceId: string, id: string) {
  const copy = await repo.duplicateAgent(workspaceId, id);
  if (!copy) throw new AppError("NOT_FOUND", "Agent not found.");
  return copy;
}
