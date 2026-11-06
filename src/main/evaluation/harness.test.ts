import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvalRunner, EvalTask } from './contracts.js';
import { evalFixtures } from './fixtures.js';
import {
  getEvaluationReport,
  listEvaluationReports,
  runEvaluation,
} from './harness.js';

let dataDir = '';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'infinite-eval-harness-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function fixture(id: string): EvalTask {
  const task = evalFixtures.find((entry) => entry.id === id);
  if (!task) throw new Error(`Missing fixture ${id}`);
  return task;
}

const welcomeContent = [
  '# Welcome',
  '',
  'This workspace is ready.',
  '',
  '## Steps',
  '- Setup',
  '- Build',
  '- Test',
  '',
].join('\n');

const fixedSlug = [
  'export function slugify(input) {',
  "  return input.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');",
  '}',
  '',
].join('\n');

const fixedFormat = [
  'export function formatCurrency(cents) {',
  '  return `$${(cents / 100).toFixed(2)}`;',
  '}',
  '',
  'export function formatDate(date) {',
  "  return new Date(date).toISOString().slice(0, 10);",
  '}',
  '',
].join('\n');

const fixedFormatIndex = "export { formatCurrency as price, formatDate as date } from './format.mjs';\n";

const fixedFormatTest = [
  "import test from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { formatCurrency, formatDate } from './format.mjs';",
  '',
  "test('formats cents as dollars', () => {",
  '  assert.equal(formatCurrency(1234), "$12.34");',
  '});',
  '',
  "test('formats ISO dates', () => {",
  "  assert.equal(formatDate('2026-01-02T03:04:05.000Z'), '2026-01-02');",
  '});',
  '',
].join('\n');

const solutions: Record<string, (workspace: string) => void> = {
  'create-welcome-note': (workspace) => {
    writeFile(join(workspace, 'notes', 'welcome.md'), welcomeContent);
  },
  'fix-failing-test': (workspace) => {
    writeFile(join(workspace, 'slug.mjs'), fixedSlug);
  },
  'update-package-config': (workspace) => {
    writeFile(
      join(workspace, 'package.json'),
      JSON.stringify(
        {
          name: 'sample-app',
          version: '1.2.0',
          private: true,
          scripts: { test: 'node --test', lint: 'node scripts/lint.mjs' },
        },
        null,
        2,
      ) + '\n',
    );
  },
  'diagnose-broken-config': (workspace) => {
    writeFile(join(workspace, 'config.json'), JSON.stringify({ host: '127.0.0.1', port: 8000 }, null, 2) + '\n');
    writeFile(
      join(workspace, 'FINDINGS.md'),
      '# Findings\n\nThe config port was corrected to 8000.\n\nCommand run: `node check.mjs`\n',
    );
  },
  'refactor-rename-export': (workspace) => {
    writeFile(join(workspace, 'format.mjs'), fixedFormat);
    writeFile(join(workspace, 'index.mjs'), fixedFormatIndex);
    writeFile(join(workspace, 'format.test.mjs'), fixedFormatTest);
  },
};

const solutionRunner: EvalRunner = async (task, context) => {
  const apply = solutions[task.id];
  if (!apply) return { success: false, output: '', error: `No solution for ${task.id}` };
  apply(context.workspace);
  return { success: true, output: `solved ${task.id}` };
};

