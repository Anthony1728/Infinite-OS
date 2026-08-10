import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CheckpointManager, type CheckpointCreateOptions, type TaskState } from './manager.js';

function makeState(overrides: Partial<TaskState> = {}): TaskState {
  return {
    status: 'running',
    progress: 10,
    currentStep: 1,
    totalSteps: 5,
    cwd: '/work/project',
    history: [{ role: 'user', content: 'do the thing', timestamp: Date.now() }],
    variables: { branch: 'main' },
    ...overrides,
  };
}

function baseOptions(overrides: Partial<CheckpointCreateOptions> = {}): CheckpointCreateOptions {
  return {
    taskId: 'task-1',
    name: 'step-1',
    state: makeState(),
    ...overrides,
  };
}

describe('CheckpointManager', () => {
  let dir: string;
  let manager: CheckpointManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'infinite-checkpoint-'));
    manager = new CheckpointManager(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a checkpoint with an id and timestamp', () => {
    const cp = manager.create(baseOptions());
    expect(cp.id).toBeTruthy();
    expect(cp.taskId).toBe('task-1');
    expect(cp.timestamp).toBeGreaterThan(0);
    expect(cp.state.status).toBe('running');
  });

  it('lists checkpoints for a task newest-first', () => {
    manager.create(baseOptions({ name: 'a' }));
    manager.create(baseOptions({ name: 'b' }));
    const list = manager.list('task-1');
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('b');
  });

  it('limits list results when a limit is provided', () => {
    for (let i = 0; i < 5; i++) manager.create(baseOptions({ name: `c${i}` }));
    expect(manager.list('task-1', 3)).toHaveLength(3);
  });

  it('gets a checkpoint by id', () => {
    const cp = manager.create(baseOptions());
    const found = manager.get(cp.id);
    expect(found?.id).toBe(cp.id);
    expect(manager.get('missing')).toBeNull();
  });

  it('persists checkpoints to disk and reloads them', () => {
    manager.create(baseOptions({ name: 'persisted' }));
    const reloaded = new CheckpointManager(dir);
    expect(reloaded.list('task-1')).toHaveLength(1);
    expect(reloaded.list('task-1')[0].name).toBe('persisted');
  });

  it('deletes a single checkpoint', () => {
    const cp = manager.create(baseOptions());
    expect(manager.delete(cp.id)).toBe(true);
    expect(manager.get(cp.id)).toBeNull();
    expect(manager.delete('missing')).toBe(false);
  });

  it('diffs two checkpoints and reports state changes', () => {
    const a = manager.create(baseOptions({ name: 'a', state: makeState({ progress: 10 }) }));
    const b = manager.create(baseOptions({ name: 'b', state: makeState({ progress: 80 }) }));
    const result = manager.diff(a.id, b.id);
    expect(result).not.toBeNull();
    expect(result?.differences.some((d) => d.includes('Progress: 10% → 80%'))).toBe(true);
  });

  it('diffs detect variable and history changes', () => {
    const a = manager.create(baseOptions({ name: 'a', state: makeState({ variables: { x: 1 }, history: [] }) }));
    const b = manager.create(baseOptions({ name: 'b', state: makeState({ variables: { x: 2 }, history: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }) }));
    const result = manager.diff(a.id, b.id);
    expect(result?.differences.some((d) => d.includes('Variable "x" changed'))).toBe(true);
    expect(result?.differences.some((d) => d.includes('History:'))).toBe(true);
  });

  it('returns null diff for missing checkpoints', () => {
    expect(manager.diff('a', 'b')).toBeNull();
  });

  it('rolls back modified files to their original content', () => {
    const state = makeState({
      modifiedFiles: [
        { path: join(dir, 'edited.txt'), originalContent: 'original', newContent: 'changed', operation: 'modify' },
      ],
    });
    const cp = manager.create(baseOptions({ state }));
    const result = manager.rollback(cp.id);
    expect(result.success).toBe(true);
    expect(result.rollbackActions?.some((a) => a.includes('Reverted file'))).toBe(true);
  });

  it('rolls back created files by deleting them', () => {
    const state = makeState({
      modifiedFiles: [{ path: join(dir, 'new.txt'), newContent: 'x', operation: 'create' }],
    });
    const cp = manager.create(baseOptions({ state }));
    const result = manager.rollback(cp.id);
    expect(result.success).toBe(true);
    expect(result.rollbackActions?.some((a) => a.includes('Removed created file'))).toBe(true);
  });

  it('reports stats across tasks', () => {
    manager.create(baseOptions({ taskId: 't1' }));
    manager.create(baseOptions({ taskId: 't1' }));
    manager.create(baseOptions({ taskId: 't2' }));
    const stats = manager.getStats();
    expect(stats.totalCheckpoints).toBe(3);
    expect(stats.tasksWithCheckpoints).toBe(2);
    expect(stats.oldestCheckpoint).not.toBeNull();
    expect(stats.newestCheckpoint).not.toBeNull();
  });
});
