import type { RunBudget } from "@/types/run";
import { AppError } from "@/lib/errors";
import { estimateCost } from "@/lib/providers/pricing";
import { defaultBudgetFromEnv } from "@/lib/env";

/**
 * Runtime guardrails.
 *
 * Every LLM call and every tool call must go through this object *before* it
 * runs. That is the whole design: limits enforced by prompt text are
 * suggestions, limits enforced by a counter the model cannot reach are
 * guarantees. A single BudgetTracker instance is threaded through one run, so
 * parallel branches share one pool and cannot collectively overshoot.
 */
export interface BudgetUsage {
  steps: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  elapsedMs: number;
}

export function resolveBudget(...overrides: Array<Partial<RunBudget> | null | undefined>): RunBudget {
  return overrides.reduce<RunBudget>(
    (acc, o) => ({ ...acc, ...Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v != null)) }),
    { ...defaultBudgetFromEnv },
  );
}

export class BudgetTracker {
  private steps = 0;
  private toolCalls = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private costUsd = 0;
  private readonly startedAt = Date.now();
  private readonly controller = new AbortController();

  constructor(readonly limits: RunBudget) {}

  /** Abort signal handed to providers and tools so a breach cancels in-flight work. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  cancel(): void {
    this.controller.abort();
  }

  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  get remainingMs(): number {
    return Math.max(0, this.limits.timeoutMs - this.elapsedMs);
  }

  usage(): BudgetUsage {
    return {
      steps: this.steps,
      toolCalls: this.toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.inputTokens + this.outputTokens,
      costUsd: this.costUsd,
      elapsedMs: this.elapsedMs,
    };
  }

  /** Throws if any limit is already breached. Called before every unit of work. */
  assertWithinLimits(): void {
    if (this.elapsedMs > this.limits.timeoutMs) {
      this.cancel();
      throw new AppError("BUDGET_EXCEEDED", `Run exceeded the time limit of ${this.limits.timeoutMs}ms.`);
    }
    if (this.steps >= this.limits.maxSteps) {
      this.cancel();
      throw new AppError(
        "MAX_STEPS_EXCEEDED",
        `Run reached the maximum of ${this.limits.maxSteps} agent steps. This usually means a supervisor or debate loop is not converging.`,
      );
    }
    if (this.inputTokens + this.outputTokens >= this.limits.maxTokens) {
      this.cancel();
      throw new AppError("BUDGET_EXCEEDED", `Run exceeded the token budget of ${this.limits.maxTokens}.`);
    }
    if (this.costUsd >= this.limits.maxCostUsd) {
      this.cancel();
      throw new AppError("BUDGET_EXCEEDED", `Run exceeded the cost limit of $${this.limits.maxCostUsd}.`);
    }
  }

  consumeStep(): number {
    this.assertWithinLimits();
    return ++this.steps;
  }

  consumeToolCall(): void {
    if (this.toolCalls >= this.limits.maxToolCalls) {
      throw new AppError("BUDGET_EXCEEDED", `Run reached the maximum of ${this.limits.maxToolCalls} tool calls.`);
    }
    this.toolCalls++;
  }

  /** Records usage after a completed call and returns the incremental cost. */
  consumeTokens(model: string, inputTokens: number, outputTokens: number): number {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    const cost = estimateCost(model, inputTokens, outputTokens);
    this.costUsd += cost;
    return cost;
  }

  /** Soft signals surfaced to the UI before a hard stop happens. */
  warnings(): string[] {
    const out: string[] = [];
    const u = this.usage();
    if (u.totalTokens > this.limits.maxTokens * 0.8) out.push("80% of the token budget consumed.");
    if (u.costUsd > this.limits.maxCostUsd * 0.8) out.push("80% of the cost budget consumed.");
    if (u.steps > this.limits.maxSteps * 0.8) out.push("80% of the step budget consumed.");
    return out;
  }
}
