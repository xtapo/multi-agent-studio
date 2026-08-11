import OpenAI from "openai";
import type {
  LLMFinishReason,
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
} from "@/types/llm";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

export interface OpenAICompatibleOptions {
  /** Registry id, also the model-id prefix ("openai" -> "openai:gpt-4o"). */
  id: string;
  displayName: string;
  apiKey?: string;
  baseURL?: string;
}

/**
 * OpenAI-compatible implementation of LLMProvider.
 *
 * This is the ONLY file in the codebase allowed to import the OpenAI SDK.
 * Everything vendor-specific — message shape, tool-call format, JSON schema
 * response format, error mapping — is normalised here.
 *
 * The class is parameterised by id/baseURL so the exact same transport can
 * serve OpenAI itself and any compatible endpoint (Ollama, vLLM, LM Studio,
 * LiteLLM, OpenRouter, Together, Groq, Azure). See `custom.ts`.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly id: string;
  readonly displayName: string;

  protected readonly apiKey?: string;
  protected readonly baseURL?: string;
  private client: OpenAI | null = null;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  protected getClient(): OpenAI {
    if (!this.isConfigured()) {
      throw new AppError("PROVIDER_ERROR", `${this.displayName} is not configured on the server.`);
    }
    // Some local servers accept any non-empty key; we still require a value so
    // the SDK does not fall back to reading process.env implicitly.
    this.client ??= new OpenAI({ apiKey: this.apiKey ?? "not-needed", baseURL: this.baseURL, maxRetries: 0 });
    return this.client;
  }

  async listModels(): Promise<string[]> {
    if (!this.isConfigured()) return [];
    try {
      const response = await this.getClient().models.list();
      return response.data.map((m) => `${this.id}:${m.id}`);
    } catch (err) {
      console.error(`Failed to fetch ${this.displayName} models:`, err);
      return [];
    }
  }

  /** Strip our provider prefix before talking to the vendor API. */
  private bareModel(model: string): string {
    const prefix = `${this.id}:`;
    return model.startsWith(prefix) ? model.slice(prefix.length) : model;
  }

  private toOpenAIMessages(messages: LLMMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "unknown" };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
          })),
        };
      }
      return { role: m.role, content: m.content } as OpenAI.Chat.ChatCompletionMessageParam;
    });
  }

  private buildParams(request: LLMRequest): OpenAI.Chat.ChatCompletionCreateParams {
    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: this.bareModel(request.model),
      messages: this.toOpenAIMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };

    if (request.tools?.length) {
      params.tools = request.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> },
      }));
      params.tool_choice = "auto";
    }

    if (request.responseFormat) {
      params.response_format = {
        type: "json_schema",
        json_schema: {
          name: request.responseFormat.name,
          schema: request.responseFormat.schema as Record<string, unknown>,
          // We keep strict=false by default: strict mode rejects many valid
          // hand-written schemas. Our own validator + repair loop is the
          // authoritative check anyway.
          strict: request.responseFormat.strict ?? false,
        },
      };
    }

    return params;
  }

  private mapFinish(reason: string | null | undefined): LLMFinishReason {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "tool_calls":
      case "function_call":
        return "tool_calls";
      case "content_filter":
        return "content_filter";
      default:
        return "unknown";
    }
  }

  private parseToolCalls(raw: Array<{ id: string; function: { name: string; arguments: string } }> = []): LLMToolCall[] {
    return raw.map((tc) => {
      let args: Record<string, unknown> = {};
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch {
        // Malformed tool arguments are surfaced to the agent loop as an empty
        // object plus a _parseError marker, so it can ask the model to retry
        // instead of the whole run dying on a bad JSON fragment.
        args = { _parseError: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });
  }

  /** Normalise vendor errors onto our retry-aware taxonomy. */
  private mapError(err: unknown): AppError {
    if (err instanceof OpenAI.APIError) {
      const who = this.displayName;
      if (err.status === 429) return new AppError("RATE_LIMITED", `${who} rate limit: ${err.message}`);
      if (err.status === 408) return new AppError("PROVIDER_TIMEOUT", err.message);
      if (err.status && err.status >= 500) return new AppError("PROVIDER_ERROR", `${who} ${err.status}: ${err.message}`);
      return new AppError("PROVIDER_ERROR", `${who} ${err.status ?? ""}: ${err.message}`);
    }
    if (err instanceof Error && err.name === "AbortError") return new AppError("CANCELLED", "Request aborted");
    return new AppError("PROVIDER_ERROR", err instanceof Error ? err.message : String(err));
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    try {
      const completion = await this.getClient().chat.completions.create(
        { ...this.buildParams(request), stream: false },
        { signal: request.signal, timeout: request.timeoutMs },
      );
      const choice = completion.choices[0];
      return {
        model: request.model,
        text: choice?.message?.content ?? "",
        toolCalls: this.parseToolCalls(choice?.message?.tool_calls as any),
        usage: {
          inputTokens: completion.usage?.prompt_tokens ?? 0,
          outputTokens: completion.usage?.completion_tokens ?? 0,
        },
        finishReason: this.mapFinish(choice?.finish_reason),
      };
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    let text = "";
    const toolAccumulator = new Map<number, { id: string; name: string; args: string }>();
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finishReason: LLMFinishReason = "unknown";

    try {
      const stream = await this.getClient().chat.completions.create(
        { ...this.buildParams(request), stream: true, stream_options: { include_usage: true } },
        { signal: request.signal, timeout: request.timeoutMs },
      );

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta;

        if (delta?.content) {
          text += delta.content;
          yield { type: "text-delta", delta: delta.content };
        }

        // Tool calls arrive fragmented across chunks and must be reassembled
        // by index before they can be parsed.
        for (const tc of delta?.tool_calls ?? []) {
          const slot = toolAccumulator.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) slot.id = tc.id;
          if (tc.function?.name) slot.name += tc.function.name;
          if (tc.function?.arguments) slot.args += tc.function.arguments;
          toolAccumulator.set(tc.index, slot);
        }

        if (choice?.finish_reason) finishReason = this.mapFinish(choice.finish_reason);
        if (chunk.usage) {
          usage = { inputTokens: chunk.usage.prompt_tokens ?? 0, outputTokens: chunk.usage.completion_tokens ?? 0 };
        }
      }
    } catch (err) {
      throw this.mapError(err);
    }

    const toolCalls = this.parseToolCalls(
      [...toolAccumulator.values()].map((s) => ({ id: s.id, function: { name: s.name, arguments: s.args } })),
    );
    for (const toolCall of toolCalls) yield { type: "tool-call", toolCall };

    yield { type: "usage", usage };
    yield { type: "done", response: { model: request.model, text, toolCalls, usage, finishReason } };
  }
}

/** OpenAI proper. Also covers Azure and gateways via OPENAI_BASE_URL. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(apiKey = env.OPENAI_API_KEY, baseURL = env.OPENAI_BASE_URL) {
    super({ id: "openai", displayName: "OpenAI", apiKey, baseURL });
  }
}
