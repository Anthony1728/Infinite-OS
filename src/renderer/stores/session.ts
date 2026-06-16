import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './auth';

interface WorkspaceState {
  currentView: string;
  lastProject: string | null;
  openTabs: string[];
  activeTab: string | null;
  fileExplorerPath: string;
  terminalOpen: boolean;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: 'agents' | 'code';
  recentActivity: Array<{
    type: 'chat' | 'project' | 'file' | 'deploy';
    title: string;
    timestamp: number;
    id?: string;
  }>;
}

interface SessionStore {
  workspace: WorkspaceState;
  isRestoring: boolean;

  setCurrentView: (view: string) => void;
  setLastProject: (project: string | null) => void;
  setOpenTabs: (tabs: string[]) => void;
  setActiveTab: (tab: string | null) => void;
  setFileExplorerPath: (path: string) => void;
  setTerminalOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: 'agents' | 'code') => void;
  addRecentActivity: (activity: WorkspaceState['recentActivity'][0]) => void;
  restoreSession: () => void;
  saveSession: () => void;
}

const defaultWorkspace: WorkspaceState = {
  currentView: 'chats',
  lastProject: null,
  openTabs: [],
  activeTab: null,
  fileExplorerPath: '.',
  terminalOpen: false,
  sidebarCollapsed: false,
  rightPanelOpen: true,
  rightPanelTab: 'code',
  recentActivity: [],
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      workspace: defaultWorkspace,
      isRestoring: false,

      setCurrentView: (view) => {
        set((s) => ({ workspace: { ...s.workspace, currentView: view } }));
        get().saveSession();
      },

      setLastProject: (project) => {
        set((s) => ({ workspace: { ...s.workspace, lastProject: project } }));
        get().saveSession();
      },

      setOpenTabs: (tabs) => {
        set((s) => ({ workspace: { ...s.workspace, openTabs: tabs } }));
        get().saveSession();
      },

      setActiveTab: (tab) => {
        set((s) => ({ workspace: { ...s.workspace, activeTab: tab } }));
        get().saveSession();
      },

      setFileExplorerPath: (path) => {
        set((s) => ({ workspace: { ...s.workspace, fileExplorerPath: path } }));
        get().saveSession();
      },

      setTerminalOpen: (open) => {
        set((s) => ({ workspace: { ...s.workspace, terminalOpen: open } }));
        get().saveSession();
      },

      setSidebarCollapsed: (collapsed) => {
        set((s) => ({ workspace: { ...s.workspace, sidebarCollapsed: collapsed } }));
      },

      setRightPanelOpen: (open) => {
        set((s) => ({ workspace: { ...s.workspace, rightPanelOpen: open } }));
      },

      setRightPanelTab: (tab) => {
        set((s) => ({ workspace: { ...s.workspace, rightPanelTab: tab } }));
      },

      addRecentActivity: (activity) => {
        set((s) => ({
          workspace: {
            ...s.workspace,
            recentActivity: [activity, ...s.workspace.recentActivity].slice(0, 20),
          },
        }));
        get().saveSession();
      },

      restoreSession: () => {
        const user = useAuthStore.getState().user;
        if (user?.lastSession) {
          set({
            isRestoring: true,
            workspace: {
              ...defaultWorkspace,
              currentView: user.lastSession.lastActiveView ?? 'chats',
              lastProject: user.lastSession.lastProject ?? null,
              openTabs: user.lastSession.openChats ?? [],
              fileExplorerPath: user.lastSession.fileExplorerPath ?? '.',
              terminalOpen: user.lastSession.terminalState === 'open',
              recentActivity: user.lastSession.recentActivity ?? [],
            },
          });
          setTimeout(() => set({ isRestoring: false }), 500);
        }
      },

      saveSession: () => {
        const { workspace } = get();
        const user = useAuthStore.getState().user;
        if (user) {
          useAuthStore.getState().updateSessionState({
            lastActiveView: workspace.currentView,
            lastProject: workspace.lastProject,
            openChats: workspace.openTabs,
            fileExplorerPath: workspace.fileExplorerPath,
            terminalState: workspace.terminalOpen ? 'open' : 'closed',
            recentActivity: workspace.recentActivity,
          });
        }
      },
    }),
    {
      name: 'infinite:session',
      partialize: (state) => ({ workspace: state.workspace }),
    }
  )
);
