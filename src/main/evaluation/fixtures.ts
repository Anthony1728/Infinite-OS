/**
 * Built-in evaluation fixtures.
 *
 * Each task is a small, realistic workspace problem with an objective finish
 * line. Prompts are deliberately concrete: the point is to measure whether the
 * agent can execute, not whether a judge likes its prose. Every fixture is
 * expected to FAIL on its unmodified seed workspace — the tests prove that.
 */

import type { EvalTask } from './contracts.js';

const DEFAULT_TIMEOUT_MS = 3 * 60_000;

const welcomeNote: EvalTask = {
  id: 'create-welcome-note',
  name: 'Create a welcome note',
  description: 'Create a markdown file with exact headings and list items at a nested path.',
  prompt: [
    'Create the file `notes/welcome.md` (create the `notes` directory if needed).',
    'It must contain exactly this structure:',
    '',
    '# Welcome',
    '',
    'This workspace is ready.',
    '',
    '## Steps',
    '- Setup',
    '- Build',
    '- Test',
    '',
    'Use those exact words and do not add a fourth list item.',
  ].join('\n'),
  seedFiles: [
    {
      path: 'README.md',
      content: '# Sample Workspace\n\nThis directory exists only for the evaluation task.\n',
    },
  ],
  checks: [
    { id: 'welcome-exists', type: 'file_exists', path: 'notes/welcome.md' },
    { id: 'welcome-heading', type: 'file_matches', path: 'notes/welcome.md', pattern: '^# Welcome$' },
    { id: 'welcome-body', type: 'file_contains', path: 'notes/welcome.md', text: 'This workspace is ready.' },
    { id: 'welcome-steps-heading', type: 'file_matches', path: 'notes/welcome.md', pattern: '^## Steps$' },
    { id: 'welcome-setup', type: 'file_contains', path: 'notes/welcome.md', text: '- Setup' },
    { id: 'welcome-build', type: 'file_contains', path: 'notes/welcome.md', text: '- Build' },
    { id: 'welcome-test', type: 'file_contains', path: 'notes/welcome.md', text: '- Test' },
    {
      id: 'welcome-exactly-three',
      type: 'command',
      command: 'node -e "const fs=require(\'fs\');const n=fs.readFileSync(\'notes/welcome.md\',\'utf8\').split(/\\r?\\n/).filter(l=>/^- /.test(l)).length;process.exit(n===3?0:1)"',
      expectExitCode: 0,
      timeoutMs: 10_000,
    },
  ],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTurns: 10,
};

