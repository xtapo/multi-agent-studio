/**
 * Client-side editor types.
 *
 * The builder keeps its own lightweight shape instead of reusing the server
 * WorkflowDefinition: nodes created in the browser have temporary ids until the
 * next save, and React Flow needs `position`/`data` on every node.
 */
import type { Node, Edge } from "@xyflow/react";

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  model: string;
  temperature: number;
  outputFormat: "TEXT" | "MARKDOWN" | "JSON";
  tools: Array<{ name: string; enabled: boolean }>;
}

export interface ContextPolicy {
  includeOriginalTask: boolean;
  includeUpstreamOutputs: boolean;
  includeNodeIds?: string[];
  includeVariables: string[];
  includeSharedNotes: boolean;
  extraInstructions?: string;
}

export interface NodeConfig {
  debateRole?: "PROPONENT" | "OPPONENT" | "JUDGE" | "SYNTHESIZER";
  routeKey?: string;
  isSupervisor?: boolean;
}

export interface AgentNodeData extends Record<string, unknown> {
  label: string;
  agentId: string | null;
  agent: AgentSummary | null;
  contextPolicy: ContextPolicy;
  config: NodeConfig;
  isEntry: boolean;
  isFinal: boolean;
}

export type BuilderNode = Node<AgentNodeData, "agent">;
export type BuilderEdge = Edge;

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  includeOriginalTask: true,
  includeUpstreamOutputs: true,
  includeVariables: [],
  includeSharedNotes: true,
};

export const EXECUTION_MODES = [
  { value: "SEQUENTIAL", label: "Sequential", hint: "A → B → C in topological order." },
  { value: "PARALLEL", label: "Parallel", hint: "Independent nodes run in the same layer, then merge." },
  { value: "SUPERVISOR", label: "Supervisor", hint: "A supervisor delegates, reviews and decides when to stop." },
  { value: "ROUTER", label: "Router", hint: "An entry router classifies the task and picks one branch." },
  { value: "DEBATE", label: "Debate", hint: "Proponent, opponent, judge and synthesizer in order." },
] as const;
