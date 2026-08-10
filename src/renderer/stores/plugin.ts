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
  createPlugin: (data: { name: string; description: string; category: string; version: string }) => Promise<void>;
  uninstallPlugin: (id: string) => Promise<void>;
  enablePlugin: (id: string) => Promise<void>;
  disablePlugin: (id: string) => Promise<void>;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [], stats: null, loading: false,
  loadPlugins: async () => {
    try {
      const raw = await window.api.pluginList() as Array<{ manifest?: { id: string; name: string; description: string; version: string; category: string }; id?: string; name?: string; description?: string; version?: string; category?: string; installed: boolean; enabled: boolean }>;
      const plugins: Plugin[] = raw.map((p) => ({
        id: p.manifest?.id ?? p.id ?? '',
        name: p.manifest?.name ?? p.name ?? '',
        description: p.manifest?.description ?? p.description ?? '',
        version: p.manifest?.version ?? p.version ?? '',
        category: p.manifest?.category ?? p.category ?? 'other',
        installed: p.installed,
        enabled: p.enabled,
      }));
      set({ plugins });
    } catch { /* silent */ }
  },
  loadStats: async () => {
    try {
      const raw = await window.api.pluginStats() as { totalPlugins?: number; installedPlugins?: number; enabledPlugins?: number; total?: number; installed?: number; enabled?: number };
      set({ stats: {
        total: raw.total ?? raw.totalPlugins ?? 0,
        installed: raw.installed ?? raw.installedPlugins ?? 0,
        enabled: raw.enabled ?? raw.enabledPlugins ?? 0,
      }});
    } catch { /* silent */ }
  },
  installPlugin: async (id) => { await window.api.pluginInstall({ id }); await get().loadPlugins(); await get().loadStats(); },
  createPlugin: async (data) => {
    const id = `custom-${data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
    await window.api.pluginInstall({
      manifest: {
        id, name: data.name, version: data.version, description: data.description,
        author: 'Custom', category: data.category, icon: '🧩', tags: ['custom'],
        dependencies: [], config: {}, permissions: [], minVersion: '0.1.0',
      },
    });
    await get().loadPlugins();
    await get().loadStats();
  },
  uninstallPlugin: async (id) => { await window.api.pluginUninstall({ id }); await get().loadPlugins(); await get().loadStats(); },
  enablePlugin: async (id) => { await window.api.pluginEnable({ id }); await get().loadPlugins(); },
  disablePlugin: async (id) => { await window.api.pluginDisable({ id }); await get().loadPlugins(); },
}));

