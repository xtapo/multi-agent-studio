import type { ModelInfo } from "@/types/llm";
import { env } from "@/lib/env";

/**
 * Model catalogue + pricing.
 *
 * Kept as data rather than fetched at runtime so cost estimates are
 * deterministic and testable. Prices are USD per 1M tokens; update as vendors
 * change them. An unknown model falls back to a conservative default so the
 * cost guardrail can never be bypassed by typing an unlisted model id.
 */
const BUILT_IN_MODELS: ModelInfo[] = [
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

/**
 * Models exposed by the custom / local provider.
 *
 * Declared through env so a self-hosted deployment can add models without a
 * code change. Local models cost nothing, so the default price is 0 — which
 * also makes the cost guardrail a no-op for them, as it should be.
 *
 * Format: CUSTOM_LLM_MODELS="qwen2.5:14b,llama3.1:8b=Llama 3.1 8B"
 * (an optional "=Label" suffix overrides the display name)
 */
function customModelsFromEnv(): ModelInfo[] {
  if (!env.CUSTOM_LLM_BASE_URL || !env.CUSTOM_LLM_MODELS) return [];

  return env.CUSTOM_LLM_MODELS.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, label] = entry.split("=").map((part) => part.trim());
      return {
        id: `custom:${name}`,
        provider: "custom",
        label: label || name,
        contextWindow: env.CUSTOM_LLM_CONTEXT_WINDOW,
        supportsTools: env.CUSTOM_LLM_SUPPORTS_TOOLS,
        // Most open-weight servers do not honour json_schema response format.
        // Our validator + repair loop still enforces the contract.
        supportsStructuredOutput: false,
        inputCostPerMTok: env.CUSTOM_LLM_INPUT_COST,
        outputCostPerMTok: env.CUSTOM_LLM_OUTPUT_COST,
      } satisfies ModelInfo;
    });
}

export const MODEL_CATALOGUE: ModelInfo[] = [...BUILT_IN_MODELS, ...customModelsFromEnv()];

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
  // Unlisted custom models are free rather than expensive: the fallback price
  // exists to protect against surprise vendor bills, which do not apply to a
  // self-hosted endpoint.
  const pricing =
    provider === "custom"
      ? { ...FALLBACK, inputCostPerMTok: env.CUSTOM_LLM_INPUT_COST, outputCostPerMTok: env.CUSTOM_LLM_OUTPUT_COST }
      : FALLBACK;

  return { id: modelId, provider, label: rest.join(":") || modelId, ...pricing };
}

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const info = getModelInfo(modelId);
  return (inputTokens / 1_000_000) * info.inputCostPerMTok + (outputTokens / 1_000_000) * info.outputCostPerMTok;
}
