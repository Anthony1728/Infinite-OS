/**
 * Persistent JSON-line worker processes — shared base for local neural
 * engines (Kokoro TTS, faster-whisper STT).
 *
 * Spawning Python per request pays a multi-second model load every time
 * (measured ~6s Kokoro, ~2-4s Whisper on an i5-4210U), which destroys
 * speak-as-it-streams and snappy transcription. Instead each engine keeps
 * ONE long-lived child: JSON requests on stdin, JSON responses on stdout,
 * correlated by id. The session serializes requests FIFO, restarts lazily
 * after unexpected exits, and trips a circuit breaker after consecutive
 * startup failures so a broken install fails fast into the next provider
 * instead of burning a model-load per call.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface WorkerResponse {
  ready?: boolean;
  id?: number;
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface WorkerSessionOptions {
  /** Startup ceiling (model load). Default 90s — slow disks exist. */
  readyTimeoutMs?: number;
  /** Per-request ceiling. Default 120s — slow CPUs on long inputs. */
  requestTimeoutMs?: number;
  /** Consecutive startup failures before refusing fast. Default 2. */
  maxStartFailures?: number;
}

export type WorkerSpawnFn = (
  cmd: string,
  args: string[],
  opts: Record<string, unknown>,
) => ChildProcessWithoutNullStreams;

/**
 * One managed worker process. Subclasses add typed request helpers on top
 * of `protected request()`; construction takes the script + argv (assets
 * already resolved by the caller).
 */
export class JsonLineWorkerSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private pending = new Map<number, { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private nextId = 1;
  private ready: Promise<void> | null = null;
  private startFailures = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly readyTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxStartFailures: number;

  constructor(
    protected readonly script: string,
    protected readonly argv: string[],
    private readonly spawnImpl: WorkerSpawnFn = (cmd, args, opts) =>
      spawn(cmd, args, opts as never) as ChildProcessWithoutNullStreams,
    opts: WorkerSessionOptions = {},
  ) {
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 90_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
    this.maxStartFailures = opts.maxStartFailures ?? 2;
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** Start the worker (model load) without doing work — pre-warm hook. */
  warmup(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Worker is shut down.'));
    return this.ensureReady();
  }

  /** Run fn after all previously enqueued work — keeps speech in order. */
  protected enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    // A rejection must not poison the FIFO for later requests.
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** One id-correlated round trip (starts the worker on first use). */
  protected async request(payload: Record<string, unknown>, timeoutMs?: number): Promise<WorkerResponse> {
    if (this.closed) throw new Error('Worker is shut down.');
    await this.ensureReady();
    const id = this.nextId++;
    const ceiling = timeoutMs ?? this.requestTimeoutMs;
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Local worker request timed out after ${Math.round(ceiling / 1000)}s.`));
      }, ceiling);
      // Never let a timer keep the app alive on its own.
      (timer as { unref?: () => void }).unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child?.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  shutdown(): void {
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Local worker shut down.'));
    }
    this.pending.clear();
    this.ready = null;
    try {
      this.child?.stdin.write('{"op": "shutdown"}\n');
    } catch { /* already gone */ }
    const child = this.child;
    this.child = null;
    if (child) {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch { /* exited on its own */ }
      }, 2000);
      (timer as { unref?: () => void }).unref?.();
      child.once('exit', () => clearTimeout(timer));
    }
  }

  private ensureReady(): Promise<void> {
    if (this.ready) return this.ready;
    if (this.startFailures >= this.maxStartFailures) {
      return Promise.reject(new Error('Local worker keeps failing to start — skipping.'));
    }
    this.ready = this.start().then(
      () => {
        this.startFailures = 0;
      },
      (e: unknown) => {
        this.startFailures += 1;
        this.ready = null;
        throw e;
      },
    );
    return this.ready;
  }

  private start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const child = this.spawnImpl('python', [this.script, ...this.argv], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.child = child;
      this.buffer = '';

      const settle = (ok: boolean, error?: Error) => {
        if (settled) return;
        settled = true;
        if (ok) resolve();
        else {
          this.child = null;
          reject(error ?? new Error('Local worker exited before it was ready.'));
        }
      };

      const timer = setTimeout(() => {
        settle(false, new Error(`Local worker took too long to load (> ${Math.round(this.readyTimeoutMs / 1000)}s).`));
        try {
          child.kill();
        } catch { /* already gone */ }
      }, this.readyTimeoutMs);
      (timer as { unref?: () => void }).unref?.();

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.consume(chunk, () => {
        clearTimeout(timer);
        settle(true);
      }));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', () => { /* worker logs stay out of the app log */ });
      child.once('error', (error) => {
        clearTimeout(timer);
        settle(false, new Error(`Local worker could not start: ${error.message}`));
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (this.child === child) this.child = null;
        this.ready = null;
        if (!settled) {
          settle(false, new Error(`Local worker exited during startup (code ${code ?? 'unknown'}).`));
          return;
        }
        // Unexpected mid-run exit: fail in-flight requests. The next request
        // lazily restarts (ensureReady); the consecutive-failure breaker
        // stops a crash loop from stalling callers.
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('Local worker exited unexpectedly.'));
        }
        this.pending.clear();
      });
    });
  }

  private consume(chunk: string, onReady: () => void): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let msg: WorkerResponse;
      try {
        msg = JSON.parse(trimmed) as WorkerResponse;
      } catch {
        continue; // startup noise — onnxruntime warnings go to stderr, but be lenient
      }
      if (msg.ready) {
        onReady();
        continue;
      }
      if (typeof msg.id !== 'number') continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(typeof msg.error === 'string' && msg.error ? msg.error : 'Local worker request failed.'));
    }
  }
}
