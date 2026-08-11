import type { LLMProvider, ModelInfo } from "@/types/llm";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { MODEL_CATALOGUE, getModelInfo } from "./pricing";
import { OpenAIProvider } from "./openai";
import { AnthropicProvider } from "./anthropic";
import { CustomProvider } from "./custom";
import { getProviderKeyOverrides, type ProviderKeyOverrides } from "./context";

/**
 * Provider registry.
 *
 * Resolution is by the model id prefix ("openai:gpt-4o" -> OpenAIProvider), so
 * an agent never names a vendor. Adding Gemini or a local llama.cpp server is:
 *   1. implement LLMProvider,
 *   2. register it here,
 *   3. add its models to MODEL_CATALOGUE.
 * Nothing in the orchestration layer changes.
 *
 * Credentials come from the environment by default. If the current async
 * context carries user-supplied keys (see `context.ts`), those take precedence
 * for that run only — the server-wide keys remain the fallback, so a user who
 * has not added a key still uses the deployment's.
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

export type { ProviderRegistry };

function buildRegistry(overrides: ProviderKeyOverrides = {}): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new OpenAIProvider(overrides.openai || env.OPENAI_API_KEY, env.OPENAI_BASE_URL));
  registry.register(new AnthropicProvider(overrides.anthropic || env.ANTHROPIC_API_KEY));
  // Always registered so the Settings page can report it as "not configured";
  // it only becomes usable once CUSTOM_LLM_BASE_URL is set. A self-hosted
  // endpoint is a deployment concern, so it is deliberately not overridable
  // per user.
  registry.register(new CustomProvider());
  return registry;
}

let envRegistry: ProviderRegistry | null = null;

// Registries built from user keys are cached so we do not construct a new SDK
// client on every single model call inside a run. Bounded, because the key set
// is per user and this map would otherwise grow with the user table.
const MAX_CACHED = 50;
const overrideRegistries = new Map<string, ProviderRegistry>();

export function getProviderRegistry(): ProviderRegistry {
  const overrides = getProviderKeyOverrides();

  if (!overrides || Object.keys(overrides).length === 0) {
    envRegistry ??= buildRegistry();
    return envRegistry;
  }

  const cacheKey = Object.keys(overrides)
    .sort()
    .map((provider) => `${provider}:${overrides[provider]}`)
    .join("|");

  let registry = overrideRegistries.get(cacheKey);
  if (!registry) {
    if (overrideRegistries.size >= MAX_CACHED) overrideRegistries.clear();
    registry = buildRegistry(overrides);
    overrideRegistries.set(cacheKey, registry);
  }
  return registry;
}

export { getModelInfo };
