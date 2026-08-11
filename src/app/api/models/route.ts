import { route } from "@/server/api-helpers";
import { getProviderRegistry, getModelInfo } from "@/lib/providers/registry";

/**
 * Model catalogue. `available` reflects whether the provider has a key
 * configured server-side — the key itself is never included in the response.
 */
export const GET = route(async () => {
  const registry = getProviderRegistry();
  
  // Try to fetch custom models dynamically from providers that support it
  const dynamicModelIds: string[] = [];
  await Promise.all(
    registry.list().map(async (provider) => {
      if (provider.listModels) {
        try {
          const ids = await provider.listModels();
          dynamicModelIds.push(...ids);
        } catch (err) {
          // ignore failures
        }
      }
    })
  );

  const baseModels = registry.allModels();
  const allModels = [...baseModels];
  
  for (const id of dynamicModelIds) {
    if (!allModels.some((m) => m.id === id)) {
      allModels.push(getModelInfo(id));
    }
  }

  const availableProviderIds = new Set(
    registry.list().filter(p => p.isConfigured()).map(p => p.id)
  );

  return {
    providers: registry.list().map((p) => ({ id: p.id, displayName: p.displayName, configured: p.isConfigured() })),
    models: allModels.map((model) => ({ ...model, available: availableProviderIds.has(model.provider) })),
  };
});
