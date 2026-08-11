import { describe, expect, it } from "vitest";
import { BudgetTracker, resolveBudget } from "@/lib/orchestration/budget";
import { AppError } from "@/lib/errors";

const limits = resolveBudget({
  maxSteps: 2,
  maxToolCalls: 1,
  maxTokens: 1000,
  maxCostUsd: 0.01,
  timeoutMs: 60_000,
});

describe("BudgetTracker", () => {
  it("stops the run once max steps is reached", () => {
    const tracker = new BudgetTracker(limits);
    tracker.consumeStep();
    tracker.consumeStep();
    expect(() => tracker.consumeStep()).toThrowError(AppError);
  });

  it("stops the run once max tool calls is reached", () => {
    const tracker = new BudgetTracker(limits);
    tracker.consumeToolCall();
    expect(() => tracker.consumeToolCall()).toThrowError(AppError);
  });

  it("accumulates token usage and cost", () => {
    const tracker = new BudgetTracker(resolveBudget({ maxTokens: 100_000, maxCostUsd: 100 }));
    const cost = tracker.consumeTokens("openai:gpt-4o-mini", 1000, 500);
    expect(cost).toBeGreaterThan(0);
    const usage = tracker.usage();
    expect(usage.inputTokens).toBe(1000);
    expect(usage.outputTokens).toBe(500);
    expect(usage.costUsd).toBeCloseTo(cost, 10);
  });

  it("aborts its signal when cancelled", () => {
    const tracker = new BudgetTracker(limits);
    expect(tracker.signal.aborted).toBe(false);
    tracker.cancel("user cancelled");
    expect(tracker.signal.aborted).toBe(true);
  });

  it("merges overrides over the env defaults", () => {
    const merged = resolveBudget({ maxSteps: 7 });
    expect(merged.maxSteps).toBe(7);
    expect(merged.maxToolCalls).toBeGreaterThan(0);
  });
});
