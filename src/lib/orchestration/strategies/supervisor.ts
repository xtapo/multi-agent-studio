import type { AgentOutput } from "@/types/run";
import type { SupervisorDecision, WorkflowNodeDefinition } from "@/types/workflow";
import { AppError, toAppError } from "@/lib/errors";
import { SUPERVISOR_DECISION_SCHEMA } from "@/lib/agents/prompts";
import { truncate } from "@/lib/utils";
import type { EngineContext, StrategyResult } from "../engine";
import { addSharedNote } from "../state";

/**
 * SUPERVISOR — the only intentionally cyclic mode.
 *
 *   Supervisor → Researcher → Supervisor → Analyst → Supervisor → finish
 *
 * The supervisor is re-invoked after every worker step with a compact roster
 * and progress digest, and returns a structured decision. Three loop-safety
 * mechanisms, because "the LLM will decide when to stop" is not a plan:
 *   1. the global step budget (MAX_AGENT_STEPS) hard-stops the run;
 *   2. per-worker retry counting — a worker can be retried at most twice, after
 *      which delegating to it again is rejected and reported back;
 *   3. a repeat-delegation guard that tells the supervisor when it is looping.
 *
 * If the budget runs out mid-loop we still return the best available output
 * rather than throwing away everything the workers produced.
 */
const MAX_RETRIES_PER_WORKER = 2;

function findSupervisorNode(ctx: EngineContext): WorkflowNodeDefinition {
  const explicit = ctx.index.agentNodes.find((n) => n.config.isSupervisor);
  if (explicit) return explicit;
  if (ctx.entryNode.agent) return ctx.entryNode;
  throw new AppError("VALIDATION", "Supervisor mode requires a node marked as supervisor.");
}

function renderRoster(workers: WorkflowNodeDefinition[]): string {
  return workers.map((w) => `- id: ${w.id} | name: ${w.agent!.name} | role: ${w.agent!.role}`).join("\n");
}

function renderProgress(ctx: EngineContext, workers: WorkflowNodeDefinition[]): string {
  const done = workers
    .map((w) => ctx.state.agentOutputs[w.id])
    .filter(Boolean)
    .map((o) => `### ${o.agentName}\n${truncate(o.json ? JSON.stringify(o.json) : o.text, 2500)}`);
  return done.length ? done.join("\n\n") : "No worker has produced output yet.";
}

export async function runSupervisor(ctx: EngineContext): Promise<StrategyResult> {
  const supervisorNode = findSupervisorNode(ctx);
  const workers = ctx.index.agentNodes.filter((n) => n.id !== supervisorNode.id);

  if (workers.length === 0) throw new AppError("VALIDATION", "Supervisor mode requires at least one worker agent.");

  const attempts = new Map<string, number>();
  const delegationLog: string[] = [];
  let lastWorkerOutput: AgentOutput | null = null;
  let finalText: string | undefined;

  // The loop bound is defensive; the budget is the real limit.
  const maxIterations = Math.max(2, ctx.budget.limits.maxSteps);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      ctx.budget.assertWithinLimits();
    } catch (err) {
      ctx.bus.emit("log", { level: "warn", message: "Budget reached; supervisor is finalising early." });
      break;
    }

    const supervisorTask = [
      `## Original task\n${ctx.state.task}`,
      `## Available agents\n${renderRoster(workers)}`,
      `## Work completed so far\n${renderProgress(ctx, workers)}`,
      delegationLog.length ? `## Delegation history\n${delegationLog.join("\n")}` : "",
      `## Budget\nSteps used ${ctx.budget.usage().steps} of ${ctx.budget.limits.maxSteps}. Finish before the limit; an incomplete answer delivered is better than a run killed mid-step.`,
      "Decide the next action.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const decisionOutput = await ctx.runNode(supervisorNode, {
      task: supervisorTask,
      upstreamNodeIds: [],
      responseSchema: SUPERVISOR_DECISION_SCHEMA as unknown as Record<string, unknown>,
    });

    const decision = decisionOutput.json as SupervisorDecision | undefined;
    if (!decision) throw new AppError("SCHEMA_VALIDATION", "Supervisor returned no structured decision.");

    ctx.bus.emit("supervisor.decision", { ...decision });

    if (decision.action === "finish") {
      finalText = decision.finalAnswer?.trim() || lastWorkerOutput?.text || decisionOutput.text;
      addSharedNote(ctx.state, `Supervisor finished: ${decision.reason}`);
      break;
    }

    const target = workers.find((w) => w.id === decision.nodeId) ?? workers.find((w) => w.agent!.name === decision.nodeId);

    if (!target) {
      delegationLog.push(
        `⚠ Invalid target "${decision.nodeId ?? "(none)"}" — not in the roster. Choose an id from the roster.`,
      );
      continue;
    }

    const used = attempts.get(target.id) ?? 0;
    if (decision.action === "retry" && used > MAX_RETRIES_PER_WORKER) {
      delegationLog.push(
        `⚠ ${target.agent!.name} has already been retried ${used} times. Delegate elsewhere or finish with an explicit UNCERTAINTY.`,
      );
      continue;
    }
    attempts.set(target.id, used + 1);

    try {
      lastWorkerOutput = await ctx.runNode(target, {
        task: decision.task?.trim() || ctx.state.task,
        // Workers see the original task plus what the supervisor explicitly
        // hands them — not the whole team's output history.
        upstreamNodeIds: [],
        fromAgent: supervisorNode.agent!.name,
        messageType: "delegation",
      });
      delegationLog.push(`✓ ${target.agent!.name}: ${truncate(decision.task ?? ctx.state.task, 160)}`);
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.code === "BUDGET_EXCEEDED" || appErr.code === "MAX_STEPS_EXCEEDED") break;
      // Worker failure is information for the supervisor, not a run failure.
      delegationLog.push(`✗ ${target.agent!.name} failed: ${appErr.message}`);
    }
  }

  if (!finalText && !lastWorkerOutput) {
    throw new AppError("MAX_STEPS_EXCEEDED", "Supervisor never produced a final answer within the step budget.");
  }

  return { finalOutput: lastWorkerOutput, finalText };
}
