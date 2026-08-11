import { env } from "@/lib/env";
import { OpenAICompatibleProvider } from "./openai";

/**
 * Bring-your-own model provider.
 *
 * Any server that speaks the OpenAI chat-completions dialect works here:
 * Ollama, LM Studio, vLLM, llama.cpp, LiteLLM, OpenRouter, Together, Groq,
 * DeepSeek, Fireworks, or an internal gateway.
 *
 * Why a separate provider id instead of just pointing OPENAI_BASE_URL at it?
 * Because the id is the model prefix, and keeping "custom:" distinct means you
 * can run OpenAI *and* a local model side by side in the same workflow — a
 * common setup where a strong model supervises cheap local workers.
 *
 * Configure with:
 *   CUSTOM_LLM_BASE_URL=http://localhost:11434/v1
 *   CUSTOM_LLM_API_KEY=ollama            # any non-empty value if unauthenticated
 *   CUSTOM_LLM_MODELS=qwen2.5:14b,llama3.1:8b
 *   CUSTOM_LLM_NAME="Ollama (local)"
 */
export class CustomProvider extends OpenAICompatibleProvider {
  constructor(
    apiKey = env.CUSTOM_LLM_API_KEY || (env.CUSTOM_LLM_BASE_URL ? "not-needed" : undefined),
    baseURL = env.CUSTOM_LLM_BASE_URL,
  ) {
    super({ id: "custom", displayName: env.CUSTOM_LLM_NAME || "Custom model", apiKey, baseURL });
  }

  /**
   * A base URL is the real requirement here — many local servers ignore the
   * API key entirely, so keying "configured" off the token would hide a
   * perfectly working endpoint.
   */
  isConfigured(): boolean {
    return Boolean(this.baseURL);
  }
}
