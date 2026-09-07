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
  activity?: AgentActivity[];
}

export interface AgentActivity {
  id: string;
  timestamp: number;
  kind: 'status' | 'tool' | 'result' | 'error';
  label: string;
  detail?: string;
}

let unsubscribeAgentEvents: (() => void) | null = null;
let runsPoll: ReturnType<typeof setInterval> | null = null;

export interface ChatTask {
  id: string;
  title: string;
  status: 'working' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  filesCreated?: string[];
  error?: string;
}

export interface OrchestratorSubTask {
  id: string;
  taskId: string;
  agentType: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  filesCreated?: string[];
}

interface AgentsState {
  types: AgentTypeInfo[];
  runs: AgentRun[];
  chatTasks: ChatTask[];
  subTasks: OrchestratorSubTask[];

  init: () => Promise<void>;
  refreshRuns: () => Promise<void>;
  spawn: (agentId: string, task: string, modelOverride?: { provider?: string; model?: string }) => Promise<AgentRun | null>;
  abort: (runId: string) => Promise<void>;
  getRunsByStatus: (status: AgentRun['status']) => AgentRun[];
  addChatTask: (title: string) => string;
  completeChatTask: (id: string, files?: string[]) => void;
  failChatTask: (id: string, error?: string) => void;
  addSubTask: (taskId: string, subTaskId: string, agentType: string, description: string) => void;
  completeSubTask: (subTaskId: string, result: string, files?: string[]) => void;
  failSubTask: (subTaskId: string, error: string) => void;
  clearOldSubTasks: () => void;
}

