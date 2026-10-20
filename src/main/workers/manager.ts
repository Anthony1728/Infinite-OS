/**
 * First-class digital Workers.
 *
 * A Worker is a durable, named task with a visible step list, an isolated
 * workspace, an optional schedule, and run history. It compiles down to one
 * Automation workflow with one agent step per worker step, which means the
 * existing scheduler, retries, cancellation, and provider resolution all keep
 * working without a second execution engine.
 *
 * The manager is deliberately the only place that maps workflow progress back
 * to the worker model. The scheduler starts runs on its own, so listening to
 * the builder's global progress stream (instead of only manual run callbacks)
 * is what keeps scheduled workers truthful in the UI.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import {
  AutomationBuilder,
  automationBuilder,
  type Action,
  type AutomationRunProgress,
  type Trigger,
  type WorkflowRun,
} from '../automation/builder.js';
import { automationScheduler } from '../automation/scheduler.js';
import { parseCron } from '../tools/time.js';

export type WorkerStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'needs_input';
export type WorkerStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkerStep {
  id: string;
  title: string;
  instruction: string;
  /** Local screenshot captured during Teaching mode, when available. */
  referenceFrame?: string;
  status: WorkerStepStatus;
  result?: string;
}

export interface Worker {
  id: string;
  name: string;
  description: string;
  task: string;
  steps: WorkerStep[];
  trigger: Trigger;
  workflowId: string;
  workspace: string;
  status: WorkerStatus;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastResult?: string;
  lastError?: string;
  activeRunId?: string;
  progress: number;
  currentStepIndex: number;
  successfulRuns: number;
  failedRuns: number;
  consecutiveSuccesses: number;
  notifyOnFinish: boolean;
  /** Instructions added by the operator; future steps and future runs see them. */
  notes: string[];
  /** Learning progress is an honest confidence signal: 3 clean runs = 100%. */
  confidence: number;
}

export interface WorkerView extends Worker {
  nextRunAt?: string;
  totalRuns: number;
  lastRunStatus?: WorkflowRun['status'];
  scheduleLabel: string;
}

export interface WorkerCreateInput {
  name: string;
  description?: string;
  task: string;
  steps?: Array<string | { title: string; instruction?: string; referenceFrame?: string }>;
  trigger?: Trigger;
  notifyOnFinish?: boolean;
}

export interface WorkerUpdateInput {
  name?: string;
  description?: string;
  task?: string;
  steps?: Array<string | { title: string; instruction?: string; referenceFrame?: string }>;
  trigger?: Trigger;
  notifyOnFinish?: boolean;
}

export interface WorkerEvent {
  type: 'worker_updated' | 'worker_deleted' | 'worker_progress';
  workerId: string;
  worker?: WorkerView;
  progress?: AutomationRunProgress;
}

export interface WorkerStats {
  total: number;
  scheduled: number;
  running: number;
  needsInput: number;
  paused: number;
  successfulRuns: number;
}

interface StoredWorkers {
  version: 1;
  workers: Worker[];
}

interface WorkerManagerOptions {
  dataDir?: string;
  workspaceRoot?: string;
  builder?: AutomationBuilder;
}

const MAX_RUN_RESULT = 8_000;
const MAX_NOTE = 4_000;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stepTitle(text: string, index: number): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
  const oneLine = firstLine.replace(/\s+/g, ' ');
  if (!oneLine) return `Step ${index + 1}`;
  return oneLine.length > 90 ? `${oneLine.slice(0, 87)}...` : oneLine;
}

function normalizeSteps(
  input: WorkerCreateInput['steps'],
  task: string,
): Array<{ title: string; instruction: string; referenceFrame?: string }> {
  const items = (input ?? [])
    .map((step, index) => {
      if (typeof step === 'string') {
        const instruction = step.trim();
        if (!instruction) return null;
        return { title: stepTitle(instruction, index), instruction };
      }
      const instruction = cleanText(step.instruction || step.title, 12_000);
      if (!instruction) return null;
      return {
        title: cleanText(step.title, 120) || stepTitle(instruction, index),
        instruction,
        referenceFrame: cleanText(step.referenceFrame, 2_000) || undefined,
      };
    })
    .filter((step): step is { title: string; instruction: string; referenceFrame?: string } => Boolean(step));

  if (items.length) return items;
  const fallback = task.trim();
  return [{ title: stepTitle(fallback, 0), instruction: fallback }];
}

