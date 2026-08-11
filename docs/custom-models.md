# Using your own model

Multi-Agent Studio never calls a vendor SDK from agent code. Everything goes
through `LLMProvider`, so plugging in your own model is configuration, not a
rewrite.

Model ids are always `provider:model`. The prefix selects the provider; the rest
is passed to the endpoint verbatim.

---

## Option A — Any OpenAI-compatible endpoint (no code)

Works with Ollama, LM Studio, vLLM, llama.cpp server, LiteLLM, OpenRouter,
Together, Groq, DeepSeek, Fireworks, or an internal gateway.

### Ollama (fully local, free)

```bash
ollama pull qwen2.5:14b
```

`.env`:

```bash
CUSTOM_LLM_BASE_URL="http://localhost:11434/v1"
CUSTOM_LLM_API_KEY="ollama"          # ignored by Ollama, but must be non-empty
CUSTOM_LLM_NAME="Ollama (local)"
CUSTOM_LLM_MODELS="qwen2.5:14b=Qwen2.5 14B,llama3.1:8b=Llama 3.1 8B"
```

Restart `npm run dev`. The models appear in the Agent Builder as
`custom:qwen2.5:14b`, and Settings shows the provider as **configured**.

### OpenRouter (one key, hundreds of models)

```bash
CUSTOM_LLM_BASE_URL="https://openrouter.ai/api/v1"
CUSTOM_LLM_API_KEY="sk-or-..."
CUSTOM_LLM_NAME="OpenRouter"
CUSTOM_LLM_MODELS="deepseek/deepseek-chat=DeepSeek V3,google/gemini-2.0-flash-001=Gemini 2.0 Flash"
CUSTOM_LLM_INPUT_COST="0.27"          # USD per 1M tokens, for the cost guardrail
CUSTOM_LLM_OUTPUT_COST="1.1"
```

### Azure OpenAI

Azure speaks the OpenAI dialect, so use the built-in provider instead:

```bash
OPENAI_BASE_URL="https://<resource>.openai.azure.com/openai/deployments/<deployment>"
OPENAI_API_KEY="<azure key>"
```

### All custom variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CUSTOM_LLM_BASE_URL` | — | Required. Presence is what marks the provider configured. |
| `CUSTOM_LLM_API_KEY` | `not-needed` | Any non-empty value for unauthenticated servers. |
| `CUSTOM_LLM_NAME` | `Custom model` | Label shown in Settings. |
| `CUSTOM_LLM_MODELS` | — | Comma-separated `id` or `id=Label`. |
| `CUSTOM_LLM_CONTEXT_WINDOW` | `32000` | Informational. |
| `CUSTOM_LLM_SUPPORTS_TOOLS` | `true` | Set `false` for models without function calling. |
| `CUSTOM_LLM_INPUT_COST` | `0` | USD / 1M input tokens. |
| `CUSTOM_LLM_OUTPUT_COST` | `0` | USD / 1M output tokens. |

---

## Option B — A provider with its own protocol

For Gemini's native API, Bedrock, or an in-house service, write a provider:

1. **Implement the interface** in `src/lib/providers/gemini.ts`:

   ```ts
   export class GeminiProvider implements LLMProvider {
     readonly id = "gemini";
     readonly displayName = "Google Gemini";

     isConfigured() { return Boolean(process.env.GEMINI_API_KEY); }

     async generate(request: LLMRequest): Promise<LLMResponse> {
       // translate request.messages / request.tools, call the API, then return
       // { model, text, toolCalls, usage: { inputTokens, outputTokens }, finishReason }
     }

     async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
       // yield { type: "text-delta" | "tool-call" | "usage" | "done", ... }
     }
   }
   ```

2. **Register it** in `src/lib/providers/registry.ts`:

   ```ts
   registry.register(new GeminiProvider());
   ```

3. **Add its models** to `BUILT_IN_MODELS` in `src/lib/providers/pricing.ts` with
   the `gemini:` prefix and real prices.

The orchestration layer, tool loop, budget tracker, retry logic and JSON repair
loop are untouched — they only know `LLMProvider`.

Map vendor errors onto our taxonomy so retries behave: `RATE_LIMITED` and
`PROVIDER_TIMEOUT` are retried with exponential backoff, `PROVIDER_ERROR` is not.

---

## Mixing models in one workflow

Model is a per-agent setting, so the common cost-saving pattern works out of the
box:

| Node | Model | Why |
| --- | --- | --- |
| Supervisor / Router | `openai:gpt-4o` | Needs reliable structured decisions |
| Researcher / Analyst | `custom:qwen2.5:14b` | Bulk work, runs locally, free |
| Writer | `openai:gpt-4o-mini` | Good prose, cheap |

## Practical limits of small models

Be realistic about open-weight models under ~14B:

- **Function calling is unreliable.** Leave their tool list empty, or set
  `CUSTOM_LLM_SUPPORTS_TOOLS=false`.
- **Structured output is worse.** Keep them on `MARKDOWN`; a failing JSON schema
  burns tokens in the repair loop and can fail the step.
- **Supervisor and Router need discipline.** Their decisions are parsed as JSON
  and drive control flow — use a strong model for those two roles.

A good split: strong model for control-flow roles, local model for the workers.
