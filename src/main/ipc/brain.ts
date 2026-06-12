// Brain IPC handler registration — wires all brain channels to main-process brain instances.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { brain, safety, offline, reasoning, workflow, monitor, improvement, marketplace, sdk } from '../index.js';

export function registerBrainIpc(): void {
  // Brain Status
  ipcMain.handle(IPC.BRAIN_STATUS, async () => {
    return {
      online: true,
      learning: true,
      stats: brain.getStats(),
      health: brain.checkHealth(),
      improvement: improvement.getStats(),
    };
  });

  // Brain Decide
  ipcMain.handle(IPC.BRAIN_DECIDE, async (_e, { context }) => {
    const decision = brain.decideModel(context);
    return decision;
  });

  // Safety Validate
  ipcMain.handle(IPC.BRAIN_SAFETY_VALIDATE, async (_e, { action }) => {
    const result = safety.validate(action);
    return result;
  });

  // Offline Status
  ipcMain.handle(IPC.BRAIN_OFFLINE_STATUS, async () => {
    const status = await offline.checkConnectivity();
    return status;
  });

  // Reasoning
  ipcMain.handle(IPC.BRAIN_REASON, async (_e, { task, tools, context }) => {
    const toolFns = (tools ?? []).map((t: { name: string; execute: (input: Record<string, unknown>) => Promise<string> }) => ({
      name: t.name,
      execute: t.execute,
    }));
    const result = await reasoning.reason(task, toolFns, context);
    return result;
  });

  // Workflow Run
  ipcMain.handle(IPC.BRAIN_WORKFLOW_RUN, async (_e, { name, inputs }) => {
    // Create workflow from template and execute it
    const created = workflow.createFromTemplate(name, inputs ?? {});
    if (!created) return { ok: false, error: 'Template not found' };
    const result = await workflow.executeWorkflow(created.id);
    return result;
  });

  // Workflow Status
  ipcMain.handle(IPC.BRAIN_WORKFLOW_STATUS, async () => {
    return workflow.getStats();
  });

  // Monitor Metrics
  ipcMain.handle(IPC.BRAIN_MONITOR_METRICS, async () => {
    const metrics = await monitor.collectMetrics();
    return metrics;
  });

  // Monitor Alerts
  ipcMain.handle(IPC.BRAIN_MONITOR_ALERTS, async () => {
    return monitor.getRecentAlerts(50);
  });

  // Improvement Stats
  ipcMain.handle(IPC.BRAIN_IMPROVE_STATS, async () => {
    return improvement.getStats();
  });

  // Improvement Record
  ipcMain.handle(IPC.BRAIN_IMPROVE_RECORD, async (_e, { taskType, pattern, success, duration, model, approach }) => {
    improvement.recordTaskExecution(taskType, pattern, success, duration, model, approach);
    return { ok: true };
  });

  // Marketplace List
  ipcMain.handle(IPC.BRAIN_MARKETPLACE_LIST, async () => {
    return marketplace.getInstalledTools();
  });

  // Marketplace Search
  ipcMain.handle(IPC.BRAIN_MARKETPLACE_SEARCH, async (_e, { query }) => {
    return marketplace.searchTools(query);
  });

  // Marketplace Install
  ipcMain.handle(IPC.BRAIN_MARKETPLACE_INSTALL, async (_e, { toolId }) => {
    const tool = marketplace.getTool(toolId);
    if (tool) {
      tool.installed = true;
      tool.enabled = true;
      return { ok: true };
    }
    return { ok: false, error: 'Tool not found' };
  });

  // SDK Info
  ipcMain.handle(IPC.BRAIN_SDK_INFO, async () => {
    return sdk.getInfo();
  });

  // SDK Create Tool
  ipcMain.handle(IPC.BRAIN_SDK_CREATE_TOOL, async (_e, { definition }) => {
    const id = sdk.createTool(definition);
    return { ok: true, id };
  });
}
