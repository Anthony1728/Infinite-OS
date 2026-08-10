import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { taskReplay, type ReplayExecution } from '../replay/index.js';
import { activityTracker, type DailySummary, type TrackedAction } from '../tracker/index.js';
import {
  youtubeLearning,
  type LearnedTask,
  type TaskTemplate,
  type VideoAnalysis,
} from '../youtube/index.js';

type ReplayInputStep = {
  type?: string;
  action?: string;
  target?: string;
  value?: string;
  url?: string;
  keys?: string;
  description?: string;
};

/** Register the learning, activity-tracking, and task-replay renderer APIs. */
export function registerLearningIpc(getMainWindow: () => BrowserWindow | null): void {
  const ready = Promise.all([taskReplay.init(), activityTracker.init(), youtubeLearning.init()]);

  const relayReplayEvent = (type: string) => (data: unknown) => {
    getMainWindow()?.webContents.send(IPC.REPLAY_COMMAND, { type, data });
  };
  taskReplay.on('browserCommand', relayReplayEvent('browser_command'));
  taskReplay.on('computerCommand', relayReplayEvent('computer_command'));
  taskReplay.on('executionStarted', relayReplayEvent('execution_started'));
  taskReplay.on('stepStarted', relayReplayEvent('step_started'));
  taskReplay.on('stepCompleted', relayReplayEvent('step_completed'));
  taskReplay.on('stepFailed', relayReplayEvent('step_failed'));
  taskReplay.on('executionCompleted', relayReplayEvent('execution_completed'));

  ipcMain.handle(IPC.YT_ANALYZE, async (_event, args: { url: string; transcript: string; title?: string; channel?: string }) => {
    await ready;
    return toRendererAnalysis(await youtubeLearning.analyzeVideo(args.url, args.transcript, args.title, args.channel));
  });
  ipcMain.handle(IPC.YT_LEARN, async (_event, args: { url: string; transcript: string; taskTitle?: string }) => {
    await ready;
    const title = args.taskTitle?.trim() || 'Learned task';
    return toRendererTask(await youtubeLearning.learnFromVideo(args.url, args.transcript, title));
  });
  ipcMain.handle(IPC.YT_LIST_TASKS, async () => {
    await ready;
    return youtubeLearning.listTasks().map(toRendererTask);
  });
  ipcMain.handle(IPC.YT_GET_TASK, async (_event, { id }: { id: string }) => {
    await ready;
    const task = youtubeLearning.getTask(id);
    return task ? toRendererTask(task) : null;
  });
  ipcMain.handle(IPC.YT_DELETE_TASK, async (_event, { id }: { id: string }) => {
    await ready;
    return youtubeLearning.deleteTask(id);
  });
  ipcMain.handle(IPC.YT_LIST_ANALYSES, async () => {
    await ready;
    return youtubeLearning.listAnalyses().map(toRendererAnalysis);
  });
  ipcMain.handle(IPC.YT_CREATE_TEMPLATE, async (_event, args: {
    name: string;
    steps: ReplayInputStep[];
    variables?: Record<string, string>;
    description?: string;
  }) => {
    await ready;
    const steps = args.steps.map((step) => ({
      type: normalizeTemplateStepType(step.action || step.type),
      params: templateStepParams(step),
      description: step.description || step.action || step.type || 'Task step',
    }));
    const variables = Object.entries(args.variables ?? {}).map(([name, defaultValue]) => ({
      name,
      type: 'text' as const,
      defaultValue,
      description: name,
    }));
    return toRendererTemplate(await youtubeLearning.createTaskFromSteps(args.name, steps, variables, args.description));
  });
  ipcMain.handle(IPC.YT_LIST_TEMPLATES, async () => {
    await ready;
    return youtubeLearning.listTemplates().map(toRendererTemplate);
  });
  ipcMain.handle(IPC.YT_LEARN_DAILY, async (_event, { sessionData }: {
    sessionData: {
      date: string;
      actions?: Array<{ type: string; target?: string; value?: string; timestamp: number }>;
      appsUsed?: string[];
      websitesVisited?: string[];
    };
  }) => {
    await ready;
    const tasks = await youtubeLearning.learnFromDailyActivity({
      date: sessionData.date,
      actions: sessionData.actions ?? [],
      appsUsed: sessionData.appsUsed ?? [],
      websitesVisited: sessionData.websitesVisited ?? [],
    });
    return tasks.map(toRendererTask);
  });

  ipcMain.handle(IPC.TRACKER_START, async () => {
    await ready;
    activityTracker.startTracking();
    return trackerStatus();
  });
  ipcMain.handle(IPC.TRACKER_STOP, async () => {
    await ready;
    const session = activityTracker.stopTracking();
    return { session, ...trackerStatus() };
  });
  ipcMain.handle(IPC.TRACKER_STATUS, async () => {
    await ready;
    return trackerStatus();
  });
  ipcMain.handle(IPC.TRACKER_RECORD, async (_event, { action }: {
    action: { type: string; target?: string; timestamp?: number; data?: Record<string, unknown> };
  }) => {
    await ready;
    return toRendererAction(activityTracker.recordAction({
      type: action.type as TrackedAction['type'],
      target: action.target,
      metadata: action.data,
    }));
  });
  ipcMain.handle(IPC.TRACKER_RECENT, async (_event, { count = 50 }: { count?: number } = {}) => {
    await ready;
    return activityTracker.getRecentActions(Math.max(0, Math.min(count, 1000))).map(toRendererAction);
  });
  ipcMain.handle(IPC.TRACKER_ANALYZE_DAY, async (_event, { date }: { date?: string } = {}) => {
    await ready;
    return toRendererDailySummary(await activityTracker.analyzeDay(date));
  });
  ipcMain.handle(IPC.TRACKER_PATTERNS, async () => {
    await ready;
    return activityTracker.getPatterns().map((pattern) => ({ ...pattern, data: { actions: pattern.actions } }));
  });

  ipcMain.handle(IPC.REPLAY_EXECUTE, async (_event, args: {
    taskName: string;
    steps: ReplayInputStep[];
    variables?: Record<string, string>;
    speed?: number;
  }) => {
    await ready;
    const execution = await taskReplay.executeTask(
      args.taskName,
      args.steps.map((step) => ({
        type: step.type || step.action || 'wait',
        params: templateStepParams(step),
        description: step.description || step.action || step.type || 'Task step',
      })),
      args.variables,
      args.speed,
    );
    return toRendererExecution(execution);
  });
  ipcMain.handle(IPC.REPLAY_EXECUTE_TASK, async (_event, { taskId, overrides }: {
    taskId: string;
    overrides?: Record<string, string>;
  }) => {
    await ready;
    const execution = await taskReplay.executeLearnedTask(taskId, overrides);
    return execution ? toRendererExecution(execution) : null;
  });
  ipcMain.handle(IPC.REPLAY_EXECUTE_NL, async (_event, { description }: { description: string }) => {
    await ready;
    return toRendererExecution(await taskReplay.executeNaturalLanguageTask(description));
  });
  ipcMain.handle(IPC.REPLAY_CANCEL, async (_event, { executionId }: { executionId: string }) => {
    await ready;
    return taskReplay.cancelExecution(executionId);
  });
  ipcMain.handle(IPC.REPLAY_PAUSE, async (_event, { executionId }: { executionId: string }) => {
    await ready;
    return taskReplay.pauseExecution(executionId);
  });
  ipcMain.handle(IPC.REPLAY_RESUME, async (_event, { executionId }: { executionId: string }) => {
    await ready;
    return taskReplay.resumeExecution(executionId);
  });
  ipcMain.handle(IPC.REPLAY_LIST, async () => {
    await ready;
    return taskReplay.listExecutions().map(toRendererExecution);
  });
  ipcMain.handle(IPC.REPLAY_GET, async (_event, { id }: { id: string }) => {
    await ready;
    const execution = taskReplay.getExecution(id);
    return execution ? toRendererExecution(execution) : null;
  });
  ipcMain.handle(IPC.REPLAY_BROWSER_TASK, async (_event, args: {
    url: string;
    actions: Array<{ type: string; selector?: string; value?: string }>;
  }) => {
    await ready;
    return taskReplay.executeBrowserTask(args.url, args.actions.map((action) => ({
      ...action,
      type: action.type as 'navigate' | 'click' | 'type' | 'scroll' | 'wait' | 'extract' | 'screenshot' | 'select',
      description: `${action.type}${action.selector ? ` ${action.selector}` : ''}`,
    })));
  });
  ipcMain.handle(IPC.REPLAY_COMPUTER_TASK, async (_event, { actions }: {
    actions: ReplayInputStep[];
  }) => {
    await ready;
    return taskReplay.executeComputerTask(actions.map((action) => ({
      type: (action.type || action.action || 'wait') as 'open_app' | 'close_app' | 'mouse_click' | 'mouse_move' | 'type_text' | 'key_press' | 'wait' | 'screenshot',
      params: templateStepParams(action),
      description: action.description || action.action || action.type || 'Computer step',
    })));
  });
}

