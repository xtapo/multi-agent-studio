import type { LLMProvider, LLMRequest, LLMResponse, LLMStreamEvent, LLMToolCall } from "@/types/llm";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Anthropic implementation — proof that the abstraction holds.
 *
 * Written against the raw Messages API with fetch so it adds no dependency.
 * Two vendor differences are absorbed here rather than leaking upward:
 *   1. the system prompt is a top-level field, not a message;
 *   2. there is no json_schema response format, so a structured-output request
 *      is translated into a strict instruction + prefill. Our own validator and
 *      repair loop then enforce the schema exactly as it does for OpenAI.
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly displayName = "Anthropic";

  constructor(private readonly apiKey = env.ANTHROPIC_API_KEY) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  private bareModel(model: string): string {
    return model.startsWith("anthropic:") ? model.slice("anthropic:".length) : model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) throw new AppError("PROVIDER_ERROR", "ANTHROPIC_API_KEY is not configured on the server.");

    const systemParts = request.messages.filter((m) => m.role === "system").map((m) => m.content);
    if (request.responseFormat) {
      systemParts.push(
        `You must reply with a single JSON object that validates against this JSON Schema. No prose, no code fences.\n${JSON.stringify(
          request.responseFormat.schema,
        )}`,
      );
    }

    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: request.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.bareModel(request.model),
          system: systemParts.join("\n\n") || undefined,
          messages,
          max_tokens: request.maxTokens ?? 2048,
          temperature: request.temperature,
          tools: request.tools?.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          })),
        }),
      });
    } catch (err) {
      throw new AppError("PROVIDER_ERROR", err instanceof Error ? err.message : String(err));
    }

    if (res.status === 429) throw new AppError("RATE_LIMITED", "Anthropic rate limit");
    if (!res.ok) throw new AppError("PROVIDER_ERROR", `Anthropic ${res.status}: ${await res.text()}`);

    const data: any = await res.json();
    const text = (data.content ?? [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("");
    const toolCalls: LLMToolCall[] = (data.content ?? [])
      .filter((c: any) => c.type === "tool_use")
      .map((c: any) => ({ id: c.id, name: c.name, arguments: c.input ?? {} }));

    return {
      model: request.model,
      text,
      toolCalls,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      finishReason: data.stop_reason === "tool_use" ? "tool_calls" : data.stop_reason === "max_tokens" ? "length" : "stop",
    };
  }

  /**
   * Non-incremental streaming: we emit the completed response as a single
   * delta. Callers only rely on the event sequence, not on chunk granularity,
   * so this stays correct while keeping the file dependency-free.
   */
  async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const response = await this.generate(request);
    if (response.text) yield { type: "text-delta", delta: response.text };
    for (const toolCall of response.toolCalls) yield { type: "tool-call", toolCall };
    yield { type: "usage", usage: response.usage };
    yield { type: "done", response };
  }
}
