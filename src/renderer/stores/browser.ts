import { create } from 'zustand';

export interface BrowserSession {
  id: string;
  name: string;
  url: string;
  createdAt: number;
}

export interface BrowserStats {
  totalSessions: number;
  totalActions: number;
}

interface BrowserState {
  sessions: BrowserSession[];
  stats: BrowserStats | null;
  activeSession: string | null;
  loading: boolean;
  loadSessions: () => Promise<void>;
  loadStats: () => Promise<void>;
  createSession: (name?: string) => Promise<string>;
  navigate: (sessionId: string, url: string) => Promise<void>;
  click: (sessionId: string, selector: string) => Promise<void>;
  type: (sessionId: string, selector: string, text: string) => Promise<void>;
  screenshot: (sessionId: string) => Promise<string>;
  extract: (sessionId: string, selector: string) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  setActiveSession: (id: string | null) => void;
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
  sessions: [],
  stats: null,
  activeSession: null,
  loading: false,

  loadSessions: async () => {
    set({ loading: true });
    try {
      const sessions = await window.api.browserListSessions() as BrowserSession[];
      set({ sessions, loading: false });
    } catch { set({ loading: false }); }
  },

  loadStats: async () => {
    try {
      const stats = await window.api.browserStats() as BrowserStats;
      set({ stats });
    } catch { /* silent */ }
  },

  createSession: async (name) => {
    const result = await window.api.browserCreateSession({ name: name || 'New Session' }) as { id: string };
    await get().loadSessions();
    set({ activeSession: result.id });
    return result.id;
  },

  navigate: async (sessionId, url) => {
    await window.api.browserNavigate({ sessionId, url });
  },

  click: async (sessionId, selector) => {
    await window.api.browserClick({ sessionId, selector });
  },

  type: async (sessionId, selector, text) => {
    await window.api.browserType({ sessionId, selector, text });
  },

  screenshot: async (sessionId) => {
    const result = await window.api.browserScreenshot({ sessionId }) as { dataUrl: string };
    return result.dataUrl;
  },

  extract: async (sessionId, selector) => {
    const result = await window.api.browserExtract({ sessionId, selector }) as { content: string };
    return result.content;
  },

  deleteSession: async (sessionId) => {
    await window.api.browserDeleteSession({ sessionId });
    await get().loadSessions();
    if (get().activeSession === sessionId) set({ activeSession: null });
  },

  setActiveSession: (id) => set({ activeSession: id }),
}));

