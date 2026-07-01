// Provider adapter interface — every LLM provider implements this.

import type { Message, ModelInfo, TokenUsage } from '../../shared/types.js';

export interface ChatRequest {
  model: string;
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
  | { type: 'message_end'; stop_reason: string; usage: TokenUsage }
  | { type: 'error'; error: string };

export interface ProviderAdapter {
  id: string;
  label: string;
  requiresApiKey: boolean;
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

