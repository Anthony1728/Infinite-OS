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
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type StreamChunk =
  | { type: 'message_start'; id: string; model: string }
  | { type: 'text_delta'; text: string }
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

