// Task Replay Engine — executes learned tasks by controlling mouse, keyboard,
// browser, and applications. Takes a TaskTemplate or LearnedTask and plays it back
// with variable substitution and human-like timing.

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

export interface ReplayStep {
  id: string;
  type: 'mouse_click' | 'mouse_move' | 'type_text' | 'key_press' | 'wait' | 'scroll' | 'screenshot' | 'open_app' | 'navigate' | 'find_and_click' | 'type_in_field';
  params: Record<string, unknown>;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface ReplayExecution {
  id: string;
  taskName: string;
  steps: ReplayStep[];
  variables: Record<string, string>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  startedAt?: number;
  completedAt?: number;
  speed: number;
  createdAt: number;
}

export interface BrowserTask {
  id: string;
  url: string;
  actions: Array<{
    type: 'navigate' | 'click' | 'type' | 'scroll' | 'wait' | 'extract' | 'screenshot' | 'select';
    selector?: string;
    value?: string;
    description: string;
  }>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export interface ComputerTask {
  id: string;
  actions: Array<{
    type: 'open_app' | 'close_app' | 'mouse_click' | 'mouse_move' | 'type_text' | 'key_press' | 'wait' | 'screenshot';
    params: Record<string, unknown>;
    description: string;
  }>;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

const REPLAY_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.infinite-ai', 'replay');

export class TaskReplayEngine extends EventEmitter {
  private executions: Map<string, ReplayExecution> = new Map();
  private browserTasks: Map<string, BrowserTask> = new Map();
  private computerTasks: Map<string, ComputerTask> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  async init(): Promise<void> {
    try {
      await fs.mkdir(REPLAY_DIR, { recursive: true });
      await fs.mkdir(path.join(REPLAY_DIR, 'executions'), { recursive: true });
    } catch { /* ignore */ }
  }

  async executeTask(
    taskName: string,
    steps: Array<{ type: string; params: Record<string, unknown>; description: string }>,
    variables: Record<string, string> = {},
    speed = 1.0,
  ): Promise<ReplayExecution> {
    const execution: ReplayExecution = {
      id: uuidv4(),
      taskName,
      steps: steps.map((s) => ({
        id: uuidv4(),
        type: s.type as ReplayStep['type'],
        params: this.substituteVariables(s.params, variables),
        description: this.substituteText(s.description, variables),
        status: 'pending',
      })),
      variables,
      status: 'pending',
      currentStep: 0,
      totalSteps: steps.length,
      speed,
      createdAt: Date.now(),
    };

    this.executions.set(execution.id, execution);
    this.emit('executionCreated', execution);

    this.runExecution(execution.id).catch(() => {});
    return execution;
  }

  async executeLearnedTask(taskId: string, overrides: Record<string, string> = {}): Promise<ReplayExecution | null> {
    const { youtubeLearning } = await import('../youtube/index.js');
    const task = youtubeLearning.getTask(taskId);
    if (!task) return null;

    const variables = { ...overrides };
    const steps = task.instructions.map(i => ({
      type: i.action,
      params: { target: i.target, value: i.value },
      description: `Step ${i.step}: ${i.action} ${i.target || ''}`,
    }));

    return this.executeTask(task.title, steps, variables);
  }

  async executeNaturalLanguageTask(description: string): Promise<ReplayExecution> {
    const steps = this.parseNaturalLanguage(description);
    return this.executeTask(description, steps);
  }

  async executeBrowserTask(url: string, actions: BrowserTask['actions']): Promise<BrowserTask> {
    const task: BrowserTask = {
      id: uuidv4(),
      url,
      actions,
      status: 'running',
    };

    this.browserTasks.set(task.id, task);
    this.emit('browserTaskStarted', task);

    try {
      for (const action of actions) {
        this.emit('browserTaskProgress', { taskId: task.id, action });

        switch (action.type) {
          case 'navigate':
            this.emit('browserCommand', { command: 'navigate', url: action.value || url });
            break;
          case 'click':
            this.emit('browserCommand', { command: 'click', selector: action.selector });
            break;
          case 'type':
            this.emit('browserCommand', { command: 'type', selector: action.selector, value: action.value });
            break;
          case 'scroll':
            this.emit('browserCommand', { command: 'scroll', direction: action.value || 'down' });
            break;
          case 'wait':
            await new Promise(r => setTimeout(r, parseInt(action.value || '1000')));
            break;
          case 'extract':
            this.emit('browserCommand', { command: 'extract', selector: action.selector });
            break;
          case 'screenshot':
            this.emit('browserCommand', { command: 'screenshot' });
            break;
          case 'select':
            this.emit('browserCommand', { command: 'select', selector: action.selector, value: action.value });
            break;
        }

        await new Promise(r => setTimeout(r, 500));
      }

      task.status = 'completed';
      this.emit('browserTaskCompleted', task);
    } catch (err: unknown) {
      task.status = 'failed';
      task.result = (err as Error).message;
      this.emit('browserTaskFailed', task);
    }

    return task;
  }

  async executeComputerTask(actions: ComputerTask['actions']): Promise<ComputerTask> {
    const task: ComputerTask = {
      id: uuidv4(),
      actions,
      status: 'running',
    };

    this.computerTasks.set(task.id, task);
    this.emit('computerTaskStarted', task);

    try {
      for (const action of actions) {
        this.emit('computerTaskProgress', { taskId: task.id, action });

        switch (action.type) {
          case 'open_app':
            this.emit('computerCommand', { command: 'open_app', ...action.params });
            break;
          case 'close_app':
            this.emit('computerCommand', { command: 'close_app', ...action.params });
            break;
          case 'mouse_click':
            this.emit('computerCommand', { command: 'mouse_click', ...action.params });
            break;
          case 'mouse_move':
            this.emit('computerCommand', { command: 'mouse_move', ...action.params });
            break;
          case 'type_text':
            this.emit('computerCommand', { command: 'type_text', ...action.params });
            break;
          case 'key_press':
            this.emit('computerCommand', { command: 'key_press', ...action.params });
            break;
          case 'wait':
            await new Promise(r => setTimeout(r, parseInt(String(action.params.duration || '1000'))));
            break;
          case 'screenshot':
            this.emit('computerCommand', { command: 'screenshot' });
            break;
        }

        await new Promise(r => setTimeout(r, 300 / (this.executions.values().next().value?.speed || 1)));
      }

      task.status = 'completed';
      this.emit('computerTaskCompleted', task);
    } catch (err: unknown) {
      task.status = 'failed';
      this.emit('computerTaskFailed', task);
    }

    return task;
  }

  private async runExecution(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) return;

    const controller = new AbortController();
    this.abortControllers.set(executionId, controller);

    execution.status = 'running';
    execution.startedAt = Date.now();
    this.emit('executionStarted', execution);

    for (let i = 0; i < execution.steps.length; i++) {
      if (controller.signal.aborted) {
        execution.status = 'cancelled';
        break;
      }

      execution.currentStep = i;
      const step = execution.steps[i];
      step.status = 'running';
      step.startedAt = Date.now();
      this.emit('stepStarted', { executionId, step });

      try {
        await this.executeStep(step, execution.speed);
        step.status = 'completed';
        step.completedAt = Date.now();
        this.emit('stepCompleted', { executionId, step });
      } catch (err: unknown) {
        step.status = 'failed';
        step.error = (err as Error).message;
        step.completedAt = Date.now();
        this.emit('stepFailed', { executionId, step });
      }

      const delay = step.type === 'wait' ? 0 : 500 / execution.speed;
      await new Promise(r => setTimeout(r, delay));
    }

    execution.completedAt = Date.now();
    if (execution.status === 'running') {
      execution.status = execution.steps.every(s => s.status === 'completed') ? 'completed' : 'failed';
    }
    this.abortControllers.delete(executionId);
    this.emit('executionCompleted', execution);
    await this.saveExecution(execution);
  }

  private async executeStep(step: ReplayStep, speed: number): Promise<void> {
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms / speed));

