import { describe, expect, it } from 'vitest';
import {
  canResumeTask,
  canTransitionTask,
  transitionTask,
  validateTaskDependencies,
  type TaskRecord,
} from './task-contract.js';

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    contractVersion: 1,
    id: 'task-1',
    sessionId: 'session-1',
    parentTaskId: null,
    objective: 'Build and verify a feature',
    workspace: 'C:/workspace',
    status: 'queued',
    planRevision: 0,
    createdAt: 100,
    updatedAt: 100,
    startedAt: null,
    completedAt: null,
    attempt: 0,
    maxAttempts: 3,
    cancelRequested: false,
    failure: null,
    ...overrides,
  };
}

describe('shared task lifecycle contract', () => {
  it('allows only declared lifecycle transitions', () => {
    expect(canTransitionTask('queued', 'planning')).toBe(true);
    expect(canTransitionTask('running', 'verifying')).toBe(true);
    expect(canTransitionTask('completed', 'running')).toBe(false);
    expect(canTransitionTask('cancelled', 'ready')).toBe(false);
  });

  it('records start and terminal timestamps while preserving immutable history', () => {
    const running = transitionTask(task({ status: 'ready' }), 'running', 120);
    expect(running.startedAt).toBe(120);
    expect(running.completedAt).toBeNull();

    const completed = transitionTask({ ...running, status: 'verifying' }, 'completed', 180);
    expect(completed.startedAt).toBe(120);
    expect(completed.completedAt).toBe(180);
    expect(() => transitionTask(completed, 'running', 200)).toThrow(/Invalid task transition/);
  });

  it('requires monotonic timestamps and a reason for failures', () => {
    expect(() => transitionTask(task(), 'planning', 99)).toThrow(/monotonic/);
    const failed = transitionTask(task({ status: 'running', startedAt: 110 }), 'failed', 130);
    expect(failed.failure).toBe('Task failed without a recorded reason.');
    expect(failed.completedAt).toBe(130);
  });

  it('returns a stable topological order for valid dependencies', () => {
    expect(validateTaskDependencies([
      { id: 'a', dependencies: [] },
      { id: 'b', dependencies: ['a'] },
      { id: 'c', dependencies: [] },
      { id: 'd', dependencies: ['b', 'c'] },
    ])).toEqual({ valid: true, topologicalOrder: ['a', 'c', 'b', 'd'] });
  });

  it('rejects missing, duplicate, self, and cyclic dependencies', () => {
    expect(validateTaskDependencies([
      { id: 'a', dependencies: ['missing'] },
    ])).toMatchObject({ valid: false });

    expect(validateTaskDependencies([
      { id: 'a', dependencies: ['a'] },
    ])).toMatchObject({ valid: false });

    expect(validateTaskDependencies([
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] },
    ])).toMatchObject({ valid: false, errors: [expect.stringMatching(/cycle/i)] });
  });

  it('resumes only interrupted tasks within their retry budget and not cancelled', () => {
    expect(canResumeTask({ status: 'interrupted', cancelRequested: false, attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(canResumeTask({ status: 'interrupted', cancelRequested: true, attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(canResumeTask({ status: 'interrupted', cancelRequested: false, attempt: 3, maxAttempts: 3 })).toBe(false);
    expect(canResumeTask({ status: 'failed', cancelRequested: false, attempt: 1, maxAttempts: 3 })).toBe(false);
  });
});
