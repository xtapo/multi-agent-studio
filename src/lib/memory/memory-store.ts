import type { MemoryConfig } from "@/types/agent";
import { prisma } from "@/server/db";

/**
 * Three-tier memory.
 *
 *   SHORT_TERM — lives inside a single run. Held in AgentState, never written
 *                here; persisting it would just duplicate the run log.
 *   WORKFLOW   — durable facts a workflow accumulates across runs
 *                ("the client prefers metric units").
 *   USER       — preferences attached to a person, read only when the agent's
 *                memoryConfig.userMemory is explicitly on.
 *
 * Retrieval is keyword/recency based, not vector based. That is a deliberate
 * MVP trade-off: it needs no embedding infrastructure, is fully deterministic
 * in tests, and the interface below (`recall` returning scored items) is the
 * same one a pgvector implementation would expose.
 */
export interface MemoryItem {
  id: string;
  key: string;
  value: unknown;
  scope: "WORKFLOW" | "USER";
  weight: number;
  updatedAt: Date;
}

function score(item: MemoryItem, query: string): number {
  const haystack = `${item.key} ${JSON.stringify(item.value)}`.toLowerCase();
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  const hits = terms.filter((t) => haystack.includes(t)).length;
  const ageDays = (Date.now() - item.updatedAt.getTime()) / 86_400_000;
  const recency = 1 / (1 + ageDays / 14);
  return hits * 2 + recency + item.weight;
}

export class MemoryStore {
  constructor(
    private readonly workspaceId: string,
    private readonly workflowId: string,
    private readonly userId?: string | null,
  ) {}

  /** Fetch and rank the memories an agent is configured to see. */
  async recall(config: MemoryConfig, query: string): Promise<MemoryItem[]> {
    if (!config.workflowMemory && !config.userMemory) return [];

    const scopes: Array<"WORKFLOW" | "USER"> = [];
    if (config.workflowMemory) scopes.push("WORKFLOW");
    if (config.userMemory && this.userId) scopes.push("USER");
    if (scopes.length === 0) return [];

    const rows = await prisma.memory.findMany({
      where: {
        workspaceId: this.workspaceId,
        OR: [
          config.workflowMemory ? { scope: "WORKFLOW", workflowId: this.workflowId } : undefined,
          config.userMemory && this.userId ? { scope: "USER", userId: this.userId } : undefined,
        ].filter(Boolean) as object[],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });

    const items: MemoryItem[] = rows.map((r) => ({
      id: r.id,
      key: r.key,
      value: r.value,
      scope: r.scope as "WORKFLOW" | "USER",
      weight: r.weight,
      updatedAt: r.updatedAt,
    }));

    return items
      .map((item) => ({ item, s: score(item, query) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, config.maxItems)
      .map((x) => x.item);
  }

  /** Upsert a durable memory. Agents write here only via explicit engine calls. */
  async remember(params: {
    scope: "WORKFLOW" | "USER";
    key: string;
    value: unknown;
    weight?: number;
    runId?: string;
    agentKey?: string;
    ttlDays?: number;
  }): Promise<void> {
    const expiresAt = params.ttlDays ? new Date(Date.now() + params.ttlDays * 86_400_000) : null;

    const existing = await prisma.memory.findFirst({
      where: {
        workspaceId: this.workspaceId,
        scope: params.scope,
        key: params.key,
        workflowId: params.scope === "WORKFLOW" ? this.workflowId : null,
        userId: params.scope === "USER" ? this.userId ?? null : null,
      },
    });

    const data = {
      value: params.value as object,
      weight: params.weight ?? 1,
      runId: params.runId ?? null,
      agentKey: params.agentKey ?? null,
      expiresAt,
    };

    if (existing) {
      await prisma.memory.update({ where: { id: existing.id }, data });
      return;
    }

    await prisma.memory.create({
      data: {
        workspaceId: this.workspaceId,
        scope: params.scope,
        key: params.key,
        workflowId: params.scope === "WORKFLOW" ? this.workflowId : null,
        userId: params.scope === "USER" ? this.userId ?? null : null,
        ...data,
      },
    });
  }

  /** Render recalled items as a compact prompt block. */
  static render(items: MemoryItem[]): string {
    if (items.length === 0) return "";
    const lines = items.map((i) => `- (${i.scope.toLowerCase()}) ${i.key}: ${JSON.stringify(i.value)}`);
    return `Known context from memory (may be outdated — verify before relying on it):\n${lines.join("\n")}`;
  }
}
