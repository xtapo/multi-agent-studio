import { z } from "zod";

/**
 * Zod contracts for every mutating API surface.
 *
 * These are the single source of truth for request validation. Route handlers
 * never read req.body directly; they parse through one of these first, so an
 * invalid payload can never reach a repository or the runtime.
 */

export const toolConfigSchema = z.object({
  toolName: z.string().min(1),
  enabled: z.boolean().default(true),
  maxCalls: z.number().int().positive().max(20).optional(),
  config: z.record(z.unknown()).optional(),
});

export const memoryConfigSchema = z.object({
  shortTerm: z.boolean().default(true),
  workflowMemory: z.boolean().default(false),
  userMemory: z.boolean().default(false),
  maxItems: z.number().int().min(0).max(50).default(8),
});

export const retryConfigSchema = z.object({
  maxRetries: z.number().int().min(0).max(5).default(2),
  baseDelayMs: z.number().int().min(0).max(10_000).default(600),
});

export const createAgentSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().nullable(),
  role: z.string().min(1).max(500),
  systemPrompt: z.string().min(1).max(20_000),
  model: z.string().min(1).default("openai:gpt-4o-mini"),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().min(64).max(32_000).default(2048),
  outputFormat: z.enum(["TEXT", "MARKDOWN", "JSON"]).default("TEXT"),
  outputSchema: z.record(z.unknown()).nullable().optional(),
  tools: z.array(toolConfigSchema).default([]),
  memoryConfig: memoryConfigSchema.optional(),
  retryConfig: retryConfigSchema.optional(),
});

export const updateAgentSchema = createAgentSchema.partial();

export const contextPolicySchema = z.object({
  includeOriginalTask: z.boolean().default(true),
  includeUpstreamOutputs: z.boolean().default(true),
  includeVariables: z.array(z.string()).default([]),
  includeSharedNotes: z.boolean().default(false),
  includeNodeIds: z.array(z.string()).optional(),
  extraInstructions: z.string().max(4000).optional(),
});

export const workflowNodeInputSchema = z.object({
  /** Client-generated id so nodes and edges can be sent in one payload. */
  id: z.string().min(1),
  kind: z.enum(["AGENT", "START", "END"]).default("AGENT"),
  agentId: z.string().nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  contextPolicy: contextPolicySchema.optional(),
  config: z
    .object({
      debateRole: z.enum(["PROPONENT", "OPPONENT", "JUDGE", "SYNTHESIZER"]).optional(),
      routeKey: z.string().max(60).optional(),
      isSupervisor: z.boolean().optional(),
    })
    .optional(),
});

export const workflowEdgeInputSchema = z.object({
  id: z.string().min(1).optional(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  label: z.string().max(80).nullable().optional(),
  condition: z.object({ route: z.string().optional() }).nullable().optional(),
});

export const budgetSchema = z.object({
  maxSteps: z.number().int().min(1).max(100).optional(),
  maxToolCalls: z.number().int().min(0).max(200).optional(),
  maxTokens: z.number().int().min(1000).max(2_000_000).optional(),
  maxCostUsd: z.number().min(0).max(100).optional(),
  timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
});

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  executionMode: z.enum(["SEQUENTIAL", "PARALLEL", "SUPERVISOR", "ROUTER", "DEBATE"]).default("SEQUENTIAL"),
  budget: budgetSchema.optional().nullable(),
});

export const updateWorkflowSchema = createWorkflowSchema.partial().extend({
  entryNodeId: z.string().nullable().optional(),
  finalNodeId: z.string().nullable().optional(),
  /** Full graph replacement — the canvas always sends its complete state. */
  nodes: z.array(workflowNodeInputSchema).optional(),
  edges: z.array(workflowEdgeInputSchema).optional(),
  isTemplate: z.boolean().optional(),
});

export const runWorkflowSchema = z.object({
  input: z.string().min(1).max(20_000),
  variables: z.record(z.unknown()).optional(),
  budget: budgetSchema.optional(),
});

export const saveTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
});

export const signUpSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
});

export type CreateAgentInput = z.infer<typeof createAgentSchema>;
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;
export type RunWorkflowInput = z.infer<typeof runWorkflowSchema>;
