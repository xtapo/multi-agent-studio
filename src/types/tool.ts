import type { JSONSchema } from "./llm";

/** Per-agent whitelist entry. An agent can only ever call tools listed here. */
export interface ToolConfig {
  toolName: string;
  enabled: boolean;
  /** Hard cap on invocations of this tool by this agent within one step. */
  maxCalls?: number;
  /** Tool-specific overrides, e.g. { maxResults: 5 } for web_search. */
  config?: Record<string, unknown>;
}

export interface ToolExecutionContext {
  workspaceId: string;
  runId: string;
  agentName: string;
  /** Tool-specific config merged from the agent's ToolConfig. */
  config: Record<string, unknown>;
  signal?: AbortSignal;
  log: (message: string, data?: Record<string, unknown>) => void;
}

export interface AgentTool<TInput = any, TOutput = any> {
  name: string;
  displayName: string;
  description: string;
  inputSchema: JSONSchema;
  /** Tools that can mutate state or execute code require explicit opt-in. */
  dangerous?: boolean;
  execute(input: TInput, ctx: ToolExecutionContext): Promise<TOutput>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  durationMs: number;
  ok: boolean;
}
