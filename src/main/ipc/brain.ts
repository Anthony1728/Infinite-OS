// Brain IPC handler registration — wires all brain channels to main-process brain instances.

import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { brain, offline, reasoning, workflow, monitor, improvement, marketplace, sdk } from '../index.js';
import { getEngine } from '../engine/intelligence.js';
import { getBrainTeachingManager, type TeachingFocus, type TeachingStatus } from '../brain/teacher.js';
import { getLearningMemoryStats, ingestResponse } from '../brain/learning.js';
import { SafetyGovernor, type ActionRequest } from '../brain/safety.js';

const safetyGovernor = new SafetyGovernor();

function teachingFocus(value: unknown): TeachingFocus {
  const focus = typeof value === 'string' ? value.toLowerCase() : '';
  if (/\b(?:code|coding|typescript|javascript|python|react|api|debug|test|database|frontend|backend)\b/.test(focus)) return 'coding';
  if (/\b(?:tool|search|browser|terminal|file|agent|automation|failover)\b/.test(focus)) return 'tools';
  if (/\b(?:general|chat|talk|explain|writing|conversation)\b/.test(focus)) return 'general';
  return 'balanced';
}

function teachingStatus(status: TeachingStatus) {
  return {
    ...status,
    active: status.state === 'running',
    lessonsCompleted: status.lessonsAdded,
    lessonsLearned: status.totalStoredLessons,
    provider: status.currentProvider ?? undefined,
    model: status.currentModel ?? undefined,
  };
}

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

  // Safety validation is a real policy check, not an unconditional approval.
  ipcMain.handle(IPC.BRAIN_SAFETY_VALIDATE, async (_event, args: { action?: Partial<ActionRequest> }) => {
    const input = args?.action ?? {};
    const request: ActionRequest = {
      id: input.id ?? crypto.randomUUID(),
      type: input.type ?? 'execute',
      target: input.target ?? 'unknown',
      payload: input.payload ?? {},
      source: input.source ?? 'brain',
      timestamp: input.timestamp ?? Date.now(),
      riskLevel: input.riskLevel ?? 'medium',
    };
    return safetyGovernor.validate(request);
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

  // Time-boxed background teaching. Provider failures remain inside the
  // manager; the renderer receives only useful state and progress.
  const teacher = getBrainTeachingManager();
  let teachingSource: 'curriculum' | 'topic' | 'conversation' | 'last-task' | 'online' = 'curriculum';
  let teachingTopic = '';
  ipcMain.handle(IPC.BRAIN_TEACH_START, async (_event, args: {
    durationMinutes?: number;
    source?: 'curriculum' | 'topic' | 'conversation' | 'last-task' | 'online';
    topic?: string;
    context?: string;
    focus?: string;
    provider?: string;
    model?: string;
  } = {}) => {
    const durationMinutes = args.durationMinutes === 60 ? 60 : 10;
    const requestedSource = args.source ?? (args.topic ? 'topic' : 'curriculum');
    const requestedTopic = typeof args.topic === 'string' ? args.topic.trim().slice(0, 300) : '';
    const alreadyRunning = teacher.getStatus().state === 'running';
    if (!alreadyRunning) {
      teachingSource = requestedSource;
      teachingTopic = requestedTopic;
    }
    const status = await teacher.start({
      durationMinutes,
      focus: teachingFocus(args.focus),
      ...(requestedTopic ? { customTopic: requestedTopic } : {}),
      ...(typeof args.context === 'string' && args.context.trim() ? { currentContext: args.context.slice(0, 8_000) } : {}),
      onlineResearch: requestedSource === 'online',
      ...(args.provider && args.model ? { preferred: { provider: args.provider, model: args.model } } : {}),
    });
    return { ...teachingStatus(status), source: teachingSource, topic: teachingTopic || undefined };
  });
  ipcMain.handle(IPC.BRAIN_TEACH_STOP, async () => ({ ...teachingStatus(teacher.stop()), source: teachingSource, topic: teachingTopic || undefined }));
  ipcMain.handle(IPC.BRAIN_TEACH_STATUS, async () => ({ ...teachingStatus(teacher.getStatus()), source: teachingSource, topic: teachingTopic || undefined }));
  teacher.onEvent((event) => {
    const payload = { ...event, status: { ...teachingStatus(event.status), source: teachingSource, topic: teachingTopic || undefined } };
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.BRAIN_TEACH_EVENT, payload);
    }
  });
  ipcMain.handle(IPC.BRAIN_LEARN_INTERACTION, async (_event, args: {
    request?: string;
    response?: string;
    provider?: string;
    model?: string;
    durationMs?: number;
    success?: boolean;
  } = {}) => {
    if (args.success !== true || !args.request?.trim() || !args.response?.trim()) return { learned: false };
    const learned = ingestResponse({
      request: args.request,
      taskContext: '',
      response: args.response,
      provider: args.provider || 'infinite-os',
      model: args.model || 'local-brain',
      durationMs: args.durationMs ?? 0,
      successfulTools: [],
    });
    return { learned: Boolean(learned) };
  });
  ipcMain.handle(IPC.BRAIN_LEARN_STATS, async () => getLearningMemoryStats());

  // ── System Doctor ──
  ipcMain.handle('brain:doctor:health', async () => {
    const health = monitor.getOverallHealth();
    const suggestions = monitor.getSuggestions();
    const agentHealth = monitor.getAgentHealth();
    const modelHealth = monitor.getModelHealth();
    const recentAlerts = monitor.getRecentAlerts(10);
    return {
      overall: health,
      suggestions,
      agentHealth,
      modelHealth,
      recentAlerts,
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('brain:doctor:runCheck', async () => {
    // Force a full health check cycle
    const metrics = await monitor.collectMetrics();
    const health = monitor.getOverallHealth();
    const suggestions = monitor.getSuggestions();
    const improvements = improvement.generateImprovements();
    return {
      metrics,
      health,
      suggestions,
      improvements,
      timestamp: Date.now(),
    };
  });

  // ── Self-Improvement ──
  ipcMain.handle('brain:improve:run', async () => {
    const result = brain.runImprovementCycle();
    const improvements = improvement.generateImprovements();
    return {
      core: result,
      engine: improvements.map(a => ({ id: a.id, type: a.type, description: a.description, expectedImpact: a.expectedImpact })),
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('brain:improve:patterns', async () => {
    return improvement.getPatterns();
  });

  ipcMain.handle('brain:improve:errors', async () => {
    return improvement.getErrors();
  });

  ipcMain.handle('brain:improve:actions', async () => {
    return improvement.getActions();
  });

  // ── Brain Memory ──
  ipcMain.handle('brain:memory:learning', async () => {
    return brain.getLearningMemory();
  });

  ipcMain.handle('brain:memory:performance', async () => {
    return brain.getModelPerformance();
  });

  ipcMain.handle('brain:memory:events', async (_e, { count }: { count?: number }) => {
    return brain.getRecentEvents(count ?? 20);
  });

  // ── Intelligence Engine ──
  ipcMain.handle(IPC.ENGINE_STATUS, async () => {
    const engine = getEngine();
    return engine.getStatus();
  });

  ipcMain.handle(IPC.ENGINE_BOOTSTRAP, async () => {
    const engine = getEngine();
    const bootstrapped = engine.tryBootstrap();
    const status = engine.getStatus();
    return { bootstrapped, status };
  });
}

