import { create } from 'zustand';

export interface AppProject {
  id: string;
  name: string;
  type: 'react' | 'electron' | 'express' | 'fullstack';
  status: 'created' | 'building' | 'built' | 'error';
  files: { name: string; path: string; content?: string }[];
  createdAt: number;
  outputPath?: string;
  lastBuildLog?: string;
}

export interface AppTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  language?: string;
}

export interface AppStats {
  totalProjects: number;
  byType: Record<string, number>;
  buildable?: number;
}

interface AppProjectPayload {
  id: string;
  name: string;
  framework: AppProject['type'];
  status: 'scaffolded' | 'in_progress' | 'buildable' | 'deployed';
  files: { path: string; content?: string }[];
  createdAt: number;
  outputPath?: string;
  lastBuildLog?: string;
}

const normalizeProject = (project: AppProjectPayload): AppProject => ({
  id: project.id,
  name: project.name,
  type: project.framework,
  status: project.status === 'buildable' || project.status === 'deployed'
    ? 'built'
    : project.status === 'in_progress'
      ? 'building'
      : 'created',
  files: project.files.map((file) => ({ name: file.path.split(/[\\/]/).pop() || file.path, ...file })),
  createdAt: project.createdAt,
  outputPath: project.outputPath,
  lastBuildLog: project.lastBuildLog,
});

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
  renameProject: (id: string, name: string) => Promise<void>;
  moveProject: (id: string, destination: string) => Promise<void>;
  runProject: (id: string) => Promise<void>;
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
      const projects = await window.api.appListProjects() as AppProjectPayload[];
      set({ projects: projects.map(normalizeProject), loading: false });
    } catch { set({ loading: false }); }
  },

  loadTemplates: async () => {
    try {
      const templates = await window.api.appTemplates() as Array<AppTemplate & { framework?: string }>;
      set({ templates: templates.map((template) => ({ ...template, type: template.framework || template.type })) });
    } catch { /* silent */ }
  },

  loadStats: async () => {
    try {
      const stats = await window.api.appStats() as AppStats & { byFramework?: Record<string, number> };
      set({ stats: { ...stats, byType: stats.byFramework || stats.byType || {} } });
    } catch { /* silent */ }
  },

  createProject: async (args) => {
    const templateByType: Record<string, string> = {
      react: 'react_app',
      electron: 'electron_app',
      express: 'express_api',
      fullstack: 'react_app',
    };
    await window.api.appCreateProject({
      name: args.name,
      description: '',
      framework: args.type === 'fullstack' ? 'react' : args.type,
      language: 'typescript',
      templateId: args.framework || templateByType[args.type],
    });
    await get().loadProjects();
    await get().loadStats();
  },

  deleteProject: async (id) => {
    const deleted = await window.api.appDelete({ projectId: id });
    if (!deleted) throw new Error('Project could not be deleted.');
    await get().loadProjects();
    await get().loadStats();
  },

  buildProject: async (id) => {
    const result = await window.api.appBuild({ projectId: id }) as { success?: boolean; error?: string };
    if (!result?.success) throw new Error(result?.error || 'Project build failed.');
    await get().loadProjects();
    await get().loadStats();
  },

  renameProject: async (id, name) => {
    const result = await window.api.appRename({ projectId: id, name });
    if (!result) throw new Error('Project could not be renamed.');
    await get().loadProjects();
  },

  moveProject: async (id, destination) => {
    const result = await window.api.appMove({ projectId: id, destination }) as { success?: boolean; error?: string };
    if (!result.success) throw new Error(result.error || 'Project could not be moved.');
    await get().loadProjects();
  },

  runProject: async (id) => {
    const result = await window.api.appRun({ projectId: id }) as { success?: boolean; error?: string };
    if (!result.success) throw new Error(result.error || 'Project could not be started.');
  },

  generateComponent: async (args) => {
    await window.api.appGenerateComponent({ projectId: args.projectId, name: args.name, props: [] });
    await get().loadProjects();
  },

  generatePage: async (args) => {
    await window.api.appGeneratePage({ projectId: args.projectId, name: args.name, route: `/${args.name.toLowerCase()}` });
    await get().loadProjects();
  },

  generateApi: async (args) => {
    await window.api.appGenerateApi({ projectId: args.projectId, endpoint: `/${args.name.toLowerCase()}`, method: 'GET' });
    await get().loadProjects();
  },
}));

