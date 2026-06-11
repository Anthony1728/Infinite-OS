#!/usr/bin/env node
// Dev launcher — spawns Vite for renderer + electron main, with HMR.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const procs = [];

function run(name, cmd, args, env = {}) {
  const p = spawn(cmd, args, {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env, ...env },
    shell: isWin,
  });
  p.on('exit', (code) => {
    console.log(`[${name}] exited ${code}`);
    procs.filter((x) => x !== p).forEach((x) => x.kill());
    process.exit(code ?? 0);
  });
  procs.push(p);
}

run('vite',     npmCmd, ['exec', '--', 'vite'],                    { ELECTRON_RENDERER_URL: 'http://localhost:5173' });
run('electron', npmCmd, ['exec', '--', 'electron-vite', 'preview'], {});

process.on('SIGINT',  () => { procs.forEach((p) => p.kill()); process.exit(0); });
process.on('SIGTERM', () => { procs.forEach((p) => p.kill()); process.exit(0); });
