import { create } from 'zustand';

export interface Metrics {
  cpu: number;
  cpuCores: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
  load1: string;
  load5: string;
  load15: string;
  platform: string;
  hostname: string;
}

interface MetricsState {
  metrics: Metrics | null;
  history: { cpu: number[]; ram: number[] };
  fetchMetrics: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

let interval: ReturnType<typeof setInterval> | null = null;

export const useMetricsStore = create<MetricsState>((set, get) => ({
  metrics: null,
  history: {
    cpu: Array(12).fill(0),
    ram: Array(12).fill(0),
  },

  fetchMetrics: async () => {
    try {
      const m = (await window.api.getMetrics()) as Metrics;
      set((s) => ({
        metrics: m,
        history: {
          cpu: [...s.history.cpu.slice(1), m.cpu],
          ram: [...s.history.ram.slice(1), m.ram],
        },
      }));
    } catch {
      // silently fail if main process not ready
    }
  },

  startPolling: () => {
    if (interval) return;
    void get().fetchMetrics();
    interval = setInterval(() => { void get().fetchMetrics(); }, 2000);
  },

  stopPolling: () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  },
}));

