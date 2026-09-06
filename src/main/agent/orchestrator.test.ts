import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  calls: [] as Array<{ task: string; agentId: string; sink: (event: unknown) => void }>,
  sequence: 0,
  failOnceFor: '' as string,
  failed: false,
}));

vi.mock('./runtime.js', () => ({
  abortSubagent: vi.fn(() => true),
  spawnSubagent: (options: { task: string; agentId: string; sink: (event: unknown) => void }) => {
    runtime.calls.push(options);
    const id = `run-${++runtime.sequence}`;
    const state = {
      id,
      agentId: options.agentId,
      sessionId: 'session-test',
      status: 'running',
      task: options.task,
      startedAt: Date.now(),
      toolCallCount: 1,
    };
    const result = `Verified phase result from ${options.agentId}`;
    if (runtime.failOnceFor === options.agentId && !runtime.failed) {
      runtime.failed = true;
      options.sink({ type: 'fail', runId: id, error: 'Cancelled before completion.' });
      return { state, done: Promise.resolve('') };
    }
    options.sink({ type: 'complete', runId: id, result });
    return { state, done: Promise.resolve(result) };
  },
}));

import { TaskOrchestrator } from './orchestrator.js';

beforeEach(() => {
  runtime.calls.length = 0;
  runtime.sequence = 0;
  runtime.failOnceFor = '';
  runtime.failed = false;
});

describe('TaskOrchestrator build workflow', () => {
  it('serializes workspace edits and finishes with a real verification phase', () => {
    const orchestrator = new TaskOrchestrator();
    const task = orchestrator.analyze('Create a complete responsive web application', new Map());

    // Smart decomposition: web app build tasks get 2-phase (build + audit)
    expect(task.subTasks.map((subTask) => subTask.agentType)).toEqual([
      'code',
      'code',
    ]);
    expect(task.subTasks[0].description).toMatch(/build|implement/i);
    expect(task.subTasks[1].description).toMatch(/audit|verify/i);
    expect(task.subTasks[1].dependencies).toEqual([task.subTasks[0].id]);
  });

  it('passes the original request and dependency results into every working phase', async () => {
    const orchestrator = new TaskOrchestrator();
    const original = 'Build a polished landing page with a working contact form';
    const task = orchestrator.analyze(original, new Map());

    const completed = await orchestrator.execute(task.id, 'session-test', 'C:\\workspace', () => undefined);

    expect(completed.status).toBe('completed');
    expect(runtime.calls).toHaveLength(task.subTasks.length);
    expect(runtime.calls.every((call) => call.task.includes(original))).toBe(true);
    expect(runtime.calls.at(-1)?.task).toContain('Verified phase result from');
  });

  it('carries live user updates into phases that have not started yet', async () => {
    const orchestrator = new TaskOrchestrator();
    const task = orchestrator.analyze('Build a complete dashboard app', new Map());

    orchestrator.interject(task.id, 'Use a compact dark data table instead of cards.');
    await orchestrator.execute(task.id, 'session-test', 'C:\\workspace', () => undefined);

    expect(orchestrator.getTask(task.id)?.originalPrompt).toContain('compact dark data table');
    expect(runtime.calls.slice(1).every((call) => call.task.includes('compact dark data table'))).toBe(true);
  });

  it('retries a recoverable cancelled phase with a fresh subagent attempt', async () => {
    runtime.failOnceFor = 'code';
    const orchestrator = new TaskOrchestrator();
    const task = orchestrator.analyze('Build a complete dashboard app', new Map());

    const completed = await orchestrator.execute(task.id, 'session-test', 'C:\\workspace', () => undefined);

    expect(completed.status).toBe('completed');
    expect(runtime.calls.filter((call) => call.agentId === 'code').length).toBeGreaterThanOrEqual(2);
    expect(completed.report?.retries.length).toBeGreaterThanOrEqual(1);
    expect(completed.report?.failed).toHaveLength(0);
  });
});