function normalizeTrigger(trigger: Trigger | undefined): Trigger {
  if (!trigger || !trigger.type) return { type: 'manual', config: {} };
  switch (trigger.type) {
    case 'manual':
      return { type: 'manual', config: {} };
    case 'interval': {
      const intervalMs = Number(trigger.config?.intervalMs);
      if (!Number.isFinite(intervalMs) || intervalMs < 60_000) {
        throw new Error('An interval schedule must be at least one minute.');
      }
      return { type: 'interval', config: { intervalMs: Math.trunc(intervalMs) } };
    }
    case 'schedule':
    case 'cron': {
      const cron = cleanText(trigger.config?.cron, 100);
      if (!cron) throw new Error('A cron schedule needs a cron expression.');
      try {
        parseCron(cron);
      } catch {
        throw new Error(`Invalid cron expression: ${cron}`);
      }
      return { type: trigger.type, config: { cron } };
    }
    case 'once': {
      const onceAt = cleanText(trigger.config?.onceAt, 100);
      if (!onceAt || !Number.isFinite(Date.parse(onceAt))) {
        throw new Error('A one-shot schedule needs a valid date/time.');
      }
      return { type: 'once', config: { onceAt } };
    }
    default:
      return clone(trigger);
  }
}

export function describeTrigger(trigger: Trigger): string {
  switch (trigger.type) {
    case 'manual':
      return 'Manual only';
    case 'interval': {
      const ms = Number(trigger.config?.intervalMs);
      if (!Number.isFinite(ms) || ms <= 0) return 'Interval';
      if (ms % 3_600_000 === 0) return `Every ${ms / 3_600_000}h`;
      if (ms % 60_000 === 0) return `Every ${ms / 60_000}m`;
      return `Every ${Math.max(1, Math.round(ms / 1000))}s`;
    }
    case 'schedule':
    case 'cron': {
      const cron = String(trigger.config?.cron ?? '');
      const parts = cron.split(/\s+/);
      if (parts.length === 5) {
        const [minute, hour, day, month, weekday] = parts;
        const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        if (day === '*' && month === '*' && weekday === '*') return `Daily at ${time}`;
        if (day === '*' && month === '*' && /^\d$/.test(weekday)) {
          const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          return `Every ${names[Number(weekday)] ?? `day ${weekday}`} at ${time}`;
        }
        if (day === '*' && month === '*' && /^\d-\d$/.test(weekday)) return `Weekdays at ${time}`;
        if (month === '*' && day !== '*' && weekday === '*') return `Monthly on day ${day} at ${time}`;
      }
      return `Scheduled (${cron})`;
    }
    case 'once': {
      const at = Date.parse(String(trigger.config?.onceAt ?? ''));
      return Number.isFinite(at) ? `Once at ${new Date(at).toLocaleString()}` : 'Once';
    }
    case 'idle':
      return `When idle for ${Number(trigger.config?.idleMinutes ?? 10)}m`;
    default:
      return trigger.type.replace(/_/g, ' ');
  }
}

export class WorkerManager {
  private readonly dataDir: string;
  private readonly workspaceRoot: string;
  private readonly builder: AutomationBuilder;
  private readonly workers = new Map<string, Worker>();
  private readonly actionToStep = new Map<string, Map<string, string>>();
  private readonly listeners = new Set<(event: WorkerEvent) => void>();
  private readonly unsubscribeBuilder: () => void;

  constructor(options: WorkerManagerOptions = {}) {
    this.dataDir = options.dataDir ?? join(infiniteHome(), 'workers');
    this.workspaceRoot = options.workspaceRoot ?? join(this.dataDir, 'workspaces');
    this.builder = options.builder ?? automationBuilder;
    this.load();
    this.unsubscribeBuilder = this.builder.onProgress((progress) => this.handleProgress(progress));
  }

  close(): void {
    this.unsubscribeBuilder();
    this.listeners.clear();
  }

