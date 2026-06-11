// App Builder IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { appBuilder } from '../index.js';

export function registerAppIpc(): void {
  ipcMain.handle(IPC.APP_CREATE_PROJECT, async (_e, { name, description, framework, language, templateId }) => {
    return appBuilder.createProject({ name, description, framework, language, templateId });
  });

  ipcMain.handle(IPC.APP_LIST_PROJECTS, async () => {
    return appBuilder.listProjects();
  });

  ipcMain.handle(IPC.APP_GET_PROJECT, async (_e, { projectId }) => {
    return appBuilder.getProject(projectId);
  });

  ipcMain.handle(IPC.APP_ADD_FILE, async (_e, { projectId, file }) => {
    return appBuilder.addFile(projectId, file);
  });

  ipcMain.handle(IPC.APP_GENERATE_COMPONENT, async (_e, { projectId, name, props }) => {
    return appBuilder.generateComponent(projectId, name, props);
  });

  ipcMain.handle(IPC.APP_GENERATE_PAGE, async (_e, { projectId, name, route }) => {
    return appBuilder.generatePage(projectId, name, route);
  });

  ipcMain.handle(IPC.APP_GENERATE_API, async (_e, { projectId, endpoint, method }) => {
    return appBuilder.generateAPI(projectId, endpoint, method);
  });

  ipcMain.handle(IPC.APP_BUILD, async (_e, { projectId }) => {
    return appBuilder.buildProject(projectId);
  });

  ipcMain.handle(IPC.APP_DELETE, async (_e, { projectId }) => {
    return appBuilder.deleteProject(projectId);
  });

  ipcMain.handle(IPC.APP_TEMPLATES, async () => {
    return appBuilder.getTemplates();
  });

  ipcMain.handle(IPC.APP_STATS, async () => {
    return appBuilder.getStats();
  });
}