function trackerStatus() {
  const session = activityTracker.getCurrentSession();
  return {
    isTracking: activityTracker.isCurrentlyTracking(),
    totalActions: activityTracker.getTotalActions(),
    currentSession: session?.id ?? null,
  };
}

function toRendererAction(action: TrackedAction) {
  const { id, type, timestamp, ...data } = action;
  return { id, type, timestamp: new Date(timestamp).toISOString(), data };
}

function toRendererDailySummary(summary: DailySummary) {
  const otherActions = Math.max(0, summary.totalActions - summary.mouseActions - summary.keyboardActions);
  const peakHours = [...new Set(summary.taskGroups.map((group) => new Date(group.startTime).getHours()))];
  return {
    date: summary.date,
    totalActions: summary.totalActions,
    breakdown: {
      mouse_actions: summary.mouseActions,
      keyboard_actions: summary.keyboardActions,
      other_actions: otherActions,
    },
    topApps: summary.mostUsedApps.map(({ app, count }) => ({ name: app, time: count * 60_000 })),
    topWebsites: summary.mostVisitedSites.map(({ site, count }) => ({ url: site, visits: count })),
    sessions: summary.taskGroups.map((group) => ({
      start: new Date(group.startTime).toISOString(),
      end: new Date(group.endTime).toISOString(),
      duration: group.duration,
      actions: group.actions.length,
    })),
    patterns: [],
    peakHours,
  };
}

