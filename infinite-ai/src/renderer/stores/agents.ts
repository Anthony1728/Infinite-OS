import { create } from 'zustand';

export interface AgentTypeInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  allowedTools: string[];
  maxTurns: number;
}

export interface AgentRun {
  id: string;
  agentId: string;
  sessionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  task: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  preview?: string;
  toolCallCount: number;
}

interface AgentsState {
  types: AgentTypeInfo[];
  runs: AgentRun[];

  init: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  spawn: (agentId: string, task: string) => Promise<AgentRun | null>;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  types: [],
  runs: [],

  init: async () => {
    const types = (await window.api.listAgents()) as AgentTypeInfo[];
    set({ types });
    // Subscribe to live events
    window.api.onAgentEvent((e: unknown) => {
      const ev = e as { type: string; run?: AgentRun; runId?: string };
      if (ev.type === 'start' && ev.run) {
        set((s) => ({ runs: [ev.run!, ...s.runs.filter((r) => r.id !== ev.run!.id)] }));
      } else if (ev.type === 'text_delta' && ev.runId) {
        set((s) => ({
          runs: s.runs.map((r) => r.id === ev.runId ? { ...r, preview: (r.preview ?? '') + ((e as { text: string }).text) } : r),
        }));
      } else if (ev.type === 'tool_call' && ev.runId) {
        set((s) => ({
          runs: s.runs.map((r) => r.id === ev.runId ? { ...r, toolCallCount: r.toolCallCount + 1 } : r),
        }));
      } else if (ev.type === 'complete' && ev.runId) {
        const result = (e as { result: string }).result;
        set((s) => ({
          runs: s.runs.map((r) => r.id === ev.runId ? { ...r, status: 'completed', completedAt: Date.now(), result } : r),
        }));
      } else if (ev.type === 'fail' && ev.runId) {
        const error = (e as { error: string }).error;
        set((s) => ({
          runs: s.runs.map((r) => r.id === ev.runId ? { ...r, status: 'failed', completedAt: Date.now(), error } : r),
        }));
      }
    });
    // Poll for runs (covers state set by other windows / restarts)
    await get().refreshRuns();
    setInterval(() => { void get().refreshRuns(); }, 3000);
  },

  refreshRuns: async () => {
    const runs = (await window.api.listAgentRuns()) as AgentRun[];
    set({ runs });
  },

  spawn: async (agentId, task) => {
    const currentSessionId = useChatStore.getState().currentSessionId;
    if (!currentSessionId) return null;
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    const run = (await window.api.spawnAgent({
      agentId,
      task,
      sessionId: currentSessionId,
      cwd: settings.cwd ?? '.',
      provider: settings.provider ?? 'openrouter',
      model: settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
    })) as AgentRun;
    return run;
  },
}));

// Re-export the chat store to avoid circular import — we only need the session id.
import { useChatStore } from './chat';
