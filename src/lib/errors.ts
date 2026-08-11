/**
 * Typed error taxonomy.
 *
 * Every failure the runtime can produce maps onto one of these codes. The code
 * drives three things: whether we retry, what we persist on AgentRun.errorCode,
 * and what HTTP status the API layer returns. Untyped throws are always treated
 * as non-retryable INTERNAL errors.
 */
export type AppErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_ERROR"
  | "INVALID_JSON_OUTPUT"
  | "SCHEMA_VALIDATION"
  | "TOOL_FAILURE"
  | "TOOL_NOT_PERMITTED"
  | "BUDGET_EXCEEDED"
  | "MAX_STEPS_EXCEEDED"
  | "CANCELLED"
  | "INTERNAL";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_ERROR: 502,
  INVALID_JSON_OUTPUT: 422,
  SCHEMA_VALIDATION: 422,
  TOOL_FAILURE: 500,
  TOOL_NOT_PERMITTED: 403,
  BUDGET_EXCEEDED: 429,
  MAX_STEPS_EXCEEDED: 429,
  CANCELLED: 499,
  INTERNAL: 500,
};

/** Errors worth retrying with exponential backoff. */
const RETRYABLE: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  "RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_ERROR",
  "INVALID_JSON_OUTPUT",
  "SCHEMA_VALIDATION",
]);

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE.has(code);
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  if (e instanceof Error) return new AppError("INTERNAL", e.message);
  return new AppError("INTERNAL", String(e));
}

export function isRetryable(e: unknown): boolean {
  return isAppError(e) ? e.retryable : false;
}
