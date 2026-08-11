import type { ToolCallRecord } from "./tool";

export type RunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type StepStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SKIPPED";

/** Controlled message passed between agents. Never a raw chat transcript. */
export interface AgentMessage {
  fromAgent: string;
  toAgent: string;
  type: "handoff" | "critique" | "delegation" | "result" | "system";
  content: unknown;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/** The single shared state object threaded through an entire run. */
export interface AgentState {
  runId: string;
  workflowId: string;
  task: string;

  /** Free-form named values agents can read/write via the context policy. */
  variables: Record<string, unknown>;

  /** Controlled inter-agent messages (not model chat history). */
  messages: AgentMessage[];

  /** nodeId -> output of that node's most recent successful execution. */
  agentOutputs: Record<string, AgentOutput>;

  /** Short bullet notes agents explicitly publish for everyone downstream. */
  sharedNotes: string[];

  currentNodeId?: string;
  status: "pending" | "running" | "completed" | "failed";
  stepIndex: number;
}

export interface AgentOutput {
  nodeId: string;
  agentName: string;
  text: string;
  json?: unknown;
  /** Concise, user-facing action explanation. NOT private chain-of-thought. */
  reasoningSummary?: string;
  toolCalls: ToolCallRecord[];
  usage: { inputTokens: number; outputTokens: number };
  estimatedCost: number;
  durationMs: number;
  model: string;
  retryCount: number;
}

/** Hard limits enforced by the runtime. Every LLM/tool call consumes budget. */
export interface RunBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxTokens: number;
  maxCostUsd: number;
  timeoutMs: number;
}

export type RunEventType =
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "step.retry"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "tool.denied"
  | "agent.message"
  | "supervisor.decision"
  | "router.decision"
  | "budget.warning"
  | "log";

export interface RunEvent {
  seq: number;
  runId: string;
  type: RunEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}
