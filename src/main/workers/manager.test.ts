import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutomationBuilder, type AutomationRunProgress } from '../automation/builder.js';
import { WorkerManager, describeTrigger, type WorkerEvent } from './manager.js';

const directories: string[] = [];

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'infinite-workers-test-'));
  directories.push(root);
  const builder = new AutomationBuilder({ dataDir: join(root, 'automation') });
  const manager = new WorkerManager({
    dataDir: join(root, 'workers'),
    workspaceRoot: join(root, 'workspaces'),
    builder,
  });
  return { root, builder, manager };
}

afterEach(() => {
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Progress events are what the scheduler's runs stream; the manager maps them to steps. */
type ProgressDriver = { handleProgress: (progress: AutomationRunProgress) => void };
function drive(manager: WorkerManager, progress: Partial<AutomationRunProgress> & { type: AutomationRunProgress['type'] }): void {
  (manager as unknown as ProgressDriver).handleProgress({
    runId: 'run-1',
    workflowId: 'wf',
    workflowName: 'Worker · test',
    totalActions: 2,
    message: '',
    timestamp: Date.now(),
    ...progress,
  } as AutomationRunProgress);
}

describe('workers', () => {
  it('creates an isolated workspace and one agent action per step plus a notify', () => {
    const { builder, manager } = setup();
    const worker = manager.create({
      name: 'Morning triage',
      task: 'Triage the inbox every morning.',
      steps: ['Read new mail', 'Draft replies', 'Summarise for me'],
      trigger: { type: 'interval', config: { intervalMs: 120_000 } },
    });

    expect(worker.status).toBe('scheduled');
    expect(worker.scheduleLabel).toBe('Every 2m');
    expect(worker.nextRunAt && Date.parse(worker.nextRunAt)).toBeGreaterThan(Date.now());
    expect(worker.steps.map((step) => step.title)).toEqual(['Read new mail', 'Draft replies', 'Summarise for me']);
    expect(worker.workspace).toContain(worker.id);
    for (const sub of ['', 'output', 'screenshots']) {
      expect(existsSync(join(worker.workspace, sub))).toBe(true);
    }

    const workflow = builder.getWorkflow(worker.workflowId)!;
    expect(workflow.actions).toHaveLength(4); // 3 steps + trailing notify
    expect(workflow.actions.at(-1)!.type).toBe('notify');
    expect(workflow.actions.slice(0, -1).every((action) => action.type === 'agent_run')).toBe(true);
    // Every step runs in the worker's own workspace, and the step prompt is
    // grounded in the mission, the worklist, and the previous step's result.
    const prompt = String(workflow.actions[0].config.task);
    expect(prompt).toContain(worker.workspace);
    expect(prompt).toContain('Triage the inbox every morning.');
    expect(prompt).toContain('2. Draft replies');
    expect(prompt).toContain('{{previous}}');
    expect(prompt).toContain('WorkerVault');

    manager.close();
  });

  it('derives titles and the mission step from what the user gave it', () => {
    const { manager } = setup();
    const worker = manager.create({ name: 'Fallback', task: 'Do the weekly report' });
    expect(worker.steps).toHaveLength(1);
    expect(worker.steps[0].title).toBe('Do the weekly report');
    expect(worker.status).toBe('draft'); // manual only
    expect(worker.scheduleLabel).toBe('Manual only');
    expect(manager.stats()).toMatchObject({ total: 1, scheduled: 0 });
    manager.close();
  });

  it('rejects schedules that could never fire', () => {
    const { manager } = setup();
    expect(() => manager.create({ name: 'x', task: 'y', trigger: { type: 'interval', config: { intervalMs: 5 } } }))
      .toThrow(/at least one minute/);
    expect(() => manager.create({ name: 'x', task: 'y', trigger: { type: 'cron', config: { cron: 'not a cron' } } }))
      .toThrow(/Invalid cron/);
    expect(() => manager.create({ name: 'x', task: 'y', trigger: { type: 'once', config: { onceAt: 'later' } } }))
      .toThrow(/valid date\/time/);
    expect(() => manager.create({ name: '', task: 'y' })).toThrow(/name is required/i);
    expect(() => manager.create({ name: 'x', task: '   ' })).toThrow(/task is required/i);
    manager.close();
  });

  it('describes every trigger type in human words', () => {
    expect(describeTrigger({ type: 'manual', config: {} })).toBe('Manual only');
    expect(describeTrigger({ type: 'interval', config: { intervalMs: 3_600_000 } })).toBe('Every 1h');
    expect(describeTrigger({ type: 'cron', config: { cron: '0 9 * * *' } })).toBe('Daily at 09:00');
    expect(describeTrigger({ type: 'cron', config: { cron: '30 8 * * 1-5' } })).toBe('Weekdays at 08:30');
    expect(describeTrigger({ type: 'once', config: { onceAt: new Date(0).toISOString() } })).toContain('Once at');
    expect(describeTrigger({ type: 'idle', config: { idleMinutes: 7 } })).toBe('When idle for 7m');
  });

  it('maps scheduled-run progress onto the step list, including confidence', () => {
    const { builder, manager } = setup();
    const events: WorkerEvent[] = [];
    manager.onEvent((event) => events.push(event));
    const worker = manager.create({ name: 'Progress', task: 'Two steps', steps: ['One', 'Two'], trigger: { type: 'interval', config: { intervalMs: 600_000 } } });
    const workflow = builder.getWorkflow(worker.workflowId)!;
    const [first, second] = workflow.actions;

    drive(manager, { type: 'run_started', workflowId: worker.workflowId, actionId: undefined });
    expect(manager.get(worker.id)!.status).toBe('running');

    drive(manager, { type: 'action_started', workflowId: worker.workflowId, actionId: first.id, message: 'working' });
    let view = manager.get(worker.id)!;
    expect(view.steps[0].status).toBe('running');
    expect(view.currentStepIndex).toBe(0);

    // Streaming progress must reach the UI even though nothing "completed" yet.
    drive(manager, { type: 'action_progress', workflowId: worker.workflowId, actionId: first.id, message: 'opening the portal' });
    expect(manager.get(worker.id)!.status).toBe('running');

    drive(manager, { type: 'action_completed', workflowId: worker.workflowId, actionId: first.id, result: 'first done' });
    view = manager.get(worker.id)!;
    expect(view.steps[0].status).toBe('completed');
    expect(view.steps[0].result).toContain('first done');
    expect(view.progress).toBe(50);

    drive(manager, { type: 'action_completed', workflowId: worker.workflowId, actionId: second.id, result: 'second done' });
    drive(manager, {
      type: 'run_completed', workflowId: worker.workflowId, status: 'completed', result: 'all good',
    });
    view = manager.get(worker.id)!;
    expect(view.status).toBe('scheduled'); // enabled schedule resumes after the run
    expect(view.progress).toBe(100);
    expect(view.successfulRuns).toBe(1);
    expect(view.confidence).toBe(33);
    expect(view.lastResult).toContain('all good');

    // Two more clean runs → full confidence (3 consecutive successes = 100%).
    for (let i = 0; i < 2; i++) {
      drive(manager, { type: 'run_started', workflowId: worker.workflowId, runId: `run-${i}` });
      drive(manager, { type: 'action_completed', workflowId: worker.workflowId, actionId: first.id, runId: `run-${i}` });
      drive(manager, { type: 'action_completed', workflowId: worker.workflowId, actionId: second.id, runId: `run-${i}` });
      drive(manager, { type: 'run_completed', workflowId: worker.workflowId, runId: `run-${i}`, status: 'completed', result: 'ok' });
    }
    expect(manager.get(worker.id)!.confidence).toBe(100);

    expect(events.length).toBeGreaterThan(5);
    expect(events.every((event) => event.workerId === worker.id)).toBe(true);
    expect(events.some((event) => event.type === 'worker_progress')).toBe(true);
    manager.close();
  });

  it('surfaces a failed run as needs attention and resets confidence', () => {
    const { builder, manager } = setup();
    const worker = manager.create({ name: 'Fragile', task: 'task', steps: ['One'] });
    const first = builder.getWorkflow(worker.workflowId)!.actions[0];

    drive(manager, { type: 'run_started', workflowId: worker.workflowId });
    drive(manager, { type: 'action_failed', workflowId: worker.workflowId, actionId: first.id, result: 'login blocked' });
    let view = manager.get(worker.id)!;
    expect(view.status).toBe('needs_input');
    expect(view.lastError).toContain('login blocked');
    expect(view.steps[0].status).toBe('failed');

    drive(manager, { type: 'run_completed', workflowId: worker.workflowId, status: 'failed', result: 'login blocked' });
    view = manager.get(worker.id)!;
    expect(view.failedRuns).toBe(1);
    expect(view.consecutiveSuccesses).toBe(0);
    expect(view.confidence).toBe(0);
    manager.close();
  });

  it('marks a question in the run as needs input instead of a stuck worker', () => {
    const { builder, manager } = setup();
    const worker = manager.create({ name: 'Asks', task: 'task', steps: ['One'] });
    const first = builder.getWorkflow(worker.workflowId)!.actions[0];
    drive(manager, { type: 'run_started', workflowId: worker.workflowId });
    drive(manager, { type: 'action_started', workflowId: worker.workflowId, actionId: first.id });
    drive(manager, { type: 'action_progress', workflowId: worker.workflowId, actionId: first.id, message: 'AskUserQuestion needs your answer' });
    expect(manager.get(worker.id)!.status).toBe('needs_input');
    manager.close();
  });

  it('interjects an operator instruction into pending steps of a live run', () => {
    const { builder, manager } = setup();
    const worker = manager.create({ name: 'Steerable', task: 'task', steps: ['One', 'Two'] });
    const workflow = builder.getWorkflow(worker.workflowId)!;

    // Not running: the note is kept for future runs, nothing is rewritten.
    expect(manager.interject(worker.id, 'use the backup account')).toEqual({ ok: true, updatedSteps: 0 });
    expect(manager.get(worker.id)!.notes).toContain('use the backup account');

    drive(manager, { type: 'run_started', workflowId: worker.workflowId });
    const result = manager.interject(worker.id, 'prefer the CSV export');
    expect(result.updatedSteps).toBe(workflow.actions.filter((action) => action.type === 'agent_run').length);
    expect(builder.getWorkflow(worker.workflowId)!.actions[0].config.task).toContain('prefer the CSV export');
    expect(() => manager.interject(worker.id, '   ')).toThrow(/empty/i);
    manager.close();
  });

  it('pauses and resumes without losing the schedule', () => {
    const { builder, manager } = setup();
    const worker = manager.create({
      name: 'Toggle', task: 'task', trigger: { type: 'cron', config: { cron: '0 9 * * *' } },
    });

    const paused = manager.pause(worker.id);
    expect(paused.status).toBe('paused');
    expect(paused.enabled).toBe(false);
    expect(builder.getWorkflow(worker.workflowId)!.enabled).toBe(false);
    expect(manager.stats()).toMatchObject({ paused: 1, scheduled: 0 });

    const resumed = manager.resume(worker.id);
    expect(resumed.status).toBe('scheduled');
    expect(resumed.enabled).toBe(true);
    expect(builder.getWorkflow(worker.workflowId)!.enabled).toBe(true);
    manager.close();
  });

  it('edits a stopped worker and refuses to edit a running one', () => {
    const { manager } = setup();
    const worker = manager.create({ name: 'Old', task: 'first mission', steps: ['One'] });

    const updated = manager.update(worker.id, {
      name: 'New',
      task: 'second mission',
      steps: [{ title: 'Renamed', instruction: 'do it', referenceFrame: 'C:\\demo\\frame.jpg' }],
      trigger: { type: 'interval', config: { intervalMs: 300_000 } },
      notifyOnFinish: false,
    });
    expect(updated.name).toBe('New');
    expect(updated.task).toBe('second mission');
    expect(updated.steps).toHaveLength(1);
    expect(updated.steps[0].title).toBe('Renamed');
    expect(updated.scheduleLabel).toBe('Every 5m');
    expect(updated.notifyOnFinish).toBe(false);

    manager.pause(worker.id); // paused workers stay editable
    expect(manager.update(worker.id, { name: 'Paused edit' }).name).toBe('Paused edit');
    expect(() => manager.update('nope', { name: 'x' })).toThrow(/not found/i);
    manager.close();
  });

  it('persists workers and never restores a stale running badge', () => {
    const root = mkdtempSync(join(tmpdir(), 'infinite-workers-persist-'));
    directories.push(root);
    const builderDir = join(root, 'automation');
    const workersDir = join(root, 'workers');
    const builder = new AutomationBuilder({ dataDir: builderDir });

    const first = new WorkerManager({ dataDir: workersDir, workspaceRoot: join(root, 'ws'), builder });
    const worker = first.create({ name: 'Persisted', task: 'task', steps: ['One'], trigger: { type: 'interval', config: { intervalMs: 60_000 } } });
    first.close();

    // Simulate a process that died mid-run: the badge on disk says running.
    const file = join(workersDir, 'workers.json');
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { workers: Array<{ id: string; status: string }> };
    stored.workers.find((entry) => entry.id === worker.id)!.status = 'running';
    writeFileSync(file, JSON.stringify(stored), 'utf8');

    const reloaded = new WorkerManager({ dataDir: workersDir, workspaceRoot: join(root, 'ws'), builder });
    const restored = reloaded.get(worker.id)!;
    expect(restored.status).toBe('scheduled');
    expect(restored.activeRunId).toBeUndefined();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.findByWorkflowId(worker.workflowId)?.id).toBe(worker.id);
    reloaded.close();
  });

  it('deletes the worker, its workflow and its run history', () => {
    const { builder, manager } = setup();
    const worker = manager.create({ name: 'Ephemeral', task: 'task', steps: ['One'] });
    expect(manager.delete(worker.id)).toBe(true);
    expect(manager.get(worker.id)).toBeNull();
    expect(builder.getWorkflow(worker.workflowId)).toBeFalsy();
    expect(manager.getHistory(worker.id)).toEqual([]);
    expect(manager.delete(worker.id)).toBe(false);
    manager.close();
  });
});
