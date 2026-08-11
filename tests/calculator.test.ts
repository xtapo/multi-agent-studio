import { describe, expect, it } from "vitest";
import { calculatorTool } from "@/lib/tools/builtin/calculator";

const ctx = {
  workspaceId: "ws",
  runId: "run",
  agentName: "tester",
  config: { name: "calculator", enabled: true },
  log: () => undefined,
};

async function evaluate(expression: string) {
  return (await calculatorTool.execute({ expression }, ctx)) as { result: number };
}

describe("calculator tool", () => {
  it("respects operator precedence", async () => {
    expect((await evaluate("2 + 3 * 4")).result).toBe(14);
  });

  it("handles parentheses and unary minus", async () => {
    expect((await evaluate("-(2 + 3) * 2")).result).toBe(-10);
  });

  it("supports exponentiation and percentages of totals", async () => {
    expect((await evaluate("2 ^ 10")).result).toBe(1024);
    expect((await evaluate("1200 * 0.15")).result).toBeCloseTo(180);
  });

  it("rejects anything that is not arithmetic", async () => {
    await expect(evaluate("process.exit(1)")).rejects.toThrow();
    await expect(evaluate("1 + ")).rejects.toThrow();
  });

  it("rejects division by zero", async () => {
    await expect(evaluate("1 / 0")).rejects.toThrow();
  });
});