    // Import computer control agent for real execution
    const { getComputerControl } = await import('../agent/computer-singleton.js');
    const computerControl = getComputerControl();

    switch (step.type) {
      case 'mouse_click':
        await computerControl.clickMouse(
          Number(step.params.x) || 0,
          Number(step.params.y) || 0,
          (step.params.button as 'left' | 'right' | 'middle') || 'left',
        );
        step.result = `Clicked at (${step.params.x}, ${step.params.y})`;
        await delay(100);
        break;
      case 'mouse_move':
        await computerControl.moveMouse(
          Number(step.params.x) || 0,
          Number(step.params.y) || 0,
        );
        step.result = `Moved to (${step.params.x}, ${step.params.y})`;
        await delay(50);
        break;
      case 'type_text':
        await computerControl.typeText(String(step.params.text || ''));
        step.result = `Typed: ${step.params.text}`;
        await delay(200);
        break;
      case 'key_press':
        await computerControl.pressKey(...(Array.isArray(step.params.keys) ? step.params.keys : [String(step.params.keys || 'enter')]));
        step.result = `Pressed: ${step.params.keys}`;
        await delay(100);
        break;
      case 'wait':
        await delay(parseInt(String(step.params.duration || '1000')));
        step.result = `Waited ${step.params.duration}ms`;
        break;
      case 'scroll':
        await computerControl.scroll(0, 0, Number(step.params.amount) || 3);
        step.result = `Scrolled ${step.params.direction || 'down'}`;
        await delay(200);
        break;
      case 'screenshot': {
        const capture = await computerControl.captureScreen();
        step.result = `Screenshot saved: ${capture.path}`;
        await delay(500);
        break;
      }
      case 'open_app':
        await computerControl.openApplication(
          String(step.params.name || step.params.path || ''),
          step.params.path ? String(step.params.path) : undefined,
        );
        step.result = `Opened: ${step.params.name || step.params.path}`;
        await delay(1000);
        break;
      case 'navigate':
        this.emit('browserCommand', { command: 'navigate', url: step.params.url });
        await delay(2000);
        break;
      case 'find_and_click':
        // For find_and_click, we do a screenshot first then click center area
        step.result = `Find and click: ${step.params.target} (visual search not yet supported)`;
        await delay(500);
        break;
      case 'type_in_field':
        await computerControl.typeText(String(step.params.text || ''));
        step.result = `Typed in field: ${step.params.text}`;
        await delay(300);
        break;
    }
  }

