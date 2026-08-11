import type { AgentDefinition, ContextPolicy } from "./agent";

export type ExecutionMode = "SEQUENTIAL" | "PARALLEL" | "SUPERVISOR" | "ROUTER" | "DEBATE";

export type NodeKind = "AGENT" | "START" | "END";

/** Role a node plays inside a DEBATE workflow. */
export type DebateRole = "PROPONENT" | "OPPONENT" | "JUDGE" | "SYNTHESIZER";

export interface WorkflowNodeConfig {
  debateRole?: DebateRole;
  /** For ROUTER mode: the route key this node handles, e.g. "research". */
  routeKey?: string;
  /** For SUPERVISOR mode: marks the node that orchestrates the others. */
  isSupervisor?: boolean;
}

export interface WorkflowNodeDefinition {
  id: string;
  kind: NodeKind;
  agentId: string | null;
  agent: AgentDefinition | null;
  label: string;
  position: { x: number; y: number };
  contextPolicy: ContextPolicy;
  config: WorkflowNodeConfig;
}

export interface WorkflowEdgeDefinition {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string | null;
  condition?: { route?: string } | null;
}

export interface WorkflowBudgetOverride {
  maxSteps?: number;
  maxToolCalls?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  timeoutMs?: number;
}

export interface WorkflowDefinition {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  executionMode: ExecutionMode;
  entryNodeId: string | null;
  finalNodeId: string | null;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdgeDefinition[];
  budget?: WorkflowBudgetOverride | null;
  isTemplate: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Structured decision returned by a supervisor agent. */
export interface SupervisorDecision {
  action: "delegate" | "retry" | "finish";
  nodeId?: string;
  task?: string;
  reason: string;
  finalAnswer?: string;
}

/** Structured decision returned by a router agent. */
export interface RouterDecision {
  route: string;
  reason: string;
  confidence: number;
}
