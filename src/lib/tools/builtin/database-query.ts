import type { AgentTool } from "@/types/tool";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";

/**
 * Read-only SQL against the studio's own analytics tables.
 *
 * Safety model — four independent constraints, because SQL written by a model
 * is untrusted input:
 *   1. single statement, must start with SELECT (no CTE-wrapped DML, no `;`);
 *   2. table allowlist enforced by scanning identifiers in the statement;
 *   3. a mandatory LIMIT is appended if the model did not supply one;
 *   4. executed inside an explicit READ ONLY transaction with a statement
 *      timeout, so even a bypass cannot write or hang the pool.
 *
 * Trade-off: this is intentionally not a general-purpose "query any database"
 * tool. Pointing agents at arbitrary customer databases needs a per-datasource
 * credential model, which belongs in a later milestone.
 */
const ALLOWED_TABLES = new Set(["Agent", "Workflow", "WorkflowRun", "AgentRun", "WorkflowNode", "WorkflowEdge"]);
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge)\b/i;

function assertSafeQuery(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");

  if (trimmed.includes(";")) throw new AppError("TOOL_NOT_PERMITTED", "Only a single statement is allowed.");
  if (!/^select\s/i.test(trimmed)) throw new AppError("TOOL_NOT_PERMITTED", "Only SELECT statements are allowed.");
  if (FORBIDDEN.test(trimmed)) throw new AppError("TOOL_NOT_PERMITTED", "Write or DDL keywords are not allowed.");

  const referenced = [...trimmed.matchAll(/\b(?:from|join)\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map((m) => m[1]);
  for (const table of referenced) {
    if (!ALLOWED_TABLES.has(table)) {
      throw new AppError(
        "TOOL_NOT_PERMITTED",
        `Table "${table}" is not queryable. Allowed tables: ${[...ALLOWED_TABLES].join(", ")}.`,
      );
    }
  }

  return /\blimit\s+\d+/i.test(trimmed) ? trimmed : `${trimmed} LIMIT 100`;
}

export const databaseQueryTool: AgentTool<{ sql: string }, { rowCount: number; rows: unknown[] }> = {
  name: "database_query",
  displayName: "Database Query",
  description:
    'Run a read-only SELECT against the studio database. Quoted PascalCase table names are required, e.g. SELECT status, count(*) FROM "WorkflowRun" GROUP BY status. Allowed tables: Agent, Workflow, WorkflowRun, AgentRun, WorkflowNode, WorkflowEdge.',
  inputSchema: {
    type: "object",
    properties: { sql: { type: "string", description: "A single SELECT statement." } },
    required: ["sql"],
    additionalProperties: false,
  },
  async execute(input, ctx) {
    const sql = assertSafeQuery(String(input?.sql ?? ""));
    ctx.log("database_query executing", { sql });

    try {
      const rows = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL transaction_read_only = on");
          await tx.$executeRawUnsafe("SET LOCAL statement_timeout = 5000");
          return tx.$queryRawUnsafe<unknown[]>(sql);
        },
        { timeout: 10_000 },
      );

      // BigInt (from count(*)) is not JSON-serializable; normalise before it
      // reaches the model or the event log.
      const normalised = JSON.parse(
        JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v)),
      ) as unknown[];

      return { rowCount: normalised.length, rows: normalised };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("TOOL_FAILURE", `Query failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
