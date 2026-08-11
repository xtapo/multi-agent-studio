import type { LLMProvider, ModelInfo } from "@/types/llm";
import { AppError } from "@/lib/errors";
import { MODEL_CATALOGUE, getModelInfo } from "./pricing";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";

/**
 * Provider registry.
 *
 * Resolution is by the model id prefix ("openai:gpt-4o" -> OpenAIProvider), so
 * an agent never names a vendor. Adding Gemini or a local llama.cpp server is:
 *   1. implement LLMProvider,
 *   2. register it here,
 *   3. add its models to MODEL_CATALOGUE.
 * Nothing in the orchestration layer changes.
 */
class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(providerId: string): LLMProvider {
    const p = this.providers.get(providerId);
    if (!p) throw new AppError("VALIDATION", `Unknown LLM provider "${providerId}".`);
    return p;
  }

  /** Resolve the provider responsible for a canonical model id. */
  forModel(modelId: string): LLMProvider {
    const providerId = modelId.includes(":") ? modelId.split(":")[0] : "openai";
    return this.get(providerId);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  /** Models whose provider currently has credentials configured. */
  availableModels(): ModelInfo[] {
    return MODEL_CATALOGUE.filter((m) => this.providers.get(m.provider)?.isConfigured());
  }

  allModels(): ModelInfo[] {
    return MODEL_CATALOGUE;
  }
}

let registry: ProviderRegistry | null = null;

export function getProviderRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry();
    registry.register(new OpenAIProvider());
    registry.register(new AnthropicProvider());
  }
  return registry;
}

export { getModelInfo };
