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
  | { type: 'text_delta'; runId: string; text: string }
  | { type: 'tool_call'; runId: string; toolName: string }
  | { type: 'activity'; runId: string; activity: AgentActivity }
  | { type: 'retrying'; runId: string; attempt: number; reason: string }
  | { type: 'complete'; runId: string; result: string }
  | { type: 'fail'; runId: string; error: string };

/** Helper: load all messages from a session's transcript. */
export type MessageSource = (sessionId: string) => Promise<Message[]>;

