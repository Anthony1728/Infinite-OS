// Website Builder IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { websiteBuilder } from '../index.js';

export function registerWebsiteIpc(): void {
  ipcMain.handle(IPC.WEBSITE_CREATE, async (_e, { name, description, framework, templateId }) => {
    return websiteBuilder.createWebsite({ name, description, framework, templateId });
  });

  ipcMain.handle(IPC.WEBSITE_LIST, async () => {
    return websiteBuilder.listWebsites();
  });

  ipcMain.handle(IPC.WEBSITE_GET, async (_e, { websiteId }) => {
    return websiteBuilder.getWebsite(websiteId);
  });

  ipcMain.handle(IPC.WEBSITE_ADD_PAGE, async (_e, { websiteId, slug, title }) => {
    return websiteBuilder.addPage(websiteId, slug, title);
  });

  ipcMain.handle(IPC.WEBSITE_ADD_COMPONENT, async (_e, { websiteId, pageId, component }) => {
    return websiteBuilder.addComponent(websiteId, pageId, component);
  });

  ipcMain.handle(IPC.WEBSITE_GENERATE_CODE, async (_e, { websiteId }) => {
    return websiteBuilder.generateCode(websiteId);
  });

  ipcMain.handle(IPC.WEBSITE_PUBLISH, async (_e, { websiteId }) => {
    return websiteBuilder.publish(websiteId);
  });

  ipcMain.handle(IPC.WEBSITE_DEPLOY, async (_e, { websiteId }) => {
    return websiteBuilder.deploy(websiteId);
  });

  ipcMain.handle(IPC.WEBSITE_DELETE, async (_e, { websiteId }) => {
    return websiteBuilder.deleteWebsite(websiteId);
  });

  ipcMain.handle(IPC.WEBSITE_TEMPLATES, async () => {
    return websiteBuilder.getTemplates();
  });

  ipcMain.handle(IPC.WEBSITE_STATS, async () => {
    return websiteBuilder.getStats();
  });
}

