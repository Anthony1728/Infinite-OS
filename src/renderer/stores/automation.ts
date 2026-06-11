import { create } from 'zustand';

export interface AutomationWorkflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: { type: string; config: unknown };
  actions: { type: string; config: unknown }[];
  runs: number;
  lastRun?: number;
  createdAt: number;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  trigger: { type: string; config: unknown };
  actions: { type: string; config: unknown }[];
}

export interface AutomationStats {
  totalWorkflows: number;
  enabledWorkflows: number;
  totalRuns: number;
}

interface AutomationState {
  workflows: AutomationWorkflow[];
  templates: AutomationTemplate[];
  stats: AutomationStats | null;
  loading: boolean;
  loadWorkflows: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadStats: () => Promise<void>;
  createWorkflow: (workflow: { name: string; description: string; trigger: unknown; actions: unknown[] }) => Promise<void>;
  runWorkflow: (id: string) => Promise<void>;
  enableWorkflow: (id: string) => Promise<void>;
  disableWorkflow: (id: string) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  workflows: [],
  templates: [],
  stats: null,
  loading: false,

  loadWorkflows: async () => {
    set({ loading: true });
    try {
      const workflows = await window.api.automationListWorkflows() as AutomationWorkflow[];
      set({ workflows, loading: false });
    } catch { set({ loading: false }); }
  },

  loadTemplates: async () => {
    try {
      const templates = await window.api.automationGetTemplates() as AutomationTemplate[];
      set({ templates });
    } catch {}
  },

  loadStats: async () => {
    try {
      const stats = await window.api.automationStats() as AutomationStats;
      set({ stats });
    } catch {}
  },

  createWorkflow: async (workflow) => {
    await window.api.automationCreateWorkflow(workflow);
    await get().loadWorkflows();
    await get().loadStats();
  },

  runWorkflow: async (id) => {
    await window.api.automationRunWorkflow({ id });
    await get().loadWorkflows();
  },

  enableWorkflow: async (id) => {
    await window.api.automationEnableWorkflow({ id });
    await get().loadWorkflows();
  },

  disableWorkflow: async (id) => {
    await window.api.automationDisableWorkflow({ id });
    await get().loadWorkflows();
  },

  deleteWorkflow: async (id) => {
    await window.api.automationListWorkflows();
    await get().loadStats();
  },
}));
