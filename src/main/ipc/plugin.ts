// Plugin Store IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { pluginStore } from '../index.js';

export function registerPluginIpc(): void {
  ipcMain.handle(IPC.PLUGIN_INSTALL, async (_e, { manifest }) => {
    return pluginStore.installPlugin(manifest);
  });

  ipcMain.handle(IPC.PLUGIN_UNINSTALL, async (_e, { pluginId }) => {
    return pluginStore.uninstallPlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_ENABLE, async (_e, { pluginId }) => {
    return pluginStore.enablePlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_DISABLE, async (_e, { pluginId }) => {
    return pluginStore.disablePlugin(pluginId);
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

  ipcMain.handle(IPC.PLUGIN_GET, async (_e, { pluginId }) => {
    return pluginStore.getPlugin(pluginId);
  });

  ipcMain.handle(IPC.PLUGIN_CATEGORIES, async () => {
    return pluginStore.getCategories();
  });

  ipcMain.handle(IPC.PLUGIN_STATS, async () => {
    return pluginStore.getStats();
  });
}

