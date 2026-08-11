import type { AgentDefinition } from "@/types/agent";
import type { AgentOutput, AgentState } from "@/types/run";
import type { LLMMessage, LLMResponse } from "@/types/llm";
import type { ToolCallRecord } from "@/types/tool";
import type { WorkflowNodeDefinition } from "@/types/workflow";
import { AppError, toAppError } from "@/lib/errors";
import { withRetry, withTimeout } from "@/lib/retry";
import { getProviderRegistry } from "@/lib/providers/registry";
import { getToolRegistry } from "@/lib/tools/registry";
import { extractJson, formatIssues, validateAgainstSchema } from "@/lib/validation/json-schema";
import { buildAgentContext } from "./context-builder";
import type { BudgetTracker } from "@/lib/orchestration/budget";
import type { RunEventBus } from "@/lib/orchestration/event-bus";
import type { MemoryStore } from "@/lib/memory/memory-store";
import { MemoryStore as MemoryStoreClass } from "@/lib/memory/memory-store";
import { prisma } from "@/server/db";
import { truncate } from "@/lib/utils";

/**
 * Agent Executor — runs exactly one agent, once.
 *
 * Responsibilities, in order:
 *   1. build a context-filtered prompt (never a raw transcript);
 *   2. run the tool-calling loop against a whitelist the model cannot widen;
 *   3. enforce structured output with validate -> repair -> retry -> fail;
 *   4. account tokens/cost against the shared budget;
 *   5. persist an AgentRun row and emit timeline events.
 *
 * It knows nothing about workflows, graphs or execution modes — that keeps the
 * orchestration strategies thin and this file testable in isolation.
 */
const MAX_TOOL_ITERATIONS = 6;
const MAX_REPAIR_ATTEMPTS = 2;

export interface ExecuteAgentParams {
  agent: AgentDefinition;
  node: WorkflowNodeDefinition;
  /** The concrete assignment for this step (may differ from state.task). */
  task: string;
  state: AgentState;
  upstreamNodeIds: string[];
  runId: string;
  workspaceId: string;
  stepIndex: number;
  budget: BudgetTracker;
  bus: RunEventBus;
  memory?: MemoryStore;
  /** Overrides the agent's own schema, used by supervisor/router strategies. */
  responseSchema?: Record<string, unknown>;
}

/**
 * Builds the user-visible action explanation.
 *
 * Deliberately derived from observable facts (which tools ran, how big the
 * output is) plus an optional short `_summary` the model may provide. We never
 * ask for, store, or display private chain-of-thought.
 */
