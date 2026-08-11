import { route } from "@/server/api-helpers";
import { getProviderRegistry } from "@/lib/providers/registry";

/**
 * Model catalogue. `available` reflects whether the provider has a key
 * configured server-side — the key itself is never included in the response.
 */
export const GET = route(async () => {
  const registry = getProviderRegistry();
  return {
    providers: registry.list().map((p) => ({ id: p.id, displayName: p.displayName, configured: p.isConfigured })),
    models: registry.allModels().map((model) => ({ ...model, available: registry.availableModels().some((m) => m.id === model.id) })),
  };
});
