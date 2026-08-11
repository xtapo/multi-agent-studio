import type { AgentOutput, AgentState } from "@/types/run";
import type { WorkflowDefinition, WorkflowNodeDefinition } from "@/types/workflow";
import { AppError } from "@/lib/errors";
import { executeAgent } from "@/lib/agents/agent-executor";
import type { MemoryStore } from "@/lib/memory/memory-store";
import type { BudgetTracker } from "./budget";
import type { RunEventBus } from "./event-bus";
import { indexGraph, resolveEntryNode, upstreamOf, type GraphIndex } from "./graph";
import { addMessage, recordOutput } from "./state";
import { runSequential } from "./strategies/sequential";
import { runParallel } from "./strategies/parallel";
import { runSupervisor } from "./strategies/supervisor";
import { runRouter } from "./strategies/router";
import { runDebate } from "./strategies/debate";

/**
 * Workflow Engine.
 *
 * Architecture decision: a hand-written engine instead of LangGraph.
 *
 * The product needs exactly five execution shapes, all expressible in a few
 * hundred lines. Owning the loop means every step boundary is a place we can
 * enforce budget, persist an event and shape context — the three things that
 * actually determine whether a multi-agent system is usable in production.
 * The cost is that resumability and checkpointing are ours to build; the state
 * object is already fully serializable to make that a later addition rather
 * than a rewrite.
 *
 * Strategies never touch the provider, the database or the budget directly.
 * They receive `runNode` and compose it. That is what keeps each strategy file
 * short enough to reason about.
 */
export interface RunNodeOptions {
  /** Concrete assignment; defaults to the run's original task. */
  task?: string;
  /** Explicit context sources; defaults to the node's graph predecessors. */
  upstreamNodeIds?: string[];
  /** Forces structured output, used by supervisor and router. */
  responseSchema?: Record<string, unknown>;
  /** Who handed work to this node, recorded as an AgentMessage. */
  fromAgent?: string;
  messageType?: "handoff" | "delegation" | "critique" | "result";
}

export interface EngineContext {
  workflow: WorkflowDefinition;
  index: GraphIndex;
  entryNode: WorkflowNodeDefinition;
  state: AgentState;
  budget: BudgetTracker;
  bus: RunEventBus;
  runId: string;
  workspaceId: string;
  memory: MemoryStore;
  runNode(node: WorkflowNodeDefinition, options?: RunNodeOptions): Promise<AgentOutput>;
}

export interface StrategyResult {
  finalOutput: AgentOutput | null;
  /** Set by strategies that produce their own synthesis (e.g. supervisor). */
  finalText?: string;
}

export type Strategy = (ctx: EngineContext) => Promise<StrategyResult>;

const STRATEGIES: Record<WorkflowDefinition["executionMode"], Strategy> = {
  SEQUENTIAL: runSequential,
  PARALLEL: runParallel,
  SUPERVISOR: runSupervisor,
  ROUTER: runRouter,
  DEBATE: runDebate,
};

export async function runWorkflow(params: {
  workflow: WorkflowDefinition;
  state: AgentState;
  budget: BudgetTracker;
  bus: RunEventBus;
  runId: string;
  workspaceId: string;
  memory: MemoryStore;
}): Promise<StrategyResult> {
  const { workflow, state, budget, bus, runId, workspaceId, memory } = params;

  if (workflow.nodes.filter((n) => n.kind === "AGENT" && n.agent).length === 0) {
    throw new AppError("VALIDATION", "Workflow has no agent nodes to run.");
  }

  const index = indexGraph(workflow);
  const entryNode = resolveEntryNode(workflow, index);

  const ctx: EngineContext = {
    workflow,
    index,
    entryNode,
    state,
    budget,
    bus,
    runId,
    workspaceId,
    memory,
    async runNode(node, options = {}) {
      if (!node.agent) throw new AppError("VALIDATION", `Node "${node.label}" has no agent assigned.`);

      state.currentNodeId = node.id;
      const upstreamNodeIds = options.upstreamNodeIds ?? upstreamOf(index, node.id);
      const task = options.task ?? state.task;

      // Controlled inter-agent message. This is the audit trail of who handed
      // what to whom — not the model's chat history.
      if (options.fromAgent) {
        const message = addMessage(state, {
          fromAgent: options.fromAgent,
          toAgent: node.agent.name,
          type: options.messageType ?? "handoff",
          content: { task },
          metadata: { nodeId: node.id },
        });
        bus.emit("agent.message", { ...message });
      }

      const output = await executeAgent({
        agent: node.agent,
        node,
        task,
        state,
        upstreamNodeIds,
        runId,
        workspaceId,
        stepIndex: state.stepIndex,
        budget,
        bus,
        memory,
        responseSchema: options.responseSchema,
      });

      recordOutput(state, output);
      return output;
    },
  };

  const strategy = STRATEGIES[workflow.executionMode];
  if (!strategy) throw new AppError("VALIDATION", `Unsupported execution mode "${workflow.executionMode}".`);

  state.status = "running";
  const result = await strategy(ctx);
  state.status = "completed";
  return result;
}

/** Chooses the output that represents the run's answer. */
export function resolveFinalOutput(ctx: {
  workflow: WorkflowDefinition;
  state: AgentState;
  fallback: AgentOutput | null;
}): AgentOutput | null {
  const { workflow, state, fallback } = ctx;
  if (workflow.finalNodeId && state.agentOutputs[workflow.finalNodeId]) {
    return state.agentOutputs[workflow.finalNodeId];
  }
  return fallback;
}
