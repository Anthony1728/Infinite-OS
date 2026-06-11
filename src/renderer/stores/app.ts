import { create } from 'zustand';

export interface AppProject {
  id: string;
  name: string;
  type: 'react' | 'electron' | 'express' | 'fullstack';
  status: 'created' | 'building' | 'built' | 'error';
  files: { name: string; path: string; content?: string }[];
  createdAt: number;
}

export interface AppTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
}

export interface AppStats {
  totalProjects: number;
  byType: Record<string, number>;
}

interface AppState {
  projects: AppProject[];
  templates: AppTemplate[];
  stats: AppStats | null;
  loading: boolean;
  loadProjects: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadStats: () => Promise<void>;
  createProject: (args: { name: string; type: string; framework?: string }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  buildProject: (id: string) => Promise<void>;
  generateComponent: (args: { projectId: string; name: string; description: string }) => Promise<void>;
  generatePage: (args: { projectId: string; name: string; description: string }) => Promise<void>;
  generateApi: (args: { projectId: string; name: string; description: string }) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  projects: [],
  templates: [],
  stats: null,
  loading: false,

  loadProjects: async () => {
    set({ loading: true });
    try {
      const projects = await window.api.appListProjects() as AppProject[];
      set({ projects, loading: false });
    } catch { set({ loading: false }); }
  },

  loadTemplates: async () => {
    try {
      const templates = await window.api.appTemplates() as AppTemplate[];
      set({ templates });
    } catch {}
  },

  loadStats: async () => {
    try {
      const stats = await window.api.appStats() as AppStats;
      set({ stats });
    } catch {}
  },

  createProject: async (args) => {
    await window.api.appCreateProject(args);
    await get().loadProjects();
    await get().loadStats();
  },

  deleteProject: async (id) => {
    await window.api.appDelete({ id });
    await get().loadProjects();
    await get().loadStats();
  },

  buildProject: async (id) => {
    await window.api.appBuild({ id });
    await get().loadProjects();
  },

  generateComponent: async (args) => {
    await window.api.appGenerateComponent(args);
    await get().loadProjects();
  },

  generatePage: async (args) => {
    await window.api.appGeneratePage(args);
    await get().loadProjects();
  },

  generateApi: async (args) => {
    await window.api.appGenerateApi(args);
    await get().loadProjects();
  },
}));
