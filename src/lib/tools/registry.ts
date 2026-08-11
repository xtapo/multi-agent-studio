import type { AgentTool, ToolConfig } from "@/types/tool";
import type { LLMToolSpec } from "@/types/llm";
import { AppError } from "@/lib/errors";
import { calculatorTool } from "./builtin/calculator";
import { webSearchTool } from "./builtin/web-search";
import { httpRequestTool } from "./builtin/http-request";
import { databaseQueryTool } from "./builtin/database-query";
import { fileReaderTool } from "./builtin/file-reader";
import { codeExecutorTool } from "./builtin/code-executor";

/**
 * Tool Registry.
 *
 * The registry is the enforcement point for tool permissions. The agent
 * executor asks it for a *resolved* tool set built from the agent's whitelist
 * and can only ever call something that came back from `resolve()`. A model
 * asking for a tool outside that set gets a structured refusal fed back into
 * the loop — the tool is never located, let alone executed. Prompt-level
 * instructions are treated as advisory only.
 */
const BUILTIN_TOOLS: AgentTool[] = [
  webSearchTool,
  calculatorTool,
  httpRequestTool,
  databaseQueryTool,
  fileReaderTool,
  codeExecutorTool,
];

export interface ResolvedTool {
  tool: AgentTool;
  config: Record<string, unknown>;
  maxCalls: number;
}

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = BUILTIN_TOOLS) {
    for (const t of tools) this.register(t);
  }

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) throw new AppError("CONFLICT", `Tool "${tool.name}" is already registered.`);
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  /** Public metadata safe to send to the browser (no execute function). */
  describe() {
    return this.list().map((t) => ({
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      inputSchema: t.inputSchema,
      dangerous: Boolean(t.dangerous),
    }));
  }

  /**
   * Build the permitted tool set for one agent. Unknown or disabled entries are
   * dropped silently rather than failing the run — an agent referencing a tool
   * that was later removed should degrade, not crash.
   */
  resolve(configs: ToolConfig[]): Map<string, ResolvedTool> {
    const resolved = new Map<string, ResolvedTool>();
    for (const cfg of configs ?? []) {
      if (!cfg?.enabled) continue;
      const tool = this.tools.get(cfg.toolName);
      if (!tool) continue;
      resolved.set(tool.name, { tool, config: cfg.config ?? {}, maxCalls: cfg.maxCalls ?? 5 });
    }
    return resolved;
  }

  /** Convert a resolved set into the vendor-neutral spec sent to the model. */
  toolSpecs(resolved: Map<string, ResolvedTool>): LLMToolSpec[] {
    return [...resolved.values()].map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));
  }
}

let singleton: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  singleton ??= new ToolRegistry();
  return singleton;
}
