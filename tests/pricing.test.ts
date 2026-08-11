import { describe, expect, it } from "vitest";
import { MODEL_CATALOGUE, estimateCost, getModelInfo } from "@/lib/providers/pricing";

describe("model catalogue", () => {
  it("uses canonical provider:model ids", () => {
    for (const model of MODEL_CATALOGUE) {
      expect(model.id.startsWith(`${model.provider}:`)).toBe(true);
    }
  });

  it("returns catalogue entries verbatim", () => {
    const info = getModelInfo("openai:gpt-4o-mini");
    expect(info.label).toBe("GPT-4o mini");
    expect(info.inputCostPerMTok).toBe(0.15);
  });

  it("falls back safely for an unlisted vendor model", () => {
    const info = getModelInfo("openai:some-future-model");
    expect(info.provider).toBe("openai");
    expect(info.label).toBe("some-future-model");
    // The fallback must not be free, otherwise the cost guardrail could be
    // bypassed by typing an unknown model id.
    expect(info.inputCostPerMTok).toBeGreaterThan(0);
  });

  it("keeps colons inside the model name when splitting the prefix", () => {
    // Ollama-style tags contain a colon: custom:qwen2.5:14b
    const info = getModelInfo("custom:qwen2.5:14b");
    expect(info.provider).toBe("custom");
    expect(info.label).toBe("qwen2.5:14b");
  });

  it("computes cost per million tokens", () => {
    // 1M in + 1M out on gpt-4o = 2.5 + 10
    expect(estimateCost("openai:gpt-4o", 1_000_000, 1_000_000)).toBeCloseTo(12.5, 6);
    expect(estimateCost("openai:gpt-4o", 0, 0)).toBe(0);
  });
});