function toRendererTask(task: LearnedTask) {
  return {
    ...task,
    name: task.title,
    sourceVideo: task.sourceTitle,
    steps: task.instructions.map((instruction) => ({
      action: instruction.action,
      target: instruction.target,
      value: instruction.value,
      description: `Step ${instruction.step}`,
    })),
    variables: {},
    createdAt: new Date(task.createdAt).toISOString(),
  };
}

function toRendererAnalysis(analysis: VideoAnalysis) {
  const extractedSteps = analysis.instructions.map((instruction) => ({
    action: instruction.action,
    target: instruction.target,
    value: instruction.value,
    description: `Step ${instruction.step}`,
  }));
  const suggestedVariables = [...new Set(extractedSteps.flatMap((step) => {
    const values = `${step.target ?? ''} ${step.value ?? ''}`;
    return [...values.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]);
  }))];
  return {
    ...analysis,
    extractedSteps,
    suggestedVariables,
    analyzedAt: new Date(analysis.analyzedAt).toISOString(),
  };
}

function toRendererTemplate(template: TaskTemplate) {
  return {
    ...template,
    steps: template.steps.map((step) => ({ action: step.type, ...step.params, description: step.description })),
    variables: template.variables.map((variable) => ({ ...variable, label: variable.description || variable.name })),
  };
}

function toRendererExecution(execution: ReplayExecution) {
  return {
    ...execution,
    startTime: new Date(execution.startedAt ?? execution.createdAt).toISOString(),
    endTime: execution.completedAt ? new Date(execution.completedAt).toISOString() : undefined,
    results: execution.steps
      .map((step, stepIndex) => ({
        stepIndex,
        success: step.status === 'completed',
        error: step.error,
        result: step.result,
        status: step.status,
      }))
      .filter((result) => result.status !== 'pending'),
  };
}

function normalizeTemplateStepType(type = 'wait'): TaskTemplate['steps'][number]['type'] {
  const aliases: Record<string, TaskTemplate['steps'][number]['type']> = {
    open_url: 'navigate',
    click: 'mouse_click',
    type: 'type_text',
    press_key: 'key_press',
  };
  const normalized = aliases[type] ?? type;
  const allowed: TaskTemplate['steps'][number]['type'][] = [
    'mouse_click', 'mouse_move', 'type_text', 'key_press', 'wait', 'scroll', 'screenshot', 'open_app', 'navigate',
  ];
  return allowed.includes(normalized as TaskTemplate['steps'][number]['type'])
    ? normalized as TaskTemplate['steps'][number]['type']
    : 'wait';
}

function templateStepParams(step: ReplayInputStep): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (step.target != null) params.target = step.target;
  if (step.value != null) params.value = step.value;
  if (step.url != null) params.url = step.url;
  if (step.keys != null) params.keys = step.keys;
  const action = step.action || step.type;
  if (action === 'open_url') params.url = step.url || step.value || step.target;
  if (action === 'type') params.text = step.value;
  if (action === 'press_key') params.keys = step.keys || step.value;
  return params;
}
