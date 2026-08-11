import { AppError, isRetryable, toAppError } from "./errors";
import { sleep } from "./utils";

export interface RetryOptions {
  maxRetries: number;
  /** First backoff delay in ms; doubles each attempt. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, error: AppError, delayMs: number) => void | Promise<void>;
  /** Override the default "is this error retryable" decision. */
  shouldRetry?: (error: AppError) => boolean;
}

/**
 * Exponential backoff with full jitter.
 *
 * Full jitter (random between 0 and the computed ceiling) rather than fixed
 * doubling, because several agents in a PARALLEL branch will otherwise hit the
 * provider rate limit again in lockstep.
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const { maxRetries, baseDelayMs = 500, maxDelayMs = 15_000, signal, onRetry, shouldRetry } = opts;

  let lastError: AppError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new AppError("CANCELLED", "Run cancelled");
    try {
      return await fn(attempt);
    } catch (err) {
      const appErr = toAppError(err);
      lastError = appErr;

      const retryable = shouldRetry ? shouldRetry(appErr) : isRetryable(appErr);
      if (!retryable || attempt === maxRetries) throw appErr;

      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const delay = Math.floor(Math.random() * ceiling);
      await onRetry?.(attempt + 1, appErr, delay);
      await sleep(delay, signal);
    }
  }

  throw lastError ?? new AppError("INTERNAL", "withRetry exhausted without an error");
}

/** Rejects with PROVIDER_TIMEOUT if the promise does not settle in time. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError("PROVIDER_TIMEOUT", `${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
