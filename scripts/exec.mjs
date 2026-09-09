#!/usr/bin/env node
// Headless exec launcher — runs the BUILT main process with --exec so one
// agent turn completes headless (scripts/CI). Requires `npm run build` first
// so out/main reflects current sources.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const builtMain = join(root, 'out', 'main', 'index.js');
if (!existsSync(builtMain)) {
  console.error('exec: out/main/index.js missing — run `npm run build` first.');
  process.exit(2);
}

const electronBin =
  process.platform === 'win32'
    ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : join(root, 'node_modules', '.bin', process.platform === 'darwin' ? 'electron' : 'electron');

const args = process.argv.slice(2);
const res = spawnSync(electronBin, ['.', '--exec', ...args], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(res.status ?? 1);
