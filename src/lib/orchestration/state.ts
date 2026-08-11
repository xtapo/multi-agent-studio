import type { AgentMessage, AgentOutput, AgentState } from "@/types/run";

/**
 * Shared state helpers.
 *
 * AgentState is deliberately a plain serializable object rather than a class:
 * it is snapshotted into WorkflowRun.finalState, replayed in the UI, and will
 * eventually be checkpointed for resumable runs. Keeping it POJO means all of
 * that is JSON.stringify away.
 */
export function createInitialState(params: {
  runId: string;
  workflowId: string;
  task: string;
  variables?: Record<string, unknown>;
}): AgentState {
  return {
    runId: params.runId,
    workflowId: params.workflowId,
    task: params.task,
    variables: { ...(params.variables ?? {}) },
    messages: [],
    agentOutputs: {},
    sharedNotes: [],
    status: "pending",
    stepIndex: 0,
  };
}

export function recordOutput(state: AgentState, output: AgentOutput): void {
  state.agentOutputs[output.nodeId] = output;
  state.stepIndex += 1;
}

export function addMessage(state: AgentState, message: Omit<AgentMessage, "createdAt">): AgentMessage {
  const full: AgentMessage = { ...message, createdAt: new Date().toISOString() };
  state.messages.push(full);
  return full;
}

export function addSharedNote(state: AgentState, note: string): void {
  const trimmed = note.trim();
  if (!trimmed) return;
  // Bounded: shared notes are injected into prompts, so an unbounded list is a
  // silent context-window leak.
  state.sharedNotes.push(trimmed);
  if (state.sharedNotes.length > 30) state.sharedNotes.shift();
}

/** Serializable snapshot without the bulky per-step tool payloads. */
export function snapshotState(state: AgentState) {
  return {
    ...state,
    agentOutputs: Object.fromEntries(
      Object.entries(state.agentOutputs).map(([k, v]) => [
        k,
        { ...v, toolCalls: v.toolCalls.map((t) => ({ name: t.name, ok: t.ok, durationMs: t.durationMs })) },
      ]),
    ),
  };
}