  private parseNaturalLanguage(description: string): Array<{ type: string; params: Record<string, unknown>; description: string }> {
    const steps: Array<{ type: string; params: Record<string, unknown>; description: string }> = [];
    const lower = description.toLowerCase();

    if (lower.includes('open') && (lower.includes('browser') || lower.includes('chrome') || lower.includes('firefox'))) {
      steps.push({ type: 'open_app', params: { name: 'browser' }, description: 'Open web browser' });
    }

    const urlMatch = description.match(/https?:\/\/[^\s]+/);
    if (urlMatch || lower.includes('go to') || lower.includes('navigate to') || lower.includes('open website')) {
      const url = urlMatch?.[0] || this.inferUrl(lower);
      steps.push({ type: 'navigate', params: { url }, description: `Navigate to ${url}` });
    }

    if (lower.includes('search for') || lower.includes('find')) {
      const searchTerm = description.match(/(?:search for|find)\s+(.+?)(?:\s+and|$)/i)?.[1] || '';
      steps.push({ type: 'navigate', params: { url: `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}` }, description: `Search for "${searchTerm}"` });
    }

    if (lower.includes('install')) {
      const app = description.match(/install\s+(.+?)(?:\s+and|$)/i)?.[1] || '';
      steps.push({ type: 'open_app', params: { name: 'powershell' }, description: 'Open terminal' });
      steps.push({ type: 'type_text', params: { text: `winget install "${app}"` }, description: `Install ${app}` });
      steps.push({ type: 'key_press', params: { keys: 'enter' }, description: 'Press Enter' });
    }

    if (lower.includes('type') || lower.includes('write') || lower.includes('enter')) {
      const textMatch = description.match(/(?:type|write|enter)\s+["']?(.+?)["']?\s*(?:and|$)/i);
      if (textMatch) {
        steps.push({ type: 'type_text', params: { text: textMatch[1] }, description: `Type "${textMatch[1]}"` });
      }
    }

    if (lower.includes('press enter') || lower.includes('hit enter')) {
      steps.push({ type: 'key_press', params: { keys: 'enter' }, description: 'Press Enter' });
    }

    if (lower.includes('screenshot') || lower.includes('take a picture')) {
      steps.push({ type: 'screenshot', params: {}, description: 'Take screenshot' });
    }

    if (lower.includes('save')) {
      steps.push({ type: 'key_press', params: { keys: 'ctrl+s' }, description: 'Save (Ctrl+S)' });
    }

    if (lower.includes('copy')) {
      steps.push({ type: 'key_press', params: { keys: 'ctrl+c' }, description: 'Copy (Ctrl+C)' });
    }

    if (lower.includes('paste')) {
      steps.push({ type: 'key_press', params: { keys: 'ctrl+v' }, description: 'Paste (Ctrl+V)' });
    }

    if (steps.length === 0) {
      steps.push({ type: 'wait', params: { duration: '1000' }, description: 'Processing request...' });
    }

    return steps;
  }

  private inferUrl(lower: string): string {
    if (lower.includes('amazon')) return 'https://www.amazon.com';
    if (lower.includes('google')) return 'https://www.google.com';
    if (lower.includes('youtube')) return 'https://www.youtube.com';
    if (lower.includes('github')) return 'https://github.com';
    if (lower.includes('facebook') || lower.includes('meta')) return 'https://www.facebook.com';
    if (lower.includes('twitter') || lower.includes('x.com')) return 'https://twitter.com';
    if (lower.includes('reddit')) return 'https://www.reddit.com';
    if (lower.includes('netflix')) return 'https://www.netflix.com';
    if (lower.includes('spotify')) return 'https://open.spotify.com';
    return 'https://www.google.com';
  }

  private substituteVariables(params: Record<string, unknown>, variables: Record<string, string>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        result[key] = this.substituteText(value, variables);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private substituteText(text: string, variables: Record<string, string>): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  private async saveExecution(execution: ReplayExecution): Promise<void> {
    try {
      await fs.writeFile(
        path.join(REPLAY_DIR, 'executions', `${execution.id}.json`),
        JSON.stringify(execution, null, 2),
      );
    } catch { /* ignore */ }
  }

  cancelExecution(executionId: string): boolean {
    const controller = this.abortControllers.get(executionId);
    if (!controller) return false;
    controller.abort();
    const execution = this.executions.get(executionId);
    if (execution) execution.status = 'cancelled';
    return true;
  }

  pauseExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'running') return false;
    execution.status = 'paused';
    return true;
  }

  resumeExecution(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution || execution.status !== 'paused') return false;
    execution.status = 'running';
    this.runExecution(executionId).catch(() => {});
    return true;
  }

  listExecutions(): ReplayExecution[] { return Array.from(this.executions.values()); }
  getExecution(id: string): ReplayExecution | undefined { return this.executions.get(id); }
  listBrowserTasks(): BrowserTask[] { return Array.from(this.browserTasks.values()); }
  listComputerTasks(): ComputerTask[] { return Array.from(this.computerTasks.values()); }
}

export const taskReplay = new TaskReplayEngine();

