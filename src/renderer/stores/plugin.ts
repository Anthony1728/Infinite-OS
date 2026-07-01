import { create } from 'zustand';

export interface Plugin {
  id: string; name: string; description: string; version: string;
  installed: boolean; enabled: boolean; category: string;
  config?: Record<string, unknown>;
}

export interface PluginStats {
  total: number; installed: number; enabled: number;
}

interface PluginState {
  plugins: Plugin[]; stats: PluginStats | null; loading: boolean;
  loadPlugins: () => Promise<void>;
  loadStats: () => Promise<void>;
  installPlugin: (id: string) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;
  enablePlugin: (id: string) => Promise<void>;
  disablePlugin: (id: string) => Promise<void>;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [], stats: null, loading: false,
  loadPlugins: async () => { try { set({ plugins: await window.api.pluginList() as Plugin[] }); } catch { /* silent */ } },
  loadStats: async () => { try { set({ stats: await window.api.pluginStats() as PluginStats }); } catch { /* silent */ } },
  installPlugin: async (id) => { await window.api.pluginInstall({ id }); await get().loadPlugins(); await get().loadStats(); },
  uninstallPlugin: async (id) => { await window.api.pluginUninstall({ id }); await get().loadPlugins(); await get().loadStats(); },
  enablePlugin: async (id) => { await window.api.pluginEnable({ id }); await get().loadPlugins(); },
  disablePlugin: async (id) => { await window.api.pluginDisable({ id }); await get().loadPlugins(); },
}));

