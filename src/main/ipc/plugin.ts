// Plugin Store IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { pluginStore } from '../index.js';

export function registerPluginIpc(): void {
  ipcMain.handle(IPC.PLUGIN_INSTALL, async (_e, args) => {
    const { id, manifest } = args as { id?: string; manifest?: unknown };
    // If only ID is provided, look up the built-in manifest
    if (id && !manifest) {
      const existing = pluginStore.getPlugin(id);
      if (existing) {
        // Already exists — just mark as installed
        pluginStore.enablePlugin(id);
        return existing;
      }
      // Create a basic manifest from the ID
      return pluginStore.installPlugin({
        id, name: id, version: '1.0.0', description: `Plugin: ${id}`,
        author: 'Community', category: 'other', icon: '🧩', tags: [],
        dependencies: [], config: {}, permissions: [], minVersion: '0.1.0',
      });
    }
    return pluginStore.installPlugin(manifest as Parameters<typeof pluginStore.installPlugin>[0]);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_e, args) => {
    const { pluginId, id } = args as { pluginId?: string; id?: string };
    return pluginStore.uninstallPlugin(pluginId ?? id ?? '');
  });

  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_e, args) => {
    const { pluginId, id } = args as { pluginId?: string; id?: string };
    return pluginStore.enablePlugin(pluginId ?? id ?? '');
  });

  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_e, args) => {
    const { pluginId, id } = args as { pluginId?: string; id?: string };
    return pluginStore.disablePlugin(pluginId ?? id ?? '');
  });

  ipcMain.handle(IPC.PLUGIN_UPDATE_CONFIG, async (_e, { pluginId, config }) => {
    return pluginStore.updatePluginConfig(pluginId, config);
  });

  ipcMain.handle(IPC.PLUGIN_SEARCH, async (_e, { query }) => {
    return pluginStore.searchPlugins(query);
  });

  ipcMain.handle(IPC.PLUGIN_LIST, async () => {
    return pluginStore.listPlugins();
  });

  ipcMain.handle(IPC.PLUGIN_GET, async (_e, args) => {
    const { pluginId, id } = args as { pluginId?: string; id?: string };
    return pluginStore.getPlugin(pluginId ?? id ?? '');
  });

  ipcMain.handle(IPC.PLUGIN_CATEGORIES, async () => {
    return pluginStore.getCategories();
  });

  ipcMain.handle(IPC.PLUGIN_STATS, async () => {
    return pluginStore.getStats();
  });
}

