import { create } from 'zustand';

// --- Types (mirror src/main/workers + src/main/teaching) ---------------------

export interface WorkerStep {
  id: string;
  title: string;
  instruction: string;
  referenceFrame?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
}

export interface WorkerView {
  id: string;
  name: string;
  description: string;
  task: string;
  steps: WorkerStep[];
  trigger: { type: string; config: Record<string, unknown> };
  workflowId: string;
  workspace: string;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'needs_input';
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastResult?: string;
  lastError?: string;
  activeRunId?: string;
  progress: number;
  currentStepIndex: number;
  successfulRuns: number;
  failedRuns: number;
  consecutiveSuccesses: number;
  notifyOnFinish: boolean;
  notes: string[];
  confidence: number;
  nextRunAt?: string;
  totalRuns: number;
  lastRunStatus?: 'running' | 'completed' | 'failed' | 'cancelled';
  scheduleLabel: string;
}

export interface WorkerStats {
  total: number;
  scheduled: number;
  running: number;
  needsInput: number;
  paused: number;
  successfulRuns: number;
}

export interface WorkerRun {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  actionResults: Array<{ actionId: string; status: string; result: string }>;
}

export interface BackgroundStatus {
  enabled: boolean;
  windowVisible: boolean;
  tray: boolean;
  schedulerRunning: boolean;
}

export interface TeachingStep {
  id: string;
  title: string;
  instruction: string;
  referenceFrame?: string;
}

export interface TeachingView {
  id: string;
  name: string;
  status: 'recording' | 'stopped';
  startedAt: number;
  stoppedAt?: number;
  durationMs: number;
  narration: string;
  eventCount: number;
  frameCount: number;
  stepCount: number;
  compiledSteps: TeachingStep[];
  captureWarning?: string;
}

export interface CatalogApp {
  id: string;
  name: string;
  publisher: string;
  description: string;
  category: string;
  wingetId: string;
  installed: boolean;
}

export interface InstalledApp {
  name: string;
  id: string;
}

export interface VaultEntry {
  id: string;
  label: string;
  username: string;
  workerIds: string[];
  createdAt: number;
  updatedAt: number;
  cipher: string;
}

interface WorkerEvent {
  type: 'worker_updated' | 'worker_deleted' | 'worker_progress';
  workerId: string;
  worker?: WorkerView;
  progress?: { type: string; runId: string };
}

interface TeachEvent {
  type: 'teaching_updated' | 'teaching_event' | 'teaching_frame';
  recordingId: string;
  event?: unknown;
  frameCount?: number;
}

interface WorkersState {
  workers: WorkerView[];
  stats: WorkerStats | null;
  background: BackgroundStatus | null;
  history: WorkerRun[];
  historyFor: string | null;
  selectedId: string | null;
  loading: boolean;

  recordings: TeachingView[];
  activeRecording: TeachingView | null;

  catalog: CatalogApp[];
  installed: InstalledApp[];
  appsQuery: string;

  vaultAvailable: boolean;
  vaultCipher: string;
  vaultEntries: VaultEntry[];

  init: () => void;
  refresh: () => Promise<void>;
  refreshTeach: () => Promise<void>;
  refreshApps: (query?: string) => Promise<void>;
  refreshVault: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  loadHistory: (id: string) => Promise<void>;
  run: (id: string) => Promise<void>;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  interject: (id: string, message: string) => Promise<void>;
  setBackground: (enabled: boolean) => Promise<void>;
}

let initialized = false;

const emptyStats: WorkerStats = { total: 0, scheduled: 0, running: 0, needsInput: 0, paused: 0, successfulRuns: 0 };

