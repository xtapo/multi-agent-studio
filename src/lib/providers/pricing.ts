import type { ModelInfo } from "@/types/llm";

/**
 * Model catalogue + pricing.
 *
 * Kept as data rather than fetched at runtime so cost estimates are
 * deterministic and testable. Prices are USD per 1M tokens; update as vendors
 * change them. An unknown model falls back to a conservative default so the
 * cost guardrail can never be bypassed by typing an unlisted model id.
 */
export const MODEL_CATALOGUE: ModelInfo[] = [
  {
    id: "openai:gpt-4o",
    provider: "openai",
    label: "GPT-4o",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    inputCostPerMTok: 2.5,
    outputCostPerMTok: 10,
  },
  {
    id: "openai:gpt-4o-mini",
    provider: "openai",
    label: "GPT-4o mini",
    contextWindow: 128_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    inputCostPerMTok: 0.15,
    outputCostPerMTok: 0.6,
  },
  {
    id: "openai:gpt-4.1",
    provider: "openai",
    label: "GPT-4.1",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    inputCostPerMTok: 2,
    outputCostPerMTok: 8,
  },
  {
    id: "openai:gpt-4.1-mini",
    provider: "openai",
    label: "GPT-4.1 mini",
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsStructuredOutput: true,
    inputCostPerMTok: 0.4,
    outputCostPerMTok: 1.6,
  },
  {
    id: "anthropic:claude-3-5-sonnet-latest",
    provider: "anthropic",
    label: "Claude 3.5 Sonnet",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStructuredOutput: false,
    inputCostPerMTok: 3,
    outputCostPerMTok: 15,
  },
  {
    id: "anthropic:claude-3-5-haiku-latest",
    provider: "anthropic",
    label: "Claude 3.5 Haiku",
    contextWindow: 200_000,
    supportsTools: true,
    supportsStructuredOutput: false,
    inputCostPerMTok: 0.8,
    outputCostPerMTok: 4,
  },
];

const FALLBACK: Omit<ModelInfo, "id" | "provider" | "label"> = {
  contextWindow: 32_000,
  supportsTools: true,
  supportsStructuredOutput: false,
  inputCostPerMTok: 5,
  outputCostPerMTok: 15,
};

export function getModelInfo(modelId: string): ModelInfo {
  const found = MODEL_CATALOGUE.find((m) => m.id === modelId);
  if (found) return found;
  const [provider = "openai", ...rest] = modelId.split(":");
  return { id: modelId, provider, label: rest.join(":") || modelId, ...FALLBACK };
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const info = getModelInfo(modelId);
  return (inputTokens / 1_000_000) * info.inputCostPerMTok + (outputTokens / 1_000_000) * info.outputCostPerMTok;
}
