import { spawn, type ChildProcess } from 'node:child_process';

export interface SpawnTimeoutOptions {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  windowsHide?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface SpawnTimeoutResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** Spawn a process and enforce a timeout. On timeout the whole process tree is
 *  killed on Windows to prevent leaking grandchildren (e.g. long-running shell
 *  commands). */
export function spawnWithTimeout(options: SpawnTimeoutOptions): Promise<SpawnTimeoutResult> {
  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let killed = false;
    let stdout = '';
    let stderr = '';
    let finished = false;
    const onAbort = () => {
      killTree();
      finish({ stdout, stderr, exitCode: null, timedOut: true });
    };

    const finish = (result: SpawnTimeoutResult) => {
      if (finished) return;
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const killTree = () => {
      if (!child || killed) return;
      killed = true;
      try {
        if (process.platform === 'win32' && child.pid) {
          // taskkill /T kills the process and all descendants.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).unref();
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        // ignore
      }
    };

    if (options.signal?.aborted) {
      finish({ stdout, stderr, exitCode: null, timedOut: true });
      return;
    }
    if (options.signal) {
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      child = spawn(options.command, options.args, {
        cwd: options.cwd,
        windowsHide: options.windowsHide ?? true,
        env: options.env ?? process.env,
      });
    } catch (error) {
      finish({ stdout: '', stderr: String(error), exitCode: 1, timedOut: false });
      return;
    }

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (error) => {
      finish({ stdout, stderr: error.message, exitCode: 1, timedOut: false });
    });

    child.on('close', (code) => {
      finish({ stdout, stderr, exitCode: code, timedOut: false });
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        killTree();
        finish({ stdout, stderr, exitCode: null, timedOut: true });
      }, options.timeoutMs);
    }
  });
}
