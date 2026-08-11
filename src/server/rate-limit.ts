import { AppError } from "@/lib/errors";

/**
 * Fixed-window in-memory rate limiter.
 *
 * Deliberately not Redis. A self-hosted single-instance deployment gets useful
 * protection with zero infrastructure, and the interface is narrow enough that
 * swapping in Redis for a multi-instance deployment touches only this file.
 * Documented limitation: limits are per process, so N instances allow N× the
 * quota.
 */
interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

// Cheap sweep so an idle process does not retain every key it has ever seen.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, window] of windows) if (window.resetAt <= now) windows.delete(key);
}

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  /** Expensive: every call can start a chain of LLM requests. */
  runWorkflow: { limit: 10, windowMs: 60_000 },
  /** Ordinary CRUD. */
  write: { limit: 60, windowMs: 60_000 },
  /** Unauthenticated — the only endpoint reachable without a session. */
  signUp: { limit: 5, windowMs: 15 * 60_000 },
} satisfies Record<string, RateLimitRule>;

export function rateLimit(key: string, rule: RateLimitRule): void {
  const now = Date.now();
  sweep(now);

  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + rule.windowMs });
    return;
  }

  current.count += 1;
  if (current.count > rule.limit) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    throw new AppError("RATE_LIMITED", `Too many requests. Try again in ${retryAfter}s.`, { retryAfter });
  }
}