  onEvent(listener: (event: WorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  list(): WorkerView[] {
    return Array.from(this.workers.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((worker) => this.view(worker));
  }

  get(id: string): WorkerView | null {
    const worker = this.workers.get(id);
    return worker ? this.view(worker) : null;
  }

  findByWorkflowId(workflowId: string): Worker | undefined {
    return Array.from(this.workers.values()).find((worker) => worker.workflowId === workflowId);
  }

  getHistory(id: string): WorkflowRun[] {
    const worker = this.workers.get(id);
    if (!worker) return [];
    return this.builder.getRuns(worker.workflowId).slice().sort((a, b) => b.startedAt - a.startedAt);
  }

  stats(): WorkerStats {
    const workers = Array.from(this.workers.values());
    return {
      total: workers.length,
      scheduled: workers.filter((worker) => worker.enabled && worker.status !== 'paused' && worker.trigger.type !== 'manual').length,
      running: workers.filter((worker) => worker.status === 'running').length,
      needsInput: workers.filter((worker) => worker.status === 'needs_input').length,
      paused: workers.filter((worker) => worker.status === 'paused').length,
      successfulRuns: workers.reduce((sum, worker) => sum + worker.successfulRuns, 0),
    };
  }

  create(input: WorkerCreateInput): WorkerView {
    const name = cleanText(input.name, 120);
    const task = cleanText(input.task, 12_000);
    if (!name) throw new Error('Worker name is required.');
    if (!task) throw new Error('Worker task is required.');
    const trigger = normalizeTrigger(input.trigger);
    const id = randomUUID();
    const workspace = join(this.workspaceRoot, id);
    this.ensureWorkspace(workspace);

    const now = Date.now();
    const normalized = normalizeSteps(input.steps, task);
    const worker: Worker = {
      id,
      name,
      description: cleanText(input.description, 500),
      task,
      steps: normalized.map((step) => ({
        id: randomUUID(),
        title: step.title,
        instruction: step.instruction,
        referenceFrame: step.referenceFrame,
        status: 'pending',
      })),
      trigger,
      workflowId: '',
      workspace,
      status: trigger.type === 'manual' ? 'draft' : 'scheduled',
      enabled: true,
      createdAt: now,
      updatedAt: now,
      progress: 0,
      currentStepIndex: 0,
      successfulRuns: 0,
      failedRuns: 0,
      consecutiveSuccesses: 0,
      notifyOnFinish: input.notifyOnFinish !== false,
      notes: [],
      confidence: 0,
    };

    const workflow = this.builder.createWorkflow({
      name: `Worker · ${worker.name}`,
      description: worker.description || worker.task,
      trigger: worker.trigger,
      actions: this.buildActions(worker),
    });
    worker.workflowId = workflow.id;

    this.workers.set(id, worker);
    this.indexActions(worker);
    this.save();
    this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });
    return this.view(worker);
  }

  update(id: string, input: WorkerUpdateInput): WorkerView {
    const worker = this.workers.get(id);
    if (!worker) throw new Error('Worker not found.');
    if (worker.status === 'running') throw new Error('Stop the current run before editing this worker.');

    if (typeof input.name === 'string') {
      const name = cleanText(input.name, 120);
      if (!name) throw new Error('Worker name cannot be empty.');
      worker.name = name;
    }
    if (typeof input.description === 'string') worker.description = cleanText(input.description, 500);
    if (typeof input.task === 'string') {
      const task = cleanText(input.task, 12_000);
      if (!task) throw new Error('Worker task cannot be empty.');
      worker.task = task;
    }
    if (input.steps !== undefined) {
      worker.steps = normalizeSteps(input.steps, worker.task).map((step) => ({
        id: randomUUID(),
        title: step.title,
        instruction: step.instruction,
        referenceFrame: step.referenceFrame,
        status: 'pending',
      }));
    }
    if (input.trigger !== undefined) worker.trigger = normalizeTrigger(input.trigger);
    if (typeof input.notifyOnFinish === 'boolean') worker.notifyOnFinish = input.notifyOnFinish;
    worker.updatedAt = Date.now();
    if (worker.status !== 'paused') worker.status = worker.trigger.type === 'manual' ? 'draft' : 'scheduled';

    this.builder.updateWorkflow(worker.workflowId, {
      name: `Worker · ${worker.name}`,
      description: worker.description || worker.task,
      trigger: worker.trigger,
      actions: this.buildActions(worker),
      enabled: worker.enabled,
    });
    this.indexActions(worker);
    this.save();
    this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });
    return this.view(worker);
  }

  startRun(id: string): WorkerView {
    const worker = this.workers.get(id);
    if (!worker) throw new Error('Worker not found.');
    if (worker.status === 'running') throw new Error('This worker is already running.');

    worker.status = 'running';
    worker.progress = 0;
    worker.currentStepIndex = 0;
    worker.lastError = undefined;
    worker.activeRunId = undefined;
    worker.steps = worker.steps.map((step) => ({ ...step, status: 'pending', result: undefined }));
    worker.updatedAt = Date.now();
    this.save();
    this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });

    void this.builder.runWorkflow(worker.workflowId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      worker.status = 'needs_input';
      worker.lastError = message;
      worker.activeRunId = undefined;
      worker.updatedAt = Date.now();
      this.save();
      this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });
    });

    return this.view(worker);
  }

  cancel(id: string): boolean {
    const worker = this.workers.get(id);
    if (!worker || !worker.activeRunId) return false;
    return this.builder.cancelRun(worker.activeRunId);
  }

  pause(id: string): WorkerView {
    const worker = this.workers.get(id);
    if (!worker) throw new Error('Worker not found.');
    if (worker.activeRunId) this.builder.cancelRun(worker.activeRunId);
    worker.enabled = false;
    worker.status = 'paused';
    worker.updatedAt = Date.now();
    this.builder.disableWorkflow(worker.workflowId);
    this.save();
    this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });
    return this.view(worker);
  }

  resume(id: string): WorkerView {
    const worker = this.workers.get(id);
    if (!worker) throw new Error('Worker not found.');
    worker.enabled = true;
    worker.status = worker.trigger.type === 'manual' ? 'draft' : 'scheduled';
    worker.updatedAt = Date.now();
    this.builder.enableWorkflow(worker.workflowId);
    this.save();
    this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });
    return this.view(worker);
  }

  interject(id: string, message: string): { ok: boolean; updatedSteps: number } {
    const worker = this.workers.get(id);
    if (!worker) throw new Error('Worker not found.');
    const note = cleanText(message, MAX_NOTE);
    if (!note) throw new Error('Instruction cannot be empty.');
    worker.notes = [...worker.notes.slice(-19), note];
    const updatedSteps = worker.status === 'running' ? this.builder.appendInstruction(worker.workflowId, note) : 0;
    worker.updatedAt = Date.now();
    this.save();
    this.emit({ type: 'worker_updated', workerId: id, worker: this.view(worker) });
    return { ok: true, updatedSteps };
  }

  delete(id: string): boolean {
    const worker = this.workers.get(id);
    if (!worker) return false;
    if (worker.activeRunId) this.builder.cancelRun(worker.activeRunId);
    this.builder.deleteWorkflow(worker.workflowId);
    this.workers.delete(id);
    this.actionToStep.delete(worker.workflowId);
    this.save();
    this.emit({ type: 'worker_deleted', workerId: id });
    return true;
  }

  private view(worker: Worker): WorkerView {
    const workflow = this.builder.getWorkflow(worker.workflowId);
    const runs = this.builder.getRuns(worker.workflowId).slice().sort((a, b) => a.startedAt - b.startedAt);
    const last = runs[runs.length - 1];
    let nextRunAt: string | undefined;
    try {
      nextRunAt = workflow ? automationScheduler.nextRunFor(workflow) ?? undefined : undefined;
    } catch {
      nextRunAt = undefined;
    }
    return {
      ...clone(worker),
      nextRunAt,
      totalRuns: runs.length,
      lastRunStatus: last?.status,
      scheduleLabel: describeTrigger(worker.trigger),
    };
  }

  private buildActions(worker: Worker): Action[] {
    const actions: Action[] = worker.steps.map((step, index) => ({
      id: randomUUID(),
      type: 'agent_run',
      config: {
        agent: 'general',
        task: this.buildStepPrompt(worker, step, index),
        cwd: worker.workspace,
        stepId: step.id,
      },
      onError: 'stop',
    }));
    if (worker.notifyOnFinish) {
      actions.push({
        id: randomUUID(),
        type: 'notify',
        config: {
          title: `Worker: ${worker.name}`,
          message: `"${worker.name}" finished its task. Open Workers to review the result.`,
        },
        onError: 'continue',
      });
    }
    return actions;
  }

  private buildStepPrompt(worker: Worker, step: WorkerStep, index: number): string {
    const worklist = worker.steps
      .map((item, itemIndex) => `${itemIndex + 1}. ${item.title}`)
      .join('\n');
    const notes = worker.notes.length
      ? `\nOperator notes:\n${worker.notes.map((note) => `- ${note}`).join('\n')}\n`
      : '';
    const reference = step.referenceFrame
      ? `\nA screenshot captured while the user demonstrated this step is available at: ${step.referenceFrame}\n`
      : '';
    return [
      `You are "${worker.name}", an autonomous digital worker inside Infinite OS.`,
      '',
      `Mission:\n${worker.task}`,
      '',
      `Workspace (keep files and downloads here): ${worker.workspace}`,
      `Current step ${index + 1} of ${worker.steps.length}: ${step.title}`,
      step.instruction,
      reference,
      'Full worklist:',
      worklist,
      notes,
      'Execution rules:',
      '- Operate the real applications and files. Observe the result of every action before moving on.',
      '- Prefer PCLiveMap and the Browser/Operator tools; use Computer visual actions only when the UI cannot be read reliably.',
      '- Do not claim success without verification. If something is blocked, report the exact blocker instead of inventing a result.',
      '- Use only the worker workspace for new files unless the task explicitly names another location.',
      '- If a saved login is needed, call WorkerVault with action="list" to see authorized labels, then action="type" with the credential label, field ("username"|"password"), and submit. Never ask the user to paste a password into chat.',
      '- If the Infinite OS window is visible and you need a decision only the user can make, you may ask one focused question. In a background run, stop and report the blocker instead of waiting forever.',
      '',
      'Previous step result:',
      '{{previous}}',
      '',
      'Return a concise verification summary for this step: what you did, what you observed, and anything the next step must know.',
    ].join('\n');
  }

  private handleProgress(progress: AutomationRunProgress): void {
    const worker = this.findByWorkflowId(progress.workflowId);
    if (!worker) return;
    const stepId = progress.actionId ? this.actionToStep.get(progress.workflowId)?.get(progress.actionId) : undefined;
    const step = stepId ? worker.steps.find((item) => item.id === stepId) : undefined;

    if (progress.type === 'run_started') {
      worker.status = 'running';
      worker.activeRunId = progress.runId;
      worker.progress = 0;
      worker.currentStepIndex = 0;
      worker.lastError = undefined;
      worker.steps = worker.steps.map((item) => ({ ...item, status: 'pending', result: undefined }));
    } else if (progress.type === 'action_started') {
      worker.status = 'running';
      if (step) {
        const index = worker.steps.findIndex((item) => item.id === step.id);
        worker.currentStepIndex = Math.max(0, index);
        step.status = 'running';
        step.result = undefined;
      }
    } else if (progress.type === 'action_progress') {
      // AskUserQuestion blocks the run until the user answers. Surface that as
      // "needs input" instead of a silent, apparently-stuck worker.
      if (/AskUserQuestion|question_request|needs your (input|answer)/i.test(progress.message)) {
        worker.status = 'needs_input';
        worker.lastError = 'Waiting for your answer.';
      } else if (worker.status === 'needs_input') {
        worker.status = 'running';
      }
    } else if (progress.type === 'action_completed') {
      if (step) {
        step.status = 'completed';
        step.result = (progress.result ?? progress.message).slice(0, MAX_RUN_RESULT);
      }
      worker.status = 'running';
      worker.progress = this.progressFor(worker);
      worker.currentStepIndex = Math.min(worker.steps.length - 1, worker.currentStepIndex + 1);
    } else if (progress.type === 'action_failed') {
      if (step) {
        step.status = 'failed';
        step.result = (progress.result ?? progress.message).slice(0, MAX_RUN_RESULT);
      }
      worker.status = 'needs_input';
      worker.lastError = (progress.result ?? progress.message).slice(0, MAX_RUN_RESULT);
      worker.progress = this.progressFor(worker);
    } else if (progress.type === 'run_completed') {
      worker.activeRunId = undefined;
      worker.lastRunAt = progress.timestamp;
      if (progress.status === 'completed') {
        worker.successfulRuns++;
        worker.consecutiveSuccesses++;
        worker.lastResult = (progress.result ?? progress.message).slice(0, MAX_RUN_RESULT);
        worker.lastError = undefined;
        worker.progress = 100;
        worker.steps = worker.steps.map((item) => item.status === 'running' ? { ...item, status: 'completed' } : item);
        worker.status = worker.enabled ? (worker.trigger.type === 'manual' ? 'draft' : 'scheduled') : 'paused';
      } else if (progress.status === 'cancelled') {
        worker.lastResult = 'Stopped by user.';
        worker.status = worker.enabled ? (worker.trigger.type === 'manual' ? 'draft' : 'scheduled') : 'paused';
      } else {
        worker.failedRuns++;
        worker.consecutiveSuccesses = 0;
        worker.lastError = (progress.result ?? progress.message).slice(0, MAX_RUN_RESULT);
        worker.status = 'needs_input';
      }
      worker.confidence = Math.min(100, Math.round((worker.consecutiveSuccesses / 3) * 100));
    } else {
      return;
    }

    if (progress.type !== 'action_progress') {
      worker.updatedAt = Date.now();
      this.save();
      this.emit({ type: 'worker_updated', workerId: worker.id, worker: this.view(worker), progress });
    } else {
      this.emit({ type: 'worker_progress', workerId: worker.id, worker: this.view(worker), progress });
    }
  }

  private progressFor(worker: Worker): number {
    if (!worker.steps.length) return 0;
    const completed = worker.steps.filter((step) => step.status === 'completed').length;
    return Math.round((completed / worker.steps.length) * 100);
  }

  private indexActions(worker: Worker): void {
    const workflow = this.builder.getWorkflow(worker.workflowId);
    const map = new Map<string, string>();
    for (const action of workflow?.actions ?? []) {
      const stepId = action.config?.stepId;
      if (typeof stepId === 'string') map.set(action.id, stepId);
    }
    this.actionToStep.set(worker.workflowId, map);
  }

  private ensureWorkspace(path: string): void {
    for (const sub of ['', 'output', 'screenshots']) {
      const target = sub ? join(path, sub) : path;
      if (!existsSync(target)) mkdirSync(target, { recursive: true });
    }
  }

  private load(): void {
    try {
      const path = join(this.dataDir, 'workers.json');
      if (!existsSync(path)) return;
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredWorkers | Worker[];
      const workers = Array.isArray(parsed) ? parsed : parsed.workers;
      if (!Array.isArray(workers)) return;
      for (const worker of workers) {
        if (!worker || typeof worker.id !== 'string' || typeof worker.workflowId !== 'string') continue;
        // A run cannot survive a process restart, so never restore a stale
        // "running" badge. Scheduled workers are still scheduled.
        if (worker.status === 'running') {
          worker.status = worker.enabled ? (worker.trigger.type === 'manual' ? 'draft' : 'scheduled') : 'paused';
          worker.activeRunId = undefined;
        }
        this.workers.set(worker.id, worker);
        this.indexActions(worker);
      }
    } catch (error) {
      console.warn('[workers] failed to load workers.json:', error);
    }
  }

  private save(): void {
    try {
      if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
      const payload: StoredWorkers = { version: 1, workers: Array.from(this.workers.values()) };
      writeFileSync(join(this.dataDir, 'workers.json'), JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
      console.warn('[workers] failed to save workers.json:', error);
    }
  }

  private emit(event: WorkerEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* UI listeners must never break a worker */ }
    }
  }
}

let singleton: WorkerManager | null = null;

/** Lazy so importing a tool in a test never creates the user's real data dir. */
export function getWorkerManager(): WorkerManager {
  if (!singleton) singleton = new WorkerManager();
  return singleton;
}

export function setWorkerManagerForTests(manager: WorkerManager | null): void {
  singleton = manager;
}
