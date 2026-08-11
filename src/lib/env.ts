import { z } from "zod";

/**
 * Server-only environment access.
 *
 * Everything in here is validated once at module load so a misconfigured
 * deployment fails fast instead of blowing up inside an agent run. Nothing in
 * this file may ever be imported from a client component — the API keys live
 * here and must never be serialized into the RSC payload.
 */
const boolean = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const schema = z.object({
  DATABASE_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(16).default("dev-only-insecure-secret-change-me"),

  ENCRYPTION_KEY: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Bring-your-own / local model served over an OpenAI-compatible API.
  CUSTOM_LLM_BASE_URL: z.string().url().optional(),
  CUSTOM_LLM_API_KEY: z.string().optional(),
  CUSTOM_LLM_NAME: z.string().optional(),
  CUSTOM_LLM_MODELS: z.string().optional(),
  CUSTOM_LLM_CONTEXT_WINDOW: z.coerce.number().int().positive().default(32_000),
  CUSTOM_LLM_SUPPORTS_TOOLS: boolean("true"),
  CUSTOM_LLM_INPUT_COST: z.coerce.number().min(0).default(0),
  CUSTOM_LLM_OUTPUT_COST: z.coerce.number().min(0).default(0),

  TAVILY_API_KEY: z.string().optional(),
  HTTP_TOOL_ALLOWED_HOSTS: z.string().optional().default(""),

  MAX_AGENT_STEPS: z.coerce.number().int().positive().default(20),
  MAX_TOOL_CALLS: z.coerce.number().int().positive().default(40),
  MAX_RUN_TOKENS: z.coerce.number().int().positive().default(200_000),
  MAX_RUN_COST_USD: z.coerce.number().positive().default(2),
  RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),

  // Durable execution. Off by default so `npm run dev` works with a single
  // process; on in production, where `npm run worker` does the executing.
  RUN_QUEUE_ENABLED: boolean("false"),
  RUN_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // A RUNNING run whose worker died is reaped after this long without progress.
  RUN_STALE_AFTER_MS: z.coerce.number().int().positive().default(900_000),
  // How often a running execution checks whether it was cancelled elsewhere.
  RUN_CANCEL_POLL_MS: z.coerce.number().int().positive().default(3_000),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("\u274c Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment configuration. See .env.example.");
}

export const env = parsed.data;

export const httpToolAllowedHosts = env.HTTP_TOOL_ALLOWED_HOSTS.split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

export const defaultBudgetFromEnv = {
  maxSteps: env.MAX_AGENT_STEPS,
  maxToolCalls: env.MAX_TOOL_CALLS,
  maxTokens: env.MAX_RUN_TOKENS,
  maxCostUsd: env.MAX_RUN_COST_USD,
  timeoutMs: env.RUN_TIMEOUT_MS,
};
