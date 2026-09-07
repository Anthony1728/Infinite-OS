import { create } from 'zustand';

export interface TerminalTab {
  id: string; // pty sessionId or 'pending'
  title: string;
  cwd: string;
  pid: number;
  status: 'connecting' | 'running' | 'exited';
  exitCode?: number;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeId: string | null;
  addTab: (t: TerminalTab) => void;
  updateTab: (id: string, patch: Partial<TerminalTab>) => void;
  removeTab: (id: string) => void;
  setActive: (id: string | null) => void;
  clear: () => void;
}

let counter = 0;

export function nextTerminalTitle(): string {
  counter += 1;
  return `Term ${counter}`;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  tabs: [],
  activeId: null,
  addTab: (t) => set((s) => ({ tabs: [...s.tabs, t], activeId: t.id })),
  updateTab: (id, patch) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTab: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeId = s.activeId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeId;
      return { tabs, activeId };
    }),
  setActive: (activeId) => set({ activeId }),
  clear: () => set({ tabs: [], activeId: null }),
}));
