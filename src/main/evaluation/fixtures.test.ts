import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runChecks } from './checks.js';
import type { EvalTask } from './contracts.js';
import {
  CORE_EVAL_SUITE_ID,
  evalFixtures,
  getEvalSuite,
  listEvalSuites,
  validateEvalSuite,
} from './fixtures.js';

const materialized: string[] = [];

afterEach(() => {
  for (const directory of materialized.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function materialize(task: EvalTask): string {
  const directory = mkdtempSync(join(tmpdir(), `infinite-fixture-${task.id}-`));
  materialized.push(directory);
  for (const file of task.seedFiles) {
    const target = join(directory, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, 'utf8');
  }
  return directory;
}

describe('evaluation fixtures', () => {
  it('exposes one structurally valid core suite', () => {
    expect(listEvalSuites()).toEqual([{ id: CORE_EVAL_SUITE_ID, name: 'Core task completion', tasks: evalFixtures.length }]);
    const suite = getEvalSuite('core');
    expect(suite).not.toBeNull();
    expect(validateEvalSuite(suite!)).toEqual([]);
    expect(new Set(evalFixtures.map((task) => task.id)).size).toBe(evalFixtures.length);
  });

  it('detects duplicate ids, missing checks, and unsafe seed paths', () => {
    const broken = {
      id: 'broken',
      name: 'Broken',
      tasks: [
        {
          id: 'same',
          name: 'A',
          description: '',
          prompt: '',
          seedFiles: [{ path: '../escape.txt', content: 'x' }],
          checks: [{ id: 'c', type: 'file_exists' as const, path: '/etc/passwd' }],
        },
        {
          id: 'same',
          name: 'B',
          description: '',
          prompt: 'do something',
          seedFiles: [{ path: 'ok.txt', content: 'x' }],
          checks: [],
        },
      ],
    };
    const problems = validateEvalSuite(broken);
    expect(problems.some((problem) => problem.includes('Duplicate task id'))).toBe(true);
    expect(problems.some((problem) => problem.includes('no checks'))).toBe(true);
    expect(problems.some((problem) => problem.includes('unsafe seed path'))).toBe(true);
    expect(problems.some((problem) => problem.includes('unsafe path'))).toBe(true);
  });

  it('fails on the unmodified seed workspace for every task', async () => {
    for (const task of evalFixtures) {
      const workspace = materialize(task);
      const results = await runChecks(task.checks, workspace);
      const failed = results.filter((result) => !result.ok);
      expect(failed.length, `${task.id} has no failing checks before the agent works`).toBeGreaterThan(0);
    }
  }, 30_000);
});
