import { create } from 'zustand';

export interface Workspace {
  id: string; name: string; description: string;
  members: { id: string; name: string; role: string; joinedAt: number }[];
  projects: { id: string; name: string; status: string }[];
  resources: { id: string; name: string; type: string; url?: string }[];
  createdAt: number;
}

export interface WorkspaceActivity {
  id: string; action: string; user: string; details: string; timestamp: number;
}

export interface WorkspaceStats {
  total: number; members: number; projects: number;
}

interface WorkspaceState {
  workspaces: Workspace[]; currentWorkspace: Workspace | null;
  activity: WorkspaceActivity[]; stats: WorkspaceStats | null; loading: boolean;
  loadWorkspaces: () => Promise<void>;
  loadWorkspace: (id: string) => Promise<void>;
  loadStats: () => Promise<void>;
  loadActivity: (workspaceId: string) => Promise<void>;
  createWorkspace: (w: { name: string; description: string }) => Promise<void>;
  deleteWorkspace: (id: string) => Promise<void>;
  addMember: (workspaceId: string, m: { name: string; role: string }) => Promise<void>;
  removeMember: (workspaceId: string, memberId: string) => Promise<void>;
  createProject: (workspaceId: string, p: { name: string }) => Promise<void>;
  addResource: (workspaceId: string, r: { name: string; type: string; url?: string }) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [], currentWorkspace: null, activity: [], stats: null, loading: false,
  loadWorkspaces: async () => { try { set({ workspaces: await window.api.workspaceList() as Workspace[] }); } catch { /* silent */ } },
  loadWorkspace: async (id) => { try { set({ currentWorkspace: await window.api.workspaceGet({ id }) as Workspace }); } catch { /* silent */ } },
  loadStats: async () => { try { set({ stats: await window.api.workspaceStats() as WorkspaceStats }); } catch { /* silent */ } },
  loadActivity: async (workspaceId) => { try { set({ activity: await window.api.workspaceGetActivity({ workspaceId }) as WorkspaceActivity[] }); } catch { /* silent */ } },
  createWorkspace: async (w) => { await window.api.workspaceCreate(w); await get().loadWorkspaces(); await get().loadStats(); },
  deleteWorkspace: async (id) => { await window.api.workspaceDelete({ id }); await get().loadWorkspaces(); await get().loadStats(); },
  addMember: async (workspaceId, m) => { await window.api.workspaceAddMember({ workspaceId, ...m }); await get().loadWorkspace(workspaceId); },
  removeMember: async (workspaceId, memberId) => { await window.api.workspaceRemoveMember({ workspaceId, memberId }); await get().loadWorkspace(workspaceId); },
  createProject: async (workspaceId, p) => { await window.api.workspaceCreateProject({ workspaceId, ...p }); await get().loadWorkspace(workspaceId); },
  addResource: async (workspaceId, r) => { await window.api.workspaceAddResource({ workspaceId, ...r }); await get().loadWorkspace(workspaceId); },
}));

