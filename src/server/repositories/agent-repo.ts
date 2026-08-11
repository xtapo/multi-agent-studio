import type { Prisma, Agent as AgentRow } from "@prisma/client";
import { prisma } from "@/server/db";
import type { AgentDefinition } from "@/types/agent";
import { DEFAULT_MEMORY_CONFIG, DEFAULT_RETRY_CONFIG } from "@/types/agent";
import type { ToolConfig } from "@/types/tool";

/**
 * Agent repository — the only place that knows how a Prisma row becomes a
 * domain AgentDefinition. Json columns are decoded and defaulted here so no
 * other layer ever handles a raw `Prisma.JsonValue`.
 */
export function toAgentDefinition(row: AgentRow): AgentDefinition {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    role: row.role,
    systemPrompt: row.systemPrompt,
    model: row.model,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    outputFormat: row.outputFormat,
    outputSchema: (row.outputSchema as Record<string, unknown> | null) ?? undefined,
    tools: ((row.tools as unknown) as ToolConfig[]) ?? [],
    memoryConfig: { ...DEFAULT_MEMORY_CONFIG, ...((row.memoryConfig as object) ?? {}) },
    retryConfig: { ...DEFAULT_RETRY_CONFIG, ...((row.retryConfig as object) ?? {}) },
    isTemplate: row.isTemplate,
  };
}

export async function listAgents(workspaceId: string, options: { includeArchived?: boolean } = {}) {
  const rows = await prisma.agent.findMany({
    where: { workspaceId, ...(options.includeArchived ? {} : { archived: false }) },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toAgentDefinition);
}

export async function getAgent(workspaceId: string, id: string) {
  const row = await prisma.agent.findFirst({ where: { id, workspaceId } });
  return row ? toAgentDefinition(row) : null;
}

export async function createAgent(workspaceId: string, data: Prisma.AgentUncheckedCreateInput) {
  const row = await prisma.agent.create({ data: { ...data, workspaceId } });
  return toAgentDefinition(row);
}

export async function updateAgent(workspaceId: string, id: string, data: Prisma.AgentUncheckedUpdateInput) {
  const result = await prisma.agent.updateMany({ where: { id, workspaceId }, data });
  if (result.count === 0) return null;
  return getAgent(workspaceId, id);
}

/** Soft delete: agents are referenced by historical runs, so never hard-delete. */
export async function archiveAgent(workspaceId: string, id: string) {
  const result = await prisma.agent.updateMany({ where: { id, workspaceId }, data: { archived: true } });
  return result.count > 0;
}

export async function duplicateAgent(workspaceId: string, id: string) {
  const row = await prisma.agent.findFirst({ where: { id, workspaceId } });
  if (!row) return null;
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  const copy = await prisma.agent.create({ data: { ...rest, name: `${row.name} (copy)`, isTemplate: false } });
  return toAgentDefinition(copy);
}