function buildReasoningSummary(agentName: string, toolCalls: ToolCallRecord[], modelSummary?: string): string {
  if (modelSummary?.trim()) return truncate(modelSummary.trim(), 400);
  if (toolCalls.length === 0) return `${agentName} produced its output directly from the provided context.`;
  const byTool = toolCalls.reduce<Record<string, number>>((acc, t) => {
    acc[t.name] = (acc[t.name] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(byTool).map(([name, n]) => `${name} ×${n}`);
  const failures = toolCalls.filter((t) => !t.ok).length;
  return `${agentName} used ${parts.join(", ")}${failures ? ` (${failures} failed)` : ""} and synthesised the result.`;
}

export async function executeAgent(params: ExecuteAgentParams): Promise<AgentOutput> {
  const { agent, node, task, state, upstreamNodeIds, runId, workspaceId, stepIndex, budget, bus, memory } = params;

  budget.consumeStep();

  const startedAt = Date.now();
  const providers = getProviderRegistry();
  const toolRegistry = getToolRegistry();
  const provider = providers.forModel(agent.model);

  // ---- permitted tool set (the enforcement point) --------------------------
  const permittedTools = toolRegistry.resolve(agent.tools);
  const toolSpecs = toolRegistry.toolSpecs(permittedTools);
  const perToolCalls = new Map<string, number>();

  // ---- memory --------------------------------------------------------------
  let memoryBlock: string | undefined;
  if (memory && (agent.memoryConfig.workflowMemory || agent.memoryConfig.userMemory)) {
    const items = await memory.recall(agent.memoryConfig, `${state.task}\n${task}`);
    memoryBlock = MemoryStoreClass.render(items) || undefined;
  }

  const { messages, renderedInput, systemPrompt } = buildAgentContext({
    agent,
    node,
    task,
    state,
    upstreamNodeIds,
    memoryBlock,
  });

  const agentRun = await prisma.agentRun.create({
    data: {
      runId,
      nodeId: node.id.startsWith("c") ? node.id : null,
      agentId: agent.id,
      stepIndex,
      agentName: agent.name,
      status: "RUNNING",
      input: renderedInput,
      prompt: systemPrompt,
      model: agent.model,
    },
  });

  bus.emit("step.started", {
    agentRunId: agentRun.id,
    nodeId: node.id,
    stepIndex,
    agentName: agent.name,
    model: agent.model,
    task: truncate(task, 500),
  });

  const toolCalls: ToolCallRecord[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let retryCount = 0;

  const schema = params.responseSchema ?? (agent.outputFormat === "JSON" ? agent.outputSchema ?? undefined : undefined);

  try {
    const result = await withRetry(
      async () => {
        const conversation: LLMMessage[] = [...messages];
        let response: LLMResponse | null = null;

        // ---- tool-calling loop ------------------------------------------------
        for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
          budget.assertWithinLimits();

          response = await withTimeout(
            provider.generate({
              model: agent.model,
              messages: conversation,
              temperature: agent.temperature,
              maxTokens: agent.maxTokens,
              tools: toolSpecs.length > 0 ? toolSpecs : undefined,
              responseFormat: schema ? { name: "agent_output", schema } : undefined,
              signal: budget.signal,
              timeoutMs: Math.min(120_000, budget.remainingMs || 120_000),
            }),
            Math.min(125_000, budget.remainingMs || 125_000),
            `${agent.name} model call`,
          );

          inputTokens += response.usage.inputTokens;
          outputTokens += response.usage.outputTokens;
          cost += budget.consumeTokens(agent.model, response.usage.inputTokens, response.usage.outputTokens);

          if (response.toolCalls.length === 0) break;

          conversation.push({ role: "assistant", content: response.text ?? "", toolCalls: response.toolCalls });

          for (const call of response.toolCalls) {
            const toolStart = Date.now();
            const permitted = permittedTools.get(call.name);

            // Permission is enforced here, not in the prompt. A model asking
            // for an unlisted tool gets a structured refusal it can react to.
            if (!permitted) {
              const message = `Tool "${call.name}" is not permitted for this agent. Permitted tools: ${
                [...permittedTools.keys()].join(", ") || "none"
              }. Continue without it.`;
              bus.emit("tool.denied", { agentRunId: agentRun.id, agentName: agent.name, tool: call.name });
              toolCalls.push({
                id: call.id,
                name: call.name,
                input: call.arguments,
                error: message,
                ok: false,
                startedAt: new Date(toolStart).toISOString(),
                durationMs: 0,
              });
              conversation.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: message }) });
              continue;
            }

            const used = perToolCalls.get(call.name) ?? 0;
            if (used >= permitted.maxCalls) {
              const message = `Call limit for "${call.name}" reached (${permitted.maxCalls}). Work with what you already have.`;
              conversation.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ error: message }) });
              continue;
            }
            perToolCalls.set(call.name, used + 1);
            budget.consumeToolCall();

            bus.emit("tool.started", {
              agentRunId: agentRun.id,
              agentName: agent.name,
              tool: call.name,
              input: call.arguments,
            });

            try {
              const output = await withTimeout(
                permitted.tool.execute(call.arguments, {
                  workspaceId,
                  runId,
                  agentName: agent.name,
                  config: permitted.config,
                  signal: budget.signal,
                  log: (message, data) => bus.emit("log", { agentName: agent.name, tool: call.name, message, ...data }),
                }),
                60_000,
                `${call.name} tool`,
              );

              const record: ToolCallRecord = {
                id: call.id,
                name: call.name,
                input: call.arguments,
                output,
                ok: true,
                startedAt: new Date(toolStart).toISOString(),
                durationMs: Date.now() - toolStart,
              };
              toolCalls.push(record);
              bus.emit("tool.completed", {
                agentRunId: agentRun.id,
                agentName: agent.name,
                tool: call.name,
                durationMs: record.durationMs,
                output,
              });
              conversation.push({
                role: "tool",
                toolCallId: call.id,
                content: truncate(JSON.stringify(output), 12_000),
              });
            } catch (err) {
              // A tool failure is reported back to the model rather than
              // failing the step: agents routinely recover by trying a
              // different query or continuing without that data.
              const appErr = toAppError(err);
              const record: ToolCallRecord = {
                id: call.id,
                name: call.name,
                input: call.arguments,
                error: appErr.message,
                ok: false,
                startedAt: new Date(toolStart).toISOString(),
                durationMs: Date.now() - toolStart,
              };
              toolCalls.push(record);
              bus.emit("tool.failed", {
                agentRunId: agentRun.id,
                agentName: agent.name,
                tool: call.name,
                error: appErr.message,
              });
              conversation.push({
                role: "tool",
                toolCallId: call.id,
                content: JSON.stringify({ error: appErr.message, code: appErr.code }),
              });
            }
          }
        }

        if (!response) throw new AppError("PROVIDER_ERROR", "Model produced no response.");

        // ---- structured output: validate -> repair -> fail -------------------
        if (!schema) return { text: response.text, json: undefined as unknown };

        let candidateText = response.text;

        for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
          let parsed: unknown;
          try {
            parsed = extractJson(candidateText);
          } catch (err) {
            if (attempt === MAX_REPAIR_ATTEMPTS) {
              throw new AppError("INVALID_JSON_OUTPUT", `Model did not return parsable JSON: ${(err as Error).message}`);
            }
            candidateText = await repair(
              conversation,
              candidateText,
              "Your previous reply was not valid JSON. Reply with the JSON object only — no prose, no code fences.",
            );
            continue;
          }

          const validation = validateAgainstSchema(parsed, schema);
          if (validation.valid) return { text: response.text, json: parsed };

          bus.emit("step.retry", {
            agentRunId: agentRun.id,
            agentName: agent.name,
            reason: "schema_validation",
            attempt: attempt + 1,
            issues: validation.issues,
          });

          if (attempt === MAX_REPAIR_ATTEMPTS) {
            throw new AppError("SCHEMA_VALIDATION", `Output failed schema validation:\n${formatIssues(validation.issues)}`);
          }

          candidateText = await repair(
            conversation,
            candidateText,
            `Your JSON did not satisfy the required schema. Fix exactly these problems and reply with the corrected JSON object only:\n${formatIssues(
              validation.issues,
            )}`,
          );
        }

        throw new AppError("SCHEMA_VALIDATION", "Exhausted repair attempts.");

        /** One repair round-trip. Cheap compared to failing the whole step. */
        async function repair(base: LLMMessage[], previous: string, instruction: string): Promise<string> {
          budget.assertWithinLimits();
          const repairResponse = await withTimeout(
            provider.generate({
              model: agent.model,
              messages: [
                ...base,
                { role: "assistant", content: previous },
                { role: "user", content: instruction },
              ],
              temperature: 0,
              maxTokens: agent.maxTokens,
              responseFormat: schema ? { name: "agent_output", schema } : undefined,
              signal: budget.signal,
              timeoutMs: 60_000,
            }),
            65_000,
            `${agent.name} repair call`,
          );
          inputTokens += repairResponse.usage.inputTokens;
          outputTokens += repairResponse.usage.outputTokens;
          cost += budget.consumeTokens(agent.model, repairResponse.usage.inputTokens, repairResponse.usage.outputTokens);
          return repairResponse.text;
        }
      },
      {
        maxRetries: agent.retryConfig.maxRetries,
        baseDelayMs: agent.retryConfig.baseDelayMs,
        signal: budget.signal,
        onRetry: async (attempt, error, delayMs) => {
          retryCount = attempt;
          bus.emit("step.retry", {
            agentRunId: agentRun.id,
            agentName: agent.name,
            attempt,
            delayMs,
            code: error.code,
            error: error.message,
          });
        },
      },
    );

    const durationMs = Date.now() - startedAt;
    const modelSummary =
      result.json && typeof result.json === "object" && result.json !== null
        ? (result.json as Record<string, unknown>)._summary
        : undefined;
    const reasoningSummary = buildReasoningSummary(
      agent.name,
      toolCalls,
      typeof modelSummary === "string" ? modelSummary : undefined,
    );

    const output: AgentOutput = {
      nodeId: node.id,
      agentName: agent.name,
      text: result.text ?? "",
      json: result.json,
      reasoningSummary,
      toolCalls,
      usage: { inputTokens, outputTokens },
      estimatedCost: cost,
      durationMs,
      model: agent.model,
      retryCount,
    };

    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: "COMPLETED",
        outputText: output.text,
        outputJson: (output.json ?? undefined) as object | undefined,
        reasoningSummary,
        toolCalls: toolCalls as unknown as object,
        inputTokens,
        outputTokens,
        estimatedCost: cost,
        retryCount,
        completedAt: new Date(),
        durationMs,
      },
    });

    bus.emit("step.completed", {
      agentRunId: agentRun.id,
      nodeId: node.id,
      agentName: agent.name,
      durationMs,
      inputTokens,
      outputTokens,
      estimatedCost: cost,
      toolCallCount: toolCalls.length,
      reasoningSummary,
      preview: truncate(output.text || JSON.stringify(output.json ?? {}), 600),
    });

    for (const warning of budget.warnings()) bus.emit("budget.warning", { message: warning });

    return output;
  } catch (err) {
    const appErr = toAppError(err);
    const durationMs = Date.now() - startedAt;

    await prisma.agentRun.update({
      where: { id: agentRun.id },
      data: {
        status: "FAILED",
        error: appErr.message,
        errorCode: appErr.code,
        toolCalls: toolCalls as unknown as object,
        inputTokens,
        outputTokens,
        estimatedCost: cost,
        retryCount,
        completedAt: new Date(),
        durationMs,
      },
    });

    bus.emit("step.failed", {
      agentRunId: agentRun.id,
      nodeId: node.id,
      agentName: agent.name,
      code: appErr.code,
      error: appErr.message,
      durationMs,
    });

    throw appErr;
  }
}
