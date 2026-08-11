import type { AgentDefinition, ContextPolicy } from "@/types/agent";
import type { AgentState } from "@/types/run";
import type { LLMMessage } from "@/types/llm";
import type { WorkflowNodeDefinition } from "@/types/workflow";
import { truncate } from "@/lib/utils";

/**
 * Context assembly — the heart of controlled agent communication.
 *
 * The naive multi-agent design appends every message to one growing transcript
 * and hands it to whoever runs next. That fails in three ways: cost grows
 * quadratically with team size, agents start parroting each other's phrasing,
 * and irrelevant upstream detail actively degrades the current agent's output.
 *
 * Here, a node receives *only* what its ContextPolicy allows: the original
 * task, the outputs of the nodes it is actually connected to, named shared
 * variables, and published shared notes. Nothing else reaches the model.
 */
const MAX_UPSTREAM_CHARS = 6000;

export interface BuiltContext {
  messages: LLMMessage[];
  /** The rendered user-facing task, persisted on AgentRun.input. */
  renderedInput: string;
  systemPrompt: string;
}

function renderUpstreamOutput(state: AgentState, nodeId: string): string | null {
  const output = state.agentOutputs[nodeId];
  if (!output) return null;
  const body = output.json ? JSON.stringify(output.json, null, 2) : output.text;
  return `### Output from ${output.agentName}\n${truncate(body, MAX_UPSTREAM_CHARS)}`;
}

export function buildAgentContext(params: {
  agent: AgentDefinition;
  node: WorkflowNodeDefinition;
  task: string;
  state: AgentState;
  upstreamNodeIds: string[];
  memoryBlock?: string;
  /** Extra directive injected by a strategy, e.g. a supervisor's instruction. */
  directive?: string;
}): BuiltContext {
  const { agent, node, task, state, upstreamNodeIds, memoryBlock, directive } = params;
  const policy: ContextPolicy = node.contextPolicy;

  const systemParts = [
    agent.systemPrompt.trim(),
    `\nYOUR ROLE IN THIS WORKFLOW\n${agent.role.trim()}`,
  ];

  if (policy.extraInstructions?.trim()) {
    systemParts.push(`\nWORKFLOW-SPECIFIC INSTRUCTIONS\n${policy.extraInstructions.trim()}`);
  }

  if (agent.outputFormat === "MARKDOWN") {
    systemParts.push("\nOUTPUT FORMAT\nRespond in clean Markdown.");
  }

  const systemPrompt = systemParts.join("\n");

  // ---- user turn -----------------------------------------------------------
  const sections: string[] = [];

  if (policy.includeOriginalTask) {
    sections.push(`## Original task\n${state.task}`);
  }

  if (directive && directive !== state.task) {
    sections.push(`## Your specific assignment\n${directive}`);
  } else if (task !== state.task) {
    sections.push(`## Your specific assignment\n${task}`);
  }

  if (memoryBlock) sections.push(`## Memory\n${memoryBlock}`);

  const nodeIds = new Set<string>();
  if (policy.includeUpstreamOutputs) upstreamNodeIds.forEach((id) => nodeIds.add(id));
  policy.includeNodeIds?.forEach((id) => nodeIds.add(id));

  const upstream = [...nodeIds]
    .map((id) => renderUpstreamOutput(state, id))
    .filter((v): v is string => Boolean(v));

  if (upstream.length > 0) {
    sections.push(`## Input from previous agents\n${upstream.join("\n\n")}`);
  }

  if (policy.includeVariables.length > 0) {
    const vars = Object.fromEntries(
      policy.includeVariables.filter((k) => k in state.variables).map((k) => [k, state.variables[k]]),
    );
    if (Object.keys(vars).length > 0) {
      sections.push(`## Shared variables\n\`\`\`json\n${JSON.stringify(vars, null, 2)}\n\`\`\``);
    }
  }

  if (policy.includeSharedNotes && state.sharedNotes.length > 0) {
    sections.push(`## Shared notes from the team\n${state.sharedNotes.map((n) => `- ${n}`).join("\n")}`);
  }

  if (upstream.length === 0 && sections.length <= 1) {
    // Nothing but the task — make the expectation explicit rather than letting
    // the model guess that it is mid-conversation.
    sections.push("You are the first agent in this workflow. Work directly from the task above.");
  }

  const renderedInput = sections.join("\n\n");

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: renderedInput },
  ];

  return { messages, renderedInput, systemPrompt };
}