export const useWorkersStore = create<WorkersState>((set, get) => ({
  workers: [],
  stats: null,
  background: null,
  history: [],
  historyFor: null,
  selectedId: null,
  loading: false,

  recordings: [],
  activeRecording: null,

  catalog: [],
  installed: [],
  appsQuery: '',

  vaultAvailable: false,
  vaultCipher: 'Unavailable',
  vaultEntries: [],

  init: () => {
    if (initialized) return;
    initialized = true;

    window.api.onWorkerEvent((payload: unknown) => {
      const event = payload as WorkerEvent;
      if (event.type === 'worker_deleted') {
        set((s) => ({
          workers: s.workers.filter((worker) => worker.id !== event.workerId),
          selectedId: s.selectedId === event.workerId ? null : s.selectedId,
          stats: recompute(s.workers.filter((worker) => worker.id !== event.workerId)),
        }));
        return;
      }
      if (!event.worker) return;
      set((s) => {
        const exists = s.workers.some((worker) => worker.id === event.worker!.id);
        const workers = exists
          ? s.workers.map((worker) => (worker.id === event.worker!.id ? event.worker! : worker))
          : [event.worker!, ...s.workers];
        return { workers, stats: recompute(workers) };
      });
      if (event.progress?.type === 'run_completed') void get().loadHistory(event.workerId);
    });

    window.api.onTeachEvent((payload: unknown) => {
      const event = payload as TeachEvent;
      if (event.type === 'teaching_updated') {
        void get().refreshTeach();
        return;
      }
      set((s) => {
        const active = s.activeRecording;
        if (!active || active.id !== event.recordingId) return s;
        if (event.type === 'teaching_frame') {
          return { activeRecording: { ...active, frameCount: event.frameCount ?? active.frameCount + 1 } };
        }
        return { activeRecording: { ...active, eventCount: active.eventCount + 1 } };
      });
    });

    void get().refresh();
    void get().refreshTeach();
    void get().refreshApps();
    void get().refreshVault();
  },

  refresh: async () => {
    set({ loading: true });
    try {
      const result = await window.api.workerList() as {
        workers: WorkerView[];
        stats: WorkerStats;
        background: BackgroundStatus;
      };
      set({ workers: result.workers, stats: result.stats, background: result.background, loading: false });
    } catch {
      set({ loading: false, stats: emptyStats });
    }
  },

  refreshTeach: async () => {
    try {
      const result = await window.api.teachList() as { recordings: TeachingView[]; activeId: string | null };
      const activeRecording = result.recordings.find((recording) => recording.id === result.activeId) ?? null;
      set((s) => ({
        recordings: result.recordings,
        // Keep live counters from the event stream while recording.
        activeRecording: activeRecording && s.activeRecording?.id === activeRecording.id && activeRecording.status === 'recording'
          ? { ...activeRecording, eventCount: Math.max(activeRecording.eventCount, s.activeRecording.eventCount), frameCount: Math.max(activeRecording.frameCount, s.activeRecording.frameCount) }
          : activeRecording,
      }));
    } catch {
      /* leave existing recordings visible */
    }
  },

  refreshApps: async (query?: string) => {
    const appsQuery = query ?? get().appsQuery;
    set({ appsQuery });
    try {
      const result = await window.api.appsList({ query: appsQuery }) as {
        catalog: CatalogApp[];
        installed: InstalledApp[];
      };
      set({ catalog: result.catalog, installed: result.installed });
    } catch {
      /* catalog stays empty; UI shows a retry */
    }
  },

  refreshVault: async () => {
    try {
      const result = await window.api.vaultList({}) as {
        available: boolean;
        cipher: string;
        entries: VaultEntry[];
      };
      set({ vaultAvailable: result.available, vaultCipher: result.cipher, vaultEntries: result.entries });
    } catch {
      /* vault stays closed */
    }
  },

  select: async (id) => {
    set({ selectedId: id, history: [], historyFor: id });
    if (!id) return;
    // The list may not have arrived yet (fresh launch, or a deep link) — pull
    // the one worker we need instead of showing an empty detail pane.
    if (!get().workers.some((worker) => worker.id === id)) {
      try {
        const detail = await window.api.workerGet({ workerId: id }) as WorkerView | null;
        if (detail && get().selectedId === id) {
          set((s) => ({
            workers: s.workers.some((worker) => worker.id === detail.id)
              ? s.workers.map((worker) => (worker.id === detail.id ? detail : worker))
              : [detail, ...s.workers],
          }));
        }
      } catch { /* the list refresh will fill it in */ }
    }
    await get().loadHistory(id);
  },

  loadHistory: async (id) => {
    try {
      const history = await window.api.workerHistory({ workerId: id }) as WorkerRun[];
      set({ history, historyFor: id });
    } catch {
      set({ history: [], historyFor: id });
    }
  },

  run: async (id) => {
    await window.api.workerRun({ workerId: id });
    await get().refresh();
  },

  pause: async (id) => {
    await window.api.workerPause({ workerId: id });
    await get().refresh();
  },

  resume: async (id) => {
    await window.api.workerResume({ workerId: id });
    await get().refresh();
  },

  stop: async (id) => {
    await window.api.workerCancel({ workerId: id });
    await get().refresh();
  },

  remove: async (id) => {
    await window.api.workerDelete({ workerId: id });
    set((s) => ({ selectedId: s.selectedId === id ? null : s.selectedId }));
    await get().refresh();
  },

  interject: async (id, message) => {
    await window.api.workerInterject({ workerId: id, message });
    await get().refresh();
  },

  setBackground: async (enabled) => {
    const status = await window.api.workerBackgroundSet({ enabled }) as BackgroundStatus;
    set({ background: status });
  },
}));

function recompute(workers: WorkerView[]): WorkerStats {
  return {
    total: workers.length,
    scheduled: workers.filter((worker) => worker.enabled && worker.status !== 'paused' && worker.trigger.type !== 'manual').length,
    running: workers.filter((worker) => worker.status === 'running').length,
    needsInput: workers.filter((worker) => worker.status === 'needs_input').length,
    paused: workers.filter((worker) => worker.status === 'paused').length,
    successfulRuns: workers.reduce((sum, worker) => sum + worker.successfulRuns, 0),
  };
}
