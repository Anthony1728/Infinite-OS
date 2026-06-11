// Automation Builder IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { automationBuilder } from '../index.js';

export function registerAutomationIpc(): void {
  ipcMain.handle(IPC.AUTOMATION_CREATE_WORKFLOW, async (_e, { name, description, trigger, actions }) => {
    return automationBuilder.createWorkflow({ name, description, trigger, actions });
  });

  ipcMain.handle(IPC.AUTOMATION_RUN_WORKFLOW, async (_e, { workflowId }) => {
    return automationBuilder.runWorkflow(workflowId);
  });

  ipcMain.handle(IPC.AUTOMATION_LIST_WORKFLOWS, async () => {
    return automationBuilder.listWorkflows();
  });

  ipcMain.handle(IPC.AUTOMATION_GET_WORKFLOW, async (_e, { workflowId }) => {
    return automationBuilder.getWorkflow(workflowId);
  });

  ipcMain.handle(IPC.AUTOMATION_ENABLE_WORKFLOW, async (_e, { workflowId }) => {
    return automationBuilder.enableWorkflow(workflowId);
  });

  ipcMain.handle(IPC.AUTOMATION_DISABLE_WORKFLOW, async (_e, { workflowId }) => {
    return automationBuilder.disableWorkflow(workflowId);
  });

  ipcMain.handle(IPC.AUTOMATION_ADD_ACTION, async (_e, { workflowId, action }) => {
    return automationBuilder.addAction(workflowId, action);
  });

  ipcMain.handle(IPC.AUTOMATION_GET_TEMPLATES, async () => {
    return automationBuilder.getTemplates();
  });

  ipcMain.handle(IPC.AUTOMATION_GET_RUNS, async (_e, { workflowId }) => {
    return automationBuilder.getRuns(workflowId);
  });

  ipcMain.handle(IPC.AUTOMATION_STATS, async () => {
    return automationBuilder.getStats();
  });
}
