/**
 * @infinite-ai/core-types
 * Unified type definitions for the Infinite AI orchestrator layer.
 * These types bridge the existing backend with the new orchestrator architecture.
 */

// Re-export existing shared types
export type { Role, ContentBlock, Message, TokenUsage, Session, ModelInfo, ProviderInfo } from '../../src/shared/types';

// Orchestrator-specific types
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ModelProvider {
  id: string;
  name: string;
  generate(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
  stream(messages: ChatMessage[], tools?: ToolDefinition[]): AsyncGenerator<LLMStreamChunk>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AgentAction {
  tool: string;
  payload: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop';
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'error' | 'done';
  text?: string;
  tool_call?: ToolCall;
  tool_result?: string;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AgentConfig {
  provider: string;
  model: string;
  maxTurns?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface AgentTask {
  id: string;
  prompt: string;
  config: AgentConfig;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  toolCalls: ToolCall[];
}

export interface OrchestratorEvent {
  type: 'start' | 'text_delta' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  taskId: string;
  data: Record<string, unknown>;
}

// MCP Tool Registry types
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface MCPRegistry {
  tools: Map<string, MCPTool>;
  register(tool: MCPTool): void;
  unregister(name: string): void;
  get(name: string): MCPTool | undefined;
  list(): MCPTool[];
}
