#!/usr/bin/env node
// Headless evaluation launcher — runs the BUILT main process with --eval so a
// real agent attempt is scored by mechanical checks in an isolated workspace.
// Requires `npm run build` first so out/main reflects current sources.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const builtMain = join(root, 'out', 'main', 'index.js');
if (!existsSync(builtMain)) {
  console.error('eval: out/main/index.js missing — run `npm run build` first.');
  process.exit(2);
}

const electronBin =
  process.platform === 'win32'
    ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : join(root, 'node_modules', '.bin', process.platform === 'darwin' ? 'electron' : 'electron');

const args = process.argv.slice(2);
const res = spawnSync(electronBin, ['.', '--eval', ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 1);
