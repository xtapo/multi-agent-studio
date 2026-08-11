import type { JSONSchema } from "./llm";
import type { ToolConfig } from "./tool";

export type OutputFormat = "TEXT" | "MARKDOWN" | "JSON";

export interface MemoryConfig {
  /** Reuse outputs produced earlier in this same run. */
  shortTerm: boolean;
  /** Read/write durable facts scoped to the workflow across runs. */
  workflowMemory: boolean;
  /** Read the user's stored preferences. Requires explicit user opt-in. */
  userMemory: boolean;
  /** Max memory items injected into the prompt. */
  maxItems: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  shortTerm: true,
  workflowMemory: false,
  userMemory: false,
  maxItems: 8,
};

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = { maxRetries: 2, baseDelayMs: 600 };

/**
 * The runtime view of an agent. This is what the executor receives — always
 * fully resolved, never a Prisma row with Json blobs.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  description?: string | null;

  role: string;
  systemPrompt: string;

  model: string;
  temperature: number;
  maxTokens: number;

  tools: ToolConfig[];

  outputFormat: OutputFormat;
  outputSchema?: JSONSchema | null;

  memoryConfig: MemoryConfig;
  retryConfig: RetryConfig;
}

/**
 * Controls exactly what a node is allowed to see. This is the antidote to the
 * usual multi-agent failure mode of forwarding the entire conversation to every
 * agent: context grows quadratically, cost explodes, and agents start echoing
 * each other. The engine builds each prompt from this policy alone.
 */
export interface ContextPolicy {
  includeOriginalTask: boolean;
  /** Include the outputs of directly upstream nodes. */
  includeUpstreamOutputs: boolean;
  /** Named shared-state variables this node may read. Empty = none. */
  includeVariables: string[];
  /** Include the running list of shared notes agents explicitly published. */
  includeSharedNotes: boolean;
  /** Include outputs of these specific node ids, regardless of graph edges. */
  includeNodeIds?: string[];
  /** Extra per-node instruction appended after the system prompt. */
  extraInstructions?: string;
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  includeOriginalTask: true,
  includeUpstreamOutputs: true,
  includeVariables: [],
  includeSharedNotes: false,
};
