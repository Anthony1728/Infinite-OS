#!/usr/bin/env node
// Dev launcher — uses electron-vite dev for renderer HMR + electron with hot reload.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const p = isWin
  // No shell:true (DEP0190): run npm through cmd /c with a static argv.
  ? spawn('cmd', ['/c', 'npm', 'exec', '--', 'electron-vite', 'dev'], {
      stdio: 'inherit',
      cwd: root,
      env: process.env,
    })
  : spawn(npmCmd, ['exec', '--', 'electron-vite', 'dev'], {
      stdio: 'inherit',
      cwd: root,
      env: process.env,
    });

p.on('exit', (code) => {
  console.log(`[electron-vite] exited ${code}`);
  process.exit(code ?? 0);
});

process.on('SIGINT',  () => { p.kill(); process.exit(0); });
process.on('SIGTERM', () => { p.kill(); process.exit(0); });
