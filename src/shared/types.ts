// Shared types between main, preload, and renderer.
// Mirrors the shapes Claude Code uses internally (Message, ToolUse, ToolResult, etc.)

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } }
  | { type: 'file'; name: string; mimeType: string; data: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | ContentBlock[];
      is_error?: boolean;
    };

export interface Message {
  id: string;
  role: Role;
  content: ContentBlock[];
  timestamp: number;
  model?: string;
  provider?: string;
  usage?: TokenUsage;
  stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface TokenUsage {
  input: number;
  output: number;
  cache_read?: number;
  cache_write?: number;
}

export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  cwd: string;
  model: string;
  provider: string;
  message_count: number;
  preview?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  free: boolean;
  context_window?: number;
  supports_tools?: boolean;
  supports_vision?: boolean;
}

export interface ProviderInfo {
  id: string;
  label: string;
  requiresApiKey: boolean;
  baseUrl?: string;
  freeModels: ModelInfo[];
  homepage?: string;
}