describe('evaluation harness', () => {
  it('passes a task only when mechanical checks prove the work', async () => {
    const task = fixture('create-welcome-note');
    const report = await runEvaluation({
      tasks: [task],
      suiteId: 'test',
      provider: 'fake',
      model: 'fake',
      runner: solutionRunner,
      dataDir,
    });

    expect(report.overall).toBe('passed');
    expect(report.counts).toMatchObject({ passed: 1, failed: 0, errored: 0 });
    const result = report.tasks[0];
    expect(result.status).toBe('passed');
    expect(result.runnerSuccess).toBe(true);
    expect(result.checks.every((check) => check.ok)).toBe(true);
    expect(existsSync(join(result.workspace, 'README.md'))).toBe(true);
    expect(readFileSync(join(result.workspace, 'notes', 'welcome.md'), 'utf8')).toContain('# Welcome');

    const persisted = getEvaluationReport(report.id, dataDir);
    expect(persisted?.overall).toBe('passed');
    expect(listEvaluationReports({ dataDir }).map((entry) => entry.id)).toEqual([report.id]);
  });

  it('fails a task when the runner claims success but changes nothing', async () => {
    const report = await runEvaluation({
      tasks: [fixture('fix-failing-test')],
      suiteId: 'test',
      provider: 'fake',
      model: 'fake',
      runner: async () => ({ success: true, output: 'All tests pass! Trust me.' }),
      dataDir,
    });

    expect(report.overall).toBe('failed');
    const result = report.tasks[0];
    expect(result.status).toBe('failed');
    expect(result.runnerSuccess).toBe(true);
    expect(result.checks.some((check) => !check.ok)).toBe(true);
    expect(result.checks.find((check) => check.checkId === 'slug-bug-removed')?.ok).toBe(false);
  });

  it('keeps each task in its own seeded workspace', async () => {
    const mkTask = (id: string, content: string): EvalTask => ({
      id,
      name: id,
      description: 'isolation check',
      prompt: 'read the state file',
      seedFiles: [{ path: 'state.txt', content }],
      checks: [{ id: 'observed', type: 'file_contains', path: `observed-${id}.txt`, text: content }],
      timeoutMs: 10_000,
    });
    const tasks = [mkTask('task-one', 'first state'), mkTask('task-two', 'second state')];

    const report = await runEvaluation({
      tasks,
      suiteId: 'test',
      provider: 'fake',
      model: 'fake',
      dataDir,
      runner: async (task, context) => {
        const state = readFileSync(join(context.workspace, 'state.txt'), 'utf8');
        writeFileSync(join(context.workspace, `observed-${task.id}.txt`), state, 'utf8');
        return { success: true, output: state };
      },
    });

    expect(report.overall).toBe('passed');
    expect(report.tasks[0].workspace).not.toBe(report.tasks[1].workspace);
    expect(readFileSync(join(report.tasks[0].workspace, 'state.txt'), 'utf8')).toBe('first state');
    expect(readFileSync(join(report.tasks[1].workspace, 'state.txt'), 'utf8')).toBe('second state');
  });

  it('times out a hung runner and never marks the task passed', async () => {
    const report = await runEvaluation({
      tasks: [{
        id: 'hang',
        name: 'hang',
        description: 'hung runner',
        prompt: 'never finishes',
        seedFiles: [{ path: 'seed.txt', content: 'x' }],
        checks: [{ id: 'seed', type: 'file_exists', path: 'seed.txt' }],
        timeoutMs: 50,
      }],
      suiteId: 'test',
      provider: 'fake',
      model: 'fake',
      runner: () => new Promise(() => {}),
      dataDir,
    });

    expect(report.overall).toBe('failed');
    expect(report.tasks[0].status).toBe('error');
    expect(report.tasks[0].runnerError).toContain('Timed out');
  }, 10_000);

  it('marks remaining tasks skipped after the caller aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = vi.fn(async () => ({ success: true, output: 'should not run' }));
    const report = await runEvaluation({
      tasks: [fixture('create-welcome-note'), fixture('fix-failing-test')],
      suiteId: 'test',
      provider: 'fake',
      model: 'fake',
      runner,
      dataDir,
      signal: controller.signal,
    });

    expect(runner).not.toHaveBeenCalled();
    expect(report.tasks.map((task) => task.status)).toEqual(['skipped', 'skipped']);
    expect(report.overall).toBe('failed');
  });

  it('refuses seed files that escape the task workspace', async () => {
    const report = await runEvaluation({
      tasks: [{
        id: 'escape',
        name: 'escape',
        description: 'bad seed',
        prompt: 'x',
        seedFiles: [{ path: '../escape.txt', content: 'bad' }],
        checks: [{ id: 'c', type: 'file_exists', path: 'escape.txt' }],
      }],
      suiteId: 'test',
      provider: 'fake',
      model: 'fake',
      runner: solutionRunner,
      dataDir,
    });

    expect(report.tasks[0].status).toBe('error');
    expect(report.tasks[0].runnerError).toContain('escapes the evaluation workspace');
    expect(existsSync(join(dataDir, 'escape.txt'))).toBe(false);
  });

  it('passes every built-in fixture when its objective solution is applied', async () => {
    const report = await runEvaluation({
      tasks: evalFixtures,
      suiteId: 'core',
      provider: 'fake',
      model: 'fake',
      runner: solutionRunner,
      dataDir,
    });

    const failures = report.tasks
      .filter((task) => task.status !== 'passed')
      .map((task) => `${task.taskId}: ${task.checks.filter((check) => !check.ok).map((check) => check.checkId).join(', ') || task.runnerError}`);
    expect(failures).toEqual([]);
    expect(report.overall).toBe('passed');
    expect(report.counts.passed).toBe(evalFixtures.length);
  }, 60_000);
});