export const useAgentsStore = create<AgentsState>((set, get) => ({
  types: [],
  runs: [],
  chatTasks: [],
  subTasks: [],

  init: async () => {
    const types = (await window.api.listAgents()) as AgentTypeInfo[];
    set({ types });

    // Subscribe to live events
    unsubscribeAgentEvents?.();
    unsubscribeAgentEvents = window.api.onAgentEvent((e: unknown) => {
      const ev = e as { type: string; run?: AgentRun; runId?: string };
      if (ev.type === 'start' && ev.run) {
        set((s) => ({ runs: [ev.run!, ...s.runs.filter((r) => r.id !== ev.run!.id)] }));
      } else if (ev.type === 'text_delta' && ev.runId) {
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === ev.runId ? { ...r, preview: ((r.preview ?? '') + (e as { text: string }).text).slice(-800) } : r
          ),
        }));
      } else if (ev.type === 'tool_call' && ev.runId) {
        set((s) => ({
          runs: s.runs.map((r) => (r.id === ev.runId ? { ...r, toolCallCount: r.toolCallCount + 1 } : r)),
        }));
      } else if (ev.type === 'activity' && ev.runId) {
        const item = (e as { activity: AgentActivity }).activity;
        set((s) => ({
          runs: s.runs.map((r) => r.id === ev.runId
            ? { ...r, activity: [...(r.activity ?? []), item].slice(-100), preview: item.detail || item.label }
            : r),
        }));
      } else if (ev.type === 'complete' && ev.runId) {
        const result = (e as { result: string }).result;
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === ev.runId && (r.status === 'queued' || r.status === 'running')
              ? { ...r, status: 'completed', completedAt: Date.now(), result }
              : r
          ),
        }));
      } else if (ev.type === 'fail' && ev.runId) {
        const error = (e as { error: string }).error;
        set((s) => ({
          runs: s.runs.map((r) =>
            r.id === ev.runId && (r.status === 'queued' || r.status === 'running')
              ? { ...r, status: 'failed', completedAt: Date.now(), error }
              : r
          ),
        }));
      }
    });

    // Poll for runs (covers state set by other windows / restarts)
    await get().refreshRuns();
    if (runsPoll) clearInterval(runsPoll);
    runsPoll = setInterval(() => { void get().refreshRuns(); }, 3000);
  },

  refreshRuns: async () => {
    const runs = (await window.api.listAgentRuns()) as AgentRun[];
    set({ runs });
  },

  spawn: async (agentId, task, modelOverride) => {
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');

    // Resolve session — auto-create if needed so agents always work
    let sessionId = useChatStore.getState().currentSessionId;
    if (!sessionId) {
      try {
        const session = await window.api.createSession({
          cwd: settings.cwd ?? '.',
          model: settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
          provider: settings.provider ?? 'openrouter',
          title: `Agent: ${agentId}`,
        });
        sessionId = session.id;
        // Push new session into chat store without switching to chat view
        useChatStore.setState((s) => ({
          sessions: [session, ...s.sessions],
          currentSessionId: session.id,
        }));
      } catch (e) {
        console.error('[agents] Could not auto-create session:', e);
        return null;
      }
    }

    const run = (await window.api.spawnAgent({
      agentId,
      task,
      sessionId,
      cwd: settings.cwd ?? '.',
      provider: modelOverride?.provider ?? settings.provider ?? 'openrouter',
      model: modelOverride?.model ?? settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
    })) as AgentRun;
    set((s) => ({ runs: [run, ...s.runs.filter((item) => item.id !== run.id)] }));
    return run;
  },

  abort: async (runId) => {
    const result = await window.api.abortAgent({ runId }) as { ok: boolean; error?: string };
    if (!result.ok) throw new Error(result.error || 'Could not cancel the agent run.');
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId && (r.status === 'queued' || r.status === 'running')
          ? { ...r, status: 'cancelled', completedAt: Date.now() }
          : r
      ),
    }));
  },

  getRunsByStatus: (status) => {
    return get().runs.filter((r) => r.status === status);
  },

  addChatTask: (title) => {
    const task: ChatTask = {
      id: crypto.randomUUID(),
      title,
      status: 'working',
      startedAt: Date.now(),
    };
    set((s) => ({ chatTasks: [task, ...s.chatTasks].slice(0, 50) }));
    return task.id;
  },

  completeChatTask: (id, files) => {
    set((s) => ({
      chatTasks: s.chatTasks.map(t =>
        t.id === id && t.status === 'working'
          ? { ...t, status: 'completed', completedAt: Date.now(), filesCreated: files }
          : t
      ),
    }));
  },

  failChatTask: (id, error) => {
    set((s) => ({
      chatTasks: s.chatTasks.map(t =>
        t.id === id && t.status === 'working'
          ? { ...t, status: 'failed', completedAt: Date.now(), error }
          : t
      ),
    }));
  },

  addSubTask: (taskId, subTaskId, agentType, description) => {
    const sub: OrchestratorSubTask = {
      id: subTaskId,
      taskId,
      agentType,
      description,
      status: 'running',
      startedAt: Date.now(),
    };
    set((s) => ({ subTasks: [sub, ...s.subTasks].slice(0, 100) }));
  },

  completeSubTask: (subTaskId, result, files) => {
    set((s) => ({
      subTasks: s.subTasks.map(t =>
        t.id === subTaskId && (t.status === 'pending' || t.status === 'running')
          ? { ...t, status: 'completed', completedAt: Date.now(), result, filesCreated: files }
          : t
      ),
    }));
  },

  failSubTask: (subTaskId, error) => {
    set((s) => ({
      subTasks: s.subTasks.map(t =>
        t.id === subTaskId && (t.status === 'pending' || t.status === 'running')
          ? { ...t, status: 'failed', completedAt: Date.now(), error }
          : t
      ),
    }));
  },

  clearOldSubTasks: () => {
    const cutoff = Date.now() - 5 * 60 * 1000; // 5 minutes
    set((s) => ({
      subTasks: s.subTasks.filter(t => t.completedAt == null || t.completedAt > cutoff),
    }));
  },
}));

// Re-export the chat store to avoid circular import — we only need the session id.
import { useChatStore } from './chat';

