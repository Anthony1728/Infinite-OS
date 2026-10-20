// Provider adapter interface — every LLM provider implements this.

import type { Message, ModelInfo, TokenUsage } from '../../shared/types.js';

export interface ChatRequest {
  model: string;
  cwd?: string;
  messages: Message[];
  system?: string;
  tools?: ToolSpec[];
  max_tokens?: number;
  temperature?: number;
  stream: true;
  signal?: AbortSignal;
  /**
   * Ask the provider to emit its reasoning as a separate channel.
   *
   * Off by default because a reasoning model on a slow machine can spend its
   * whole output budget reasoning and return no answer at all — measured here as
   * a 1.7b model taking 41 s and returning an empty reply for "17x23". Providers
   * that support it handle a `false` by simply not reasoning.
   */
  thinking?: boolean;
  /**
   * Hard cap on reasoning tokens, when the provider allows one. Providers that
   * cannot separate the two budgets ignore this.
   */
  thinkingBudget?: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type StreamChunk =
  | { type: 'message_start'; id: string; model: string }
  | { type: 'text_delta'; text: string }
  /**
   * A piece of the model's reasoning.
   *
   * A distinct channel from `text_delta` on purpose. Reasoning is shown to the
   * user as collapsible "thinking" and is stored apart from the answer; if it
   * arrived as ordinary text it would be indistinguishable from the answer and
   * would be replayed to the model on the next turn.
   */
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partial_json: string }
  | { type: 'tool_use_end'; id: string; name: string; input: unknown }
  | {
      type: 'provider_progress';
      id: string;
      name: string;
      status: 'running' | 'completed' | 'error';
      input?: unknown;
      detail?: string;
    }
  | {
      type: 'provider_status';
      status: 'connecting' | 'streaming' | 'failover' | 'cold_start' | 'rate_limited' | 'error';
      provider?: string;
      model?: string;
      from?: string;
      to?: string;
      reason?: string;
    }
  | { type: 'message_end'; stop_reason: string; usage: TokenUsage }
  | { type: 'error'; error: string };

export interface ProviderAdapter {
  id: string;
  label: string;
  requiresApiKey: boolean;
  /** The provider also works without a key, but can accept one for subscription models. */
  acceptsApiKey?: boolean;
  defaultBaseUrl?: string;
  defaultModel: string;
  freeModels: ModelInfo[];
  homepage?: string;
  /** Test that a key works. */
  testConnection(apiKey: string, baseUrl?: string): Promise<{ ok: boolean; error?: string }>;
  /** Fetch the live model list. */
  listModels(apiKey: string, baseUrl?: string): Promise<ModelInfo[]>;
  /** Stream a chat completion. */
  streamChat(req: ChatRequest, apiKey: string, baseUrl?: string): AsyncIterable<StreamChunk>;
}