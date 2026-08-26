import { create } from 'zustand';

export interface AutomationWorkflow {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: { type: string; config: unknown };
  actions: { id?: string; type: string; config: unknown }[];
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
  tags?: string[];
}

export interface AutomationStats {
  totalWorkflows: number;
  enabledWorkflows: number;
  totalRuns: number;
}

export interface AutomationRunResult {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  actionResults: Array<{ actionId: string; status: string; result: string }>;
}

export interface AutomationRunEvent {
  type: 'run_started' | 'action_started' | 'action_progress' | 'action_completed' | 'action_failed' | 'run_completed';
  runId: string;
  workflowId: string;
  workflowName: string;
  actionId?: string;
  actionType?: string;
  actionIndex?: number;
  totalActions: number;
  message: string;
  result?: string;
  status?: AutomationRunResult['status'];
  timestamp: number;
}

export interface ActiveAutomationRun {
  runId?: string;
  workflowId: string;
  workflowName: string;
  status: 'starting' | AutomationRunResult['status'];
  startedAt: number;
  completedAt?: number;
  currentAction?: string;
  currentActionIndex: number;
  totalActions: number;
  completedActions: number;
  logs: AutomationRunEvent[];
  result?: string;
  error?: string;
}

export interface SchedulerStatus {
  running: boolean;
  tickMs: number;
  scheduledWorkflows: number;
  idleWorkflows: number;
  keepAwake: boolean;
}

interface AutomationWorkflowPayload extends Omit<AutomationWorkflow, 'runs'> {
  runCount?: number;
  runs?: number;
}

interface AutomationState {
  workflows: AutomationWorkflow[];
  templates: AutomationTemplate[];
  stats: AutomationStats | null;
  activeRun: ActiveAutomationRun | null;
  lastRun: ActiveAutomationRun | null;
  loading: boolean;
  schedulerStatus: SchedulerStatus | null;
  nextRuns: Record<string, string>;
  initRunListener: () => void;
  loadWorkflows: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadScheduler: () => Promise<void>;
  setKeepAwake: (enabled: boolean) => Promise<void>;
  createWorkflow: (workflow: { name: string; description: string; trigger: unknown; actions: unknown[] }) => Promise<void>;
  runWorkflow: (id: string) => Promise<AutomationRunResult>;
  clearRunResult: () => void;
  enableWorkflow: (id: string) => Promise<void>;
  disableWorkflow: (id: string) => Promise<void>;
  deleteWorkflow: (id: string) => Promise<void>;
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  workflows: [],
  templates: [],
  stats: null,
  activeRun: null,
  lastRun: null,
  loading: false,
  schedulerStatus: null,
  nextRuns: {},

  initRunListener: () => {
    const marker = window as Window & { __automationRunListenerAttached?: boolean };
    if (marker.__automationRunListenerAttached) return;
    marker.__automationRunListenerAttached = true;
    window.api.onAutomationRunEvent((payload: unknown) => {
      const event = payload as AutomationRunEvent;
      set((state) => {
        const existing = state.activeRun?.workflowId === event.workflowId ? state.activeRun : null;
        const run: ActiveAutomationRun = existing ?? {
          runId: event.runId,
          workflowId: event.workflowId,
          workflowName: event.workflowName,
          status: 'running',
          startedAt: event.timestamp,
          currentActionIndex: 0,
          totalActions: event.totalActions,
          completedActions: 0,
          logs: [],
        };
        const completedActions = event.type === 'action_completed' || event.type === 'action_failed'
          ? Math.max(run.completedActions, (event.actionIndex ?? run.completedActions) + 1)
          : run.completedActions;
        const next: ActiveAutomationRun = {
          ...run,
          runId: event.runId,
          status: event.type === 'run_completed' ? (event.status ?? 'completed') : 'running',
          completedAt: event.type === 'run_completed' ? event.timestamp : undefined,
          currentAction: event.actionType?.replace(/_/g, ' ') ?? run.currentAction,
          currentActionIndex: event.actionIndex ?? run.currentActionIndex,
          totalActions: event.totalActions,
          completedActions,
          logs: [...run.logs, event],
          result: event.type === 'run_completed' && event.status === 'completed' ? event.message : run.result,
          error: event.type === 'run_completed' && event.status === 'failed' ? event.result : run.error,
        };
        return event.type === 'run_completed' ? { activeRun: null, lastRun: next } : { activeRun: next };
      });
    });
  },

  loadWorkflows: async () => {
    set({ loading: true });
    try {
      const workflows = await window.api.automationListWorkflows() as AutomationWorkflowPayload[];
      set({ workflows: workflows.map((workflow) => ({ ...workflow, runs: workflow.runCount ?? workflow.runs ?? 0 })), loading: false });
    } catch { set({ loading: false }); }
  },

  loadTemplates: async () => {
    try {
      const templates = await window.api.automationGetTemplates() as AutomationTemplate[];
      set({ templates });
    } catch { /* silent */ }
  },

  loadStats: async () => {
    try {
      const stats = await window.api.automationStats() as AutomationStats;
      set({ stats });
    } catch { /* silent */ }
  },

  loadScheduler: async () => {
    try {
      const [schedulerStatus, nextRuns] = await Promise.all([
        window.api.automationSchedulerStatus() as SchedulerStatus,
        window.api.automationNextRuns() as Record<string, string>,
      ]);
      set({ schedulerStatus, nextRuns });
    } catch { /* silent */ }
  },

  setKeepAwake: async (enabled) => {
    const schedulerStatus = await window.api.automationSetKeepAwake(enabled) as SchedulerStatus;
    set({ schedulerStatus });
  },

  createWorkflow: async (workflow) => {
    await window.api.automationCreateWorkflow(workflow);
    await get().loadWorkflows();
    await get().loadStats();
    await get().loadScheduler();
  },

  runWorkflow: async (id) => {
    const workflow = get().workflows.find((item) => item.id === id);
    set({
      activeRun: {
        workflowId: id,
        workflowName: workflow?.name ?? 'Automation',
        status: 'starting',
        startedAt: Date.now(),
        currentActionIndex: 0,
        totalActions: workflow?.actions.length ?? 0,
        completedActions: 0,
        logs: [],
      },
      lastRun: null,
    });
    try {
      const result = await window.api.automationRunWorkflow({ workflowId: id }) as AutomationRunResult;
      await get().loadWorkflows();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({
        activeRun: null,
        lastRun: state.activeRun ? { ...state.activeRun, status: 'failed', completedAt: Date.now(), error: message } : null,
      }));
      throw error;
    }
  },

  clearRunResult: () => set({ lastRun: null }),

  enableWorkflow: async (id) => {
    const enabled = await window.api.automationEnableWorkflow({ workflowId: id });
    if (!enabled) throw new Error('Workflow could not be enabled.');
    await get().loadWorkflows();
    await get().loadScheduler();
  },

  disableWorkflow: async (id) => {
    const disabled = await window.api.automationDisableWorkflow({ workflowId: id });
    if (!disabled) throw new Error('Workflow could not be disabled.');
    await get().loadWorkflows();
    await get().loadScheduler();
  },

  deleteWorkflow: async (id) => {
    const deleted = await window.api.automationDeleteWorkflow({ workflowId: id });
    if (!deleted) throw new Error('Workflow could not be deleted.');
    await get().loadWorkflows();
    await get().loadStats();
    await get().loadScheduler();
  },
}));

