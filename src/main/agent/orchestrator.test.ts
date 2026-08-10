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

    expect(task.subTasks.map((subTask) => subTask.agentType)).toEqual([
      'research',
      'code',
      'design',
      'code',
      'code',
    ]);
    for (let index = 1; index < task.subTasks.length; index++) {
      expect(task.subTasks[index].dependencies).toEqual([task.subTasks[index - 1].id]);
    }
    expect(task.subTasks.at(-1)?.description).toMatch(/tests\/build\/lint|verify/i);
  });

  it('passes the original request and dependency results into every working phase', async () => {
    const orchestrator = new TaskOrchestrator();
    const original = 'Build a polished landing page with a working contact form';
    const task = orchestrator.analyze(original, new Map());

    const completed = await orchestrator.execute(task.id, 'session-test', 'C:\\workspace', () => undefined);

    expect(completed.status).toBe('completed');
    expect(runtime.calls).toHaveLength(task.subTasks.length);
    expect(runtime.calls.every((call) => call.task.includes(original))).toBe(true);
    expect(runtime.calls[1].task).toContain('Verified phase result from research');
    expect(runtime.calls.at(-1)?.task).toContain('Verified phase result from');
    expect(runtime.calls.at(-1)?.task).toMatch(/work on the real files/i);
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
    runtime.failOnceFor = 'research';
    const orchestrator = new TaskOrchestrator();
    const task = orchestrator.analyze('Build a complete dashboard app', new Map());

    const completed = await orchestrator.execute(task.id, 'session-test', 'C:\\workspace', () => undefined);

    expect(completed.status).toBe('completed');
    expect(runtime.calls.filter((call) => call.agentId === 'research')).toHaveLength(2);
    expect(completed.report?.retries).toHaveLength(1);
    expect(completed.report?.failed).toHaveLength(0);
  });
});
