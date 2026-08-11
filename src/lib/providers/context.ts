import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-run provider credential context.
 *
 * A user can store their own OpenAI / Anthropic key in Settings. Those keys
 * must reach the provider layer, which sits five calls below the orchestrator
 * (runner → engine → strategy → agent executor → registry).
 *
 * Threading an extra argument through all of those signatures would touch every
 * strategy for something none of them care about. AsyncLocalStorage keeps the
 * credential exactly where it belongs — ambient to one run — without leaking
 * into the domain layer, and it is naturally isolated between concurrent runs
 * in the same process.
 *
 * The stored value never leaves the server and is never logged.
 */
export type ProviderKeyOverrides = Record<string, string>;

const storage = new AsyncLocalStorage<ProviderKeyOverrides>();

export function runWithProviderKeys<T>(
  keys: ProviderKeyOverrides | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!keys || Object.keys(keys).length === 0) return fn();
  return storage.run(keys, fn);
}

export function getProviderKeyOverrides(): ProviderKeyOverrides | undefined {
  return storage.getStore();
}
