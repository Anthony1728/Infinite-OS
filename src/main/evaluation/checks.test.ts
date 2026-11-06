import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EvalPathError,
  parseJsonPath,
  readJsonPath,
  resolveInsideWorkspace,
  runChecks,
} from './checks.js';
import type { EvalCheck } from './contracts.js';

let workspace = '';

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'infinite-eval-checks-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const target = join(workspace, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

describe('evaluation path containment', () => {
  it('allows nested relative paths', () => {
    expect(resolveInsideWorkspace(workspace, 'notes/welcome.md')).toBe(join(workspace, 'notes', 'welcome.md'));
  });

  it('rejects absolute paths and parent escapes', () => {
    expect(() => resolveInsideWorkspace(workspace, 'C:\\Windows\\system.ini')).toThrow(EvalPathError);
    expect(() => resolveInsideWorkspace(workspace, '/etc/passwd')).toThrow(EvalPathError);
    expect(() => resolveInsideWorkspace(workspace, '../outside.txt')).toThrow(EvalPathError);
    expect(() => resolveInsideWorkspace(workspace, 'a/../../outside.txt')).toThrow(EvalPathError);
    expect(() => resolveInsideWorkspace(workspace, '..\\outside.txt')).toThrow(EvalPathError);
    expect(() => resolveInsideWorkspace(workspace, '')).toThrow(EvalPathError);
  });
});

describe('JSON path lookup', () => {
  it('parses dotted, indexed, and quoted segments', () => {
    expect(parseJsonPath('scripts.lint')).toEqual(['scripts', 'lint']);
    expect(parseJsonPath('items[0].name')).toEqual(['items', 0, 'name']);
    expect(parseJsonPath('$["a.b"]["c d"]')).toEqual(['a.b', 'c d']);
  });

  it('reads nested values without treating missing values as undefined hits', () => {
    const value = { scripts: { lint: 'node lint.mjs' }, items: [{ name: 'first' }] };
    expect(readJsonPath(value, 'scripts.lint')).toEqual({ found: true, value: 'node lint.mjs' });
    expect(readJsonPath(value, 'items[0].name')).toEqual({ found: true, value: 'first' });
    expect(readJsonPath(value, 'scripts.missing')).toEqual({ found: false });
    expect(readJsonPath(value, 'items[4]')).toEqual({ found: false });
    expect(readJsonPath(null, 'a')).toEqual({ found: false });
  });
});

describe('mechanical checks', () => {
  it('verifies files, content, regexes, and JSON values', async () => {
    write('notes/welcome.md', '# Welcome\n\nThis workspace is ready.\n');
    write('config.json', JSON.stringify({ host: '127.0.0.1', port: 8000, tags: ['a', 'b'] }));
    write('keep.txt', 'untouched');

    const checks: EvalCheck[] = [
      { id: 'exists', type: 'file_exists', path: 'notes/welcome.md' },
      { id: 'absent', type: 'file_absent', path: 'notes/missing.md' },
      { id: 'contains', type: 'file_contains', path: 'notes/welcome.md', text: 'workspace is ready' },
      { id: 'case-insensitive', type: 'file_contains', path: 'notes/welcome.md', text: 'WELCOME', caseSensitive: false },
      { id: 'not-contains', type: 'file_not_contains', path: 'notes/welcome.md', text: 'not there' },
      { id: 'matches', type: 'file_matches', path: 'notes/welcome.md', pattern: '^# Welcome$' },
      { id: 'json', type: 'json_path_equals', path: 'config.json', jsonPath: 'port', equals: 8000 },
      { id: 'json-nested', type: 'json_path_equals', path: 'config.json', jsonPath: 'tags[1]', equals: 'b' },
    ];

    const results = await runChecks(checks, workspace);
    expect(results.filter((result) => !result.ok)).toEqual([]);
  });

  it('reports honest failures instead of throwing', async () => {
    write('present.txt', 'alpha');
    const checks: EvalCheck[] = [
      { id: 'missing-file', type: 'file_exists', path: 'missing.txt' },
      { id: 'wrong-content', type: 'file_contains', path: 'present.txt', text: 'beta' },
      { id: 'surprise-content', type: 'file_not_contains', path: 'present.txt', text: 'alpha' },
      { id: 'wrong-json', type: 'json_path_equals', path: 'present.txt', jsonPath: 'a', equals: 1 },
      { id: 'escape', type: 'file_exists', path: '../outside.txt' },
      { id: 'bad-regex', type: 'file_matches', path: 'present.txt', pattern: '[' },
    ];

    const results = await runChecks(checks, workspace);
    expect(results).toHaveLength(checks.length);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results.find((result) => result.checkId === 'escape')?.detail).toContain('escapes the evaluation workspace');
  });

  it('runs real commands with exit-code and stdout assertions', async () => {
    write('ping.mjs', "console.log('pong');\n");
    const checks: EvalCheck[] = [
      { id: 'command-ok', type: 'command', command: 'node ping.mjs', expectExitCode: 0, stdoutContains: 'pong' },
      { id: 'command-fails', type: 'command', command: 'node missing-file.mjs', expectExitCode: 0 },
      { id: 'stdout-missing', type: 'command', command: 'node ping.mjs', stdoutContains: 'nope' },
    ];
    const results = await runChecks(checks, workspace);
    expect(results[0].ok).toBe(true);
    expect(results[1].ok).toBe(false);
    expect(results[1].detail).toContain('exited 1');
    expect(results[2].ok).toBe(false);
  });

  it('enforces a hard command timeout', async () => {
    const results = await runChecks([
      {
        id: 'slow',
        type: 'command',
        command: 'node -e "setTimeout(() => {}, 10000)"',
        timeoutMs: 1_000,
      },
    ], workspace);
    expect(results[0].ok).toBe(false);
    expect(results[0].detail).toContain('timed out');
    expect(results[0].durationMs).toBeLessThan(8_000);
  }, 15_000);
});
