// Automation Builder IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { automationBuilder } from '../automation/builder.js';
import { automationScheduler } from '../automation/scheduler.js';

export function registerAutomationIpc(getMainWindow?: () => Electron.BrowserWindow | null): void {
  // Scheduler-initiated runs broadcast progress to the main window the same
  // way manual runs do, so the UI shows live activity for both.
  if (getMainWindow) {
    automationScheduler.start((progress) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) win.webContents.send(IPC.AUTOMATION_RUN_EVENT, progress);
    });
  }

  ipcMain.handle(IPC.AUTOMATION_CREATE_WORKFLOW, async (_e, { name, description, trigger, actions }) => {
    return automationBuilder.createWorkflow({ name, description, trigger, actions });
  });

  ipcMain.handle(IPC.AUTOMATION_RUN_WORKFLOW, async (event, { workflowId }) => {
    return automationBuilder.runWorkflow(workflowId, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.AUTOMATION_RUN_EVENT, progress);
    });
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

  ipcMain.handle(IPC.AUTOMATION_DELETE_WORKFLOW, async (_e, { workflowId }) => {
    return automationBuilder.deleteWorkflow(workflowId);
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

  ipcMain.handle(IPC.AUTOMATION_SCHEDULER_STATUS, async () => {
    return automationScheduler.getStatus();
  });

  ipcMain.handle(IPC.AUTOMATION_SET_KEEP_AWAKE, async (_e, { enabled }) => {
    return automationScheduler.setKeepAwake(enabled === true);
  });

  ipcMain.handle(IPC.AUTOMATION_NEXT_RUNS, async () => {
    const out: Record<string, string> = {};
    for (const wf of automationBuilder.listWorkflows()) {
      const next = automationScheduler.nextRunFor(wf);
      if (next) out[wf.id] = next;
    }
    return out;
  });
}