const fixFailingTest: EvalTask = {
  id: 'fix-failing-test',
  name: 'Fix a failing Node test',
  description: 'Repair an implementation so the seeded node:test suite passes without editing the test.',
  prompt: [
    'The file `slug.mjs` has a broken `slugify` implementation. Running `node --test` currently fails.',
    'Fix `slug.mjs` so that all tests pass.',
    'Rules:',
    '- Do not edit `slug.test.mjs`.',
    '- Preserve the exported function name `slugify`.',
    '- Run `node --test` yourself and confirm it passes.',
  ].join('\n'),
  seedFiles: [
    {
      path: 'slug.mjs',
      content: [
        '// BUG: this does not slugify at all.',
        'export function slugify(input) {',
        '  return input.trim();',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'slug.test.mjs',
      content: [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { slugify } from './slug.mjs';",
        '',
        "test('slugifies a sentence', () => {",
        "  assert.equal(slugify('Hello Infinite OS'), 'hello-infinite-os');",
        '});',
        '',
        "test('collapses punctuation and surrounding spaces', () => {",
        "  assert.equal(slugify('  Ship it!  '), 'ship-it');",
        '});',
        '',
        "test('never returns leading or trailing hyphens', () => {",
        "  assert.equal(slugify('---Edge Case---'), 'edge-case');",
        '});',
        '',
      ].join('\n'),
    },
  ],
  checks: [
    { id: 'slug-tests-pass', type: 'command', command: 'node --test', expectExitCode: 0, timeoutMs: 30_000 },
    { id: 'slug-lowercases', type: 'file_contains', path: 'slug.mjs', text: 'toLowerCase' },
    { id: 'slug-bug-removed', type: 'file_not_contains', path: 'slug.mjs', text: 'BUG' },
    { id: 'slug-test-untouched', type: 'file_contains', path: 'slug.test.mjs', text: 'hello-infinite-os' },
    { id: 'slug-export-kept', type: 'file_contains', path: 'slug.mjs', text: 'export function slugify' },
  ],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTurns: 12,
};

const updatePackageConfig: EvalTask = {
  id: 'update-package-config',
  name: 'Update package configuration',
  description: 'Edit a JSON config precisely and verify the new npm script actually runs.',
  prompt: [
    'Update `package.json` in this workspace:',
    '- Set `"version"` to `"1.2.0"`.',
    '- Keep the package name `sample-app`.',
    '- Add a script named `lint` with the value `node scripts/lint.mjs`.',
    '- Keep the existing `test` script unchanged.',
    'Then run `npm run lint --silent` and confirm it succeeds.',
  ].join('\n'),
  seedFiles: [
    {
      path: 'package.json',
      content: JSON.stringify(
        {
          name: 'sample-app',
          version: '1.0.0',
          private: true,
          scripts: { test: 'node --test' },
        },
        null,
        2,
      ) + '\n',
    },
    {
      path: 'scripts/lint.mjs',
      content: "console.log('lint ok');\n",
    },
  ],
  checks: [
    { id: 'package-name', type: 'json_path_equals', path: 'package.json', jsonPath: 'name', equals: 'sample-app' },
    { id: 'package-version', type: 'json_path_equals', path: 'package.json', jsonPath: 'version', equals: '1.2.0' },
    { id: 'package-lint-script', type: 'json_path_equals', path: 'package.json', jsonPath: 'scripts.lint', equals: 'node scripts/lint.mjs' },
    { id: 'package-test-script', type: 'json_path_equals', path: 'package.json', jsonPath: 'scripts.test', equals: 'node --test' },
    { id: 'lint-runs', type: 'command', command: 'npm run lint --silent', expectExitCode: 0, stdoutContains: 'lint ok', timeoutMs: 30_000 },
  ],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTurns: 10,
};

const diagnoseConfig: EvalTask = {
  id: 'diagnose-broken-config',
  name: 'Diagnose a broken configuration',
  description: 'Run a failing checker, repair the config it validates, and write down the diagnosis.',
  prompt: [
    'Running `node check.mjs` currently fails because `config.json` is wrong.',
    '1. Run the checker and read its error.',
    '2. Fix only `config.json` so the checker passes.',
    '3. Do not edit `check.mjs`.',
    '4. Write `FINDINGS.md` containing the corrected port number and the exact command you ran.',
  ].join('\n'),
  seedFiles: [
    {
      path: 'check.mjs',
      content: [
        "import { readFileSync } from 'node:fs';",
        "import assert from 'node:assert/strict';",
        '',
        "const config = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'));",
        "assert.equal(config.port, 8000, 'config port must be 8000');",
        "assert.equal(config.host, '127.0.0.1', 'config host must be loopback');",
        "console.log('config ok');",
        '',
      ].join('\n'),
    },
    {
      path: 'config.json',
      content: JSON.stringify({ host: '127.0.0.1', port: 3000 }, null, 2) + '\n',
    },
  ],
  checks: [
    { id: 'config-check-passes', type: 'command', command: 'node check.mjs', expectExitCode: 0, stdoutContains: 'config ok', timeoutMs: 20_000 },
    { id: 'config-port-fixed', type: 'json_path_equals', path: 'config.json', jsonPath: 'port', equals: 8000 },
    { id: 'config-host-kept', type: 'json_path_equals', path: 'config.json', jsonPath: 'host', equals: '127.0.0.1' },
    { id: 'checker-untouched', type: 'file_contains', path: 'check.mjs', text: 'config port must be 8000' },
    { id: 'findings-port', type: 'file_contains', path: 'FINDINGS.md', text: '8000' },
    { id: 'findings-command', type: 'file_contains', path: 'FINDINGS.md', text: 'node check.mjs', caseSensitive: false },
  ],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTurns: 12,
};

const refactorRename: EvalTask = {
  id: 'refactor-rename-export',
  name: 'Rename an export across files',
  description: 'Rename an exported function and every reference, keeping behavior and tests intact.',
  prompt: [
    'Rename the exported function `formatPrice` to `formatCurrency` across this workspace.',
    '- Update `format.mjs`, `index.mjs`, and `format.test.mjs` so nothing references `formatPrice`.',
    '- Keep behavior identical and keep the assertions in `format.test.mjs` intact.',
    '- Run `node --test` and confirm it passes.',
  ].join('\n'),
  seedFiles: [
    {
      path: 'format.mjs',
      content: [
        'export function formatPrice(cents) {',
        '  return `$${(cents / 100).toFixed(2)}`;',
        '}',
        '',
        'export function formatDate(date) {',
        "  return new Date(date).toISOString().slice(0, 10);",
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'index.mjs',
      content: "export { formatPrice as price, formatDate as date } from './format.mjs';\n",
    },
    {
      path: 'format.test.mjs',
      content: [
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import { formatPrice, formatDate } from './format.mjs';",
        '',
        "test('formats cents as dollars', () => {",
        '  assert.equal(formatPrice(1234), "$12.34");',
        '});',
        '',
        "test('formats ISO dates', () => {",
        "  assert.equal(formatDate('2026-01-02T03:04:05.000Z'), '2026-01-02');",
        '});',
        '',
      ].join('\n'),
    },
  ],
  checks: [
    { id: 'rename-tests-pass', type: 'command', command: 'node --test', expectExitCode: 0, timeoutMs: 30_000 },
    { id: 'rename-format-export', type: 'file_contains', path: 'format.mjs', text: 'export function formatCurrency' },
    { id: 'rename-format-old-gone', type: 'file_not_contains', path: 'format.mjs', text: 'formatPrice' },
    { id: 'rename-index-updated', type: 'file_contains', path: 'index.mjs', text: 'formatCurrency' },
    { id: 'rename-index-old-gone', type: 'file_not_contains', path: 'index.mjs', text: 'formatPrice' },
    { id: 'rename-test-updated', type: 'file_contains', path: 'format.test.mjs', text: 'formatCurrency' },
    { id: 'rename-test-old-gone', type: 'file_not_contains', path: 'format.test.mjs', text: 'formatPrice' },
    { id: 'rename-assertions-kept', type: 'file_contains', path: 'format.test.mjs', text: 'assert.equal(formatCurrency(1234), "$12.34")' },
  ],
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxTurns: 14,
};

export interface EvalSuite {
  id: string;
  name: string;
  tasks: EvalTask[];
}

export const CORE_EVAL_SUITE_ID = 'core';

export const evalFixtures: EvalTask[] = [
  welcomeNote,
  fixFailingTest,
  updatePackageConfig,
  diagnoseConfig,
  refactorRename,
];

export const evalSuites: EvalSuite[] = [
  {
    id: CORE_EVAL_SUITE_ID,
    name: 'Core task completion',
    tasks: evalFixtures,
  },
];

export function getEvalSuite(id = CORE_EVAL_SUITE_ID): EvalSuite | null {
  return evalSuites.find((suite) => suite.id === id) ?? null;
}

export function listEvalSuites(): Array<{ id: string; name: string; tasks: number }> {
  return evalSuites.map((suite) => ({ id: suite.id, name: suite.name, tasks: suite.tasks.length }));
}

/**
 * Structural validation used by tests and the CLI before any agent runs.
 * Catches the failure modes that would make a suite score itself: duplicate
 * ids, empty checks, escapes, and checks that could never pass.
 */
export function validateEvalSuite(suite: EvalSuite): string[] {
  const problems: string[] = [];
  const taskIds = new Set<string>();
  for (const task of suite.tasks) {
    if (!task.id) problems.push('A task has an empty id.');
    if (taskIds.has(task.id)) problems.push(`Duplicate task id: ${task.id}`);
    taskIds.add(task.id);
    if (!task.prompt.trim()) problems.push(`${task.id}: empty prompt.`);
    if (task.checks.length === 0) problems.push(`${task.id}: no checks.`);
    if (task.seedFiles.length === 0) problems.push(`${task.id}: no seed files (task may be too synthetic).`);
    const checkIds = new Set<string>();
    for (const check of task.checks) {
      if (!check.id) problems.push(`${task.id}: a check has an empty id.`);
      if (checkIds.has(check.id)) problems.push(`${task.id}: duplicate check id ${check.id}`);
      checkIds.add(check.id);
      if ('path' in check) {
        if (!check.path || check.path.startsWith('/') || check.path.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(check.path)) {
          problems.push(`${task.id}/${check.id}: unsafe path ${check.path}`);
        }
      }
    }
    for (const seed of task.seedFiles) {
      if (!seed.path || seed.path.startsWith('/') || seed.path.startsWith('\\') || /(^|[\\/])\.\.([\\/]|$)/.test(seed.path)) {
        problems.push(`${task.id}: unsafe seed path ${seed.path}`);
      }
    }
  }
  return problems;
}
