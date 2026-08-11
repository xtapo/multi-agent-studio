/**
 * Provider-agnostic LLM contract.
 *
 * No agent, tool or orchestration file may import the OpenAI SDK. They talk to
 * `LLMProvider` only, which is why adding Anthropic/Gemini/local models is a
 * single new file plus a registry entry.
 */
export type JSONSchema = Record<string, unknown>;

export type LLMRole = "system" | "user" | "assistant" | "tool";

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMMessage {
  role: LLMRole;
  content: string;
  /** Present on assistant messages that requested tools. */
  toolCalls?: LLMToolCall[];
  /** Present on role: "tool" messages, links back to the requesting call. */
  toolCallId?: string;
  name?: string;
}

export interface LLMToolSpec {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface LLMResponseFormat {
  name: string;
  schema: JSONSchema;
  strict?: boolean;
}

export interface LLMRequest {
  /** Canonical model id including provider prefix, e.g. "openai:gpt-4o". */
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: LLMToolSpec[];
  /** When set, the provider asks the model for JSON matching this schema. */
  responseFormat?: LLMResponseFormat;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LLMFinishReason = "stop" | "length" | "tool_calls" | "content_filter" | "unknown";

export interface LLMResponse {
  model: string;
  text: string;
  toolCalls: LLMToolCall[];
  usage: LLMUsage;
  finishReason: LLMFinishReason;
}

export type LLMStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCall: LLMToolCall }
  | { type: "usage"; usage: LLMUsage }
  | { type: "done"; response: LLMResponse };

export interface LLMProvider {
  /** Stable provider id used as the model prefix, e.g. "openai". */
  readonly id: string;
  readonly displayName: string;
  isConfigured(): boolean;
  listModels?(): Promise<string[]>;
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
}

export interface ModelInfo {
  /** Canonical id, e.g. "openai:gpt-4o-mini". */
  id: string;
  provider: string;
  label: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  /** USD per 1M tokens. */
  inputCostPerMTok: number;
  outputCostPerMTok: number;
}
