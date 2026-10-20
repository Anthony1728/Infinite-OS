// Session Board store — kanban front-end for the main-process SessionBoard.
// Mirrors Session/BoardStats shapes from src/main/agent/session-board.ts and
// applies main → renderer pushes so the board stays live without polling.

import { create } from 'zustand';

export type SessionType = 'orchestrator' | 'crew' | 'standalone';
export type SessionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SessionWorktree {
  agentName: string;
  path: string;
  branch: string;
}

export interface Session {
  id: string;
  title: string;
  description?: string;
  type: SessionType;
  status: SessionStatus;
  startedAt?: number;
  completedAt?: number;
  worktree?: SessionWorktree;
  isolation?: string;
  agentId?: string;
  model?: string;
  provider?: string;
  cwd: string;
  progress: number;
  currentStep?: string;
  error?: string;
  results?: Record<string, string>;
  runRef?: string;
  taskId?: string;
}

export interface BoardStats {
  total: number;
  active: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export interface SessionBoardState {
  sessions: Session[];
  stats: BoardStats;
  initialized: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  create: (type: SessionType, title: string, options?: Partial<Session>) => Promise<Session>;
  start: (sessionId: string, task: string, agentId?: string, model?: string, provider?: string) => Promise<void>;
  cancel: (sessionId: string) => Promise<void>;
  interject: (sessionId: string, message: string) => Promise<void>;
}

let unsubscribe: (() => void) | null = null;

export const useSessionBoardStore = create<SessionBoardState>((set, get) => ({
  sessions: [],
  stats: { total: 0, active: 0, running: 0, queued: 0, completed: 0, failed: 0, cancelled: 0 },
  initialized: false,

  init: async () => {
    unsubscribe?.();
    unsubscribe = window.api.onSessionBoardEvent((e: unknown) => {
      const event = e as { type: string; sessionId: string; data: Session };
      set((s) => {
        if (event.type === 'session_created' && !s.sessions.some((x) => x.id === event.sessionId)) {
          return { sessions: [...s.sessions, event.data] };
        }
        return { sessions: s.sessions.map((x) => (x.id === event.sessionId ? { ...x, ...event.data } : x)) };
      });
    });
    await get().refresh();
    set({ initialized: true });
  },

  refresh: async () => {
    const board = (await window.api.sessionBoardList()) as {
      columns: Record<SessionStatus, Session[]>;
      stats: BoardStats;
    };
    const merged = new Map<string, Session>();
    for (const col of (['queued', 'running', 'completed', 'failed', 'cancelled'] as SessionStatus[])) {
      for (const session of board.columns[col] ?? []) merged.set(session.id, session);
    }
    set({ sessions: Array.from(merged.values()), stats: board.stats });
  },

  create: async (type, title, options) => {
    const session = (await window.api.sessionBoardCreate({
      title,
      options: { ...options, type },
    })) as Session;
    set((s) => ({ sessions: [...s.sessions, session] }));
    return session;
  },

  start: async (sessionId, task, agentId, model, provider) => {
    const session = (await window.api.sessionBoardStart({
      sessionId,
      task,
      agentId,
      model,
      provider,
    })) as Session;
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, ...session } : x)) }));
  },

  cancel: async (sessionId) => {
    await window.api.sessionBoardCancel({ sessionId });
  },

  interject: async (sessionId, message) => {
    await window.api.sessionBoardInterject({ sessionId, message });
  },
}));