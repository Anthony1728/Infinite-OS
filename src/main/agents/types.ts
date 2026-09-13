// Agent type system — defines what a named agent IS:
// its system prompt, allowed tools, model hints, and visual identity.

import type { Message } from '../../shared/types.js';

export type AgentId = 'research' | 'code' | 'design' | 'data' | 'seo' | 'general' | (string & {});

export interface AgentType {
  id: AgentId;
  name: string;
  description: string;
  icon: string;
  color: string;
  systemPrompt: string;
  /** Tools this agent may use. The Agent registry will filter by name. */
  allowedTools: string[];
  /** Optional preferred model override (provider/model). Falls back to session default. */
  preferredModel?: { provider: string; model: string };
  /** Max turns before the subagent is force-stopped. */
  maxTurns?: number;
}

export interface AgentRunState {
  id: string;
  agentId: AgentId;
  sessionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  task: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  /** Live preview of what the agent is doing — updated on each text_delta. */
  preview?: string;
  /** Number of tool calls made so far. */
  toolCallCount: number;
  activity?: AgentActivity[];
}

export interface AgentActivity {
  id: string;
  timestamp: number;
  kind: 'status' | 'tool' | 'result' | 'error';
  label: string;
  detail?: string;
}

export type AgentEvent =
  | { type: 'start'; run: AgentRunState }
  | { type: 'welcome'; runId: string; agentName: string; role: string; model?: string; message: string }
  | { type: 'text_delta'; runId: string; message_id: string; text: string }
  | { type: 'tool_call'; runId: string; toolName: string }
  | { type: 'activity'; runId: string; activity: AgentActivity }
  | { type: 'retrying'; runId: string; attempt: number; reason: string }
  | { type: 'complete'; runId: string; result: string }
  | { type: 'fail'; runId: string; error: string }
  // Live chat-compatible events — the same shapes the automatic agent loop
  // emits, so every agent streams identically (live text, tool cards,
  // provider status). Renderers that only understand the legacy events above
  // safely ignore these.
  | { type: 'message_start'; runId: string; message_id: string }
  | { type: 'provider_start'; runId: string; message_id: string; provider: string; model: string; requested_provider?: string; requested_model?: string; turn: number }
  | { type: 'tool_use_start'; runId: string; message_id: string; tool_use_id: string; name: string }
  | { type: 'tool_use_end'; runId: string; message_id: string; tool_use_id: string; name: string; input: unknown }
  | { type: 'tool_progress'; runId: string; tool_use_id: string; name: string; status: 'running' | 'completed' | 'error'; detail?: string }
  | { type: 'tool_result'; runId: string; tool_use_id: string; content: unknown; is_error?: boolean; partial?: boolean }
  | { type: 'provider_status'; runId: string; status: string; from?: string; to?: string; reason?: string; provider?: string; model?: string }
  | { type: 'message_end'; runId: string; message_id: string; stop_reason?: string }
  | { type: 'message_discard'; runId: string; message_id: string };

/** Helper: load all messages from a session's transcript. */
export type MessageSource = (sessionId: string) => Promise<Message[]>;

