#!/usr/bin/env node
/* eslint-env node */

import { closeSync, existsSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lockName = `infinite-os-${createHash('sha1').update(root).digest('hex').slice(0, 12)}.lock`;
const lockPath = join(tmpdir(), lockName);
let ownsLock = false;

function acquireLaunchLock() {
  try {
    const handle = openSync(lockPath, 'wx');
    writeSync(handle, String(process.pid));
    closeSync(handle);
    ownsLock = true;
    return true;
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const pid = Number.parseInt(readFileSync(lockPath, 'utf8'), 10);
    if (Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        // The previous launcher stopped without releasing its lock.
      }
    }
    unlinkSync(lockPath);
    const handle = openSync(lockPath, 'wx');
    writeSync(handle, String(process.pid));
    closeSync(handle);
    ownsLock = true;
    return true;
  }
}

function writeLockOwner() {
  process.stdout.write('Preparing Infinite OS…\n');
}

function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const entry = statSync(path);
  if (!entry.isDirectory()) return entry.mtimeMs;
  return readdirSync(path, { withFileTypes: true }).reduce(
    (latest, child) => Math.max(latest, newestMtime(join(path, child.name))),
    entry.mtimeMs,
  );
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: false,
      shell: options.shell ?? false,
    });
    child.once('error', rejectPromise);
    child.once('exit', (code) => resolvePromise(code ?? 1));
  });
}

async function main() {
  if (!acquireLaunchLock()) return;
  writeLockOwner();

  const outputs = [
    join(root, 'out', 'main', 'index.js'),
    join(root, 'out', 'preload', 'index.mjs'),
    join(root, 'out', 'renderer', 'index.html'),
  ];
  const sourceMtime = Math.max(
    newestMtime(join(root, 'src')),
    newestMtime(join(root, 'electron.vite.config.ts')),
    newestMtime(join(root, 'package.json')),
  );
  const outputMtime = outputs.every(existsSync) ? Math.min(...outputs.map((output) => statSync(output).mtimeMs)) : 0;

  if (!outputMtime || sourceMtime > outputMtime) {
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const buildCode = existsSync(npmCli)
      ? await run(process.execPath, [npmCli, 'run', 'build'])
      : await run('npm', ['run', 'build']);
    if (buildCode !== 0 || !outputs.every(existsSync)) {
      throw new Error('Infinite OS could not build a complete application bundle.');
    }
  }

  const electron = process.platform === 'win32'
    ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : join(root, 'node_modules', '.bin', 'electron');
  if (!existsSync(electron)) throw new Error('Electron is not installed. Run npm install first.');
  if (process.argv.includes('--check')) {
    process.stdout.write('Infinite OS launch bundle is ready.\n');
    return;
  }

  const exitCode = await run(electron, [outputs[0]]);
  process.exitCode = exitCode;
}

main()
  .catch((error) => {
    console.error(`Infinite OS launch failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (ownsLock && existsSync(lockPath)) unlinkSync(lockPath);
  });
