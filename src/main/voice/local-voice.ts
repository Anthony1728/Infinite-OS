// Local voice service — talks to resources/scripts/local_voice_server.py.
//
// The Python child owns the microphone, the energy VAD and the local models:
//   mic -> VAD -> Faster-Whisper (CPU int8) -> transcript events
//   text -> Kokoro (local onnx)            -> wav/mp3
//
// It speaks newline-delimited JSON on stdout; every other line is ignored so
// stray library output can never poison the event stream.

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolveScript } from './script-paths.js';
import { infiniteHome } from '../profiles/home.js';

export interface LocalVoiceEvent {
  type: string;
  transcript?: string;
  final?: boolean;
  confidence?: number;
  language?: string;
  message?: string;
  level?: number;
  model?: string;
  path?: string;
  format?: string;
  bytes?: number;
  duration?: number;
  seconds?: number;
  rtf?: number;
  took?: number;
  state?: string;
  listening?: boolean;
  model_loaded?: boolean;
  kokoro?: boolean;
  ffmpeg?: boolean;
  percent?: number;
  id?: number;
  ok?: boolean;
  error?: string;
  engine?: string;
}

export interface LocalVoiceStartResult {
  ok: boolean;
  engine?: string;
  model?: string;
  error?: string;
}

interface Pending {
  resolve: (event: LocalVoiceEvent) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const START_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 120_000;

/** Resolve the Python entry point for the local voice server. */
export function localVoiceScript(): string | null {
  return resolveScript('local_voice_server.py');
}

function pythonCandidates(): Array<{ cmd: string; prefixArgs: string[] }> {
  return [
    { cmd: 'python', prefixArgs: [] },
    { cmd: 'py', prefixArgs: ['-3'] },
    { cmd: 'python3', prefixArgs: [] },
  ];
}

export function isLocalVoiceScriptAvailable(): boolean {
  return localVoiceScript() !== null;
}

export class LocalVoiceService {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: LocalVoiceEvent) => void>();
  private starting: Promise<boolean> | null = null;
  private lastError: string | null = null;
  // Measured fastest model that transcribes exactly on this machine
  // (base.en 2.30s / rtf 0.81 vs tiny 1.44s but wrong words, small 8.8s).
  private model = 'base.en';
  private listening = false;

  get isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null && !this.child.killed;
  }

  get activeModel(): string {
    return this.model;
  }

  get activeListening(): boolean {
    return this.listening;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  onEvent(listener: (event: LocalVoiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: LocalVoiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a listener must never break the pipe */
      }
    }
  }

  /** Spawn the Python child (idempotent). Resolves true when the pipe is up. */
  async ensure(): Promise<boolean> {
    if (this.isRunning) return true;
    if (this.starting) return this.starting;
    this.starting = this.spawnChild().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private spawnChild(): Promise<boolean> {
    const script = localVoiceScript();
    if (!script) {
      this.lastError = 'Local voice server script was not found.';
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };

      const timer = setTimeout(() => {
        this.lastError = 'Local voice server did not respond in time.';
        finish(false);
      }, 30_000);

      let attempt = 0;
      const candidates = pythonCandidates();

      const trySpawn = () => {
        if (attempt >= candidates.length) {
          this.lastError = 'Python was not found on PATH. Install Python 3.10+ to use local voice.';
          finish(false);
          return;
        }
        const candidate = candidates[attempt];
        attempt += 1;
        const child = spawn(candidate.cmd, [...candidate.prefixArgs, '-u', '-X', 'utf8', script], {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUTF8: '1',
            HF_HUB_DISABLE_PROGRESS_BARS: '1',
            INFINITE_HOME: infiniteHome(),
          },
        });

        let spawnFailed = false;
        child.once('error', (error) => {
          if (spawnFailed) return;
          spawnFailed = true;
          this.lastError = error.message;
          trySpawn();
        });

        child.once('spawn', () => {
          if (spawnFailed) return;
          this.child = child;
          this.buffer = '';
          child.stdout?.setEncoding('utf8');
          child.stdout?.on('data', (chunk: string) => this.consume(chunk));
          child.stderr?.setEncoding('utf8');
          child.stderr?.on('data', (chunk: string) => this.consumeStderr(chunk));
          child.once('exit', (code) => this.handleExit(code));
          finish(true);
        });
      };

      trySpawn();
    });
  }

  private handleExit(code: number | null): void {
    this.child = null;
    this.listening = false;
    const message =
      code && code !== 0
        ? `Local voice server exited with code ${code}${this.lastError ? `: ${this.lastError}` : '.'}`
        : 'Local voice server stopped.';
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
    this.emit({ type: 'ended', message: code && code !== 0 ? message : undefined });
  }

  private consumeStderr(chunk: string): void {
    const clean = chunk.trim();
    if (!clean) return;
    this.lastError = clean.slice(-500);
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) continue;
      let event: LocalVoiceEvent;
      try {
        event = JSON.parse(trimmed) as LocalVoiceEvent;
      } catch {
        continue;
      }
      if (typeof event.id === 'number') {
        const pending = this.pending.get(event.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(event.id);
          if (event.type === 'tts_error' || (event.type === 'start_result' && event.ok === false)) {
            pending.reject(new Error(event.message ?? event.error ?? 'Local voice request failed.'));
          } else {
            pending.resolve(event);
          }
        }
      }
      if (event.type === 'ready') {
        if (event.model) this.model = event.model;
        if (event.engine === 'local-whisper') this.lastError = null;
      }
      if (event.type === 'start_result') this.listening = Boolean(event.ok);
      if (event.type === 'stop_result') this.listening = false;
      if (event.type === 'ended') this.listening = false;
      this.emit(event);
    }
  }

  private send(command: Record<string, unknown>): number | null {
    const child = this.child;
    if (!child || !child.stdin || child.stdin.destroyed) return null;
    const id = this.nextId++;
    try {
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
      return id;
    } catch {
      return null;
    }
  }

  private request(
    command: Record<string, unknown>,
    timeoutMs: number,
    _types: string[],
  ): Promise<LocalVoiceEvent> {
    const id = this.send(command);
    if (id === null) {
      return Promise.reject(new Error(this.lastError ?? 'Local voice server is not running.'));
    }
    return new Promise<LocalVoiceEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Local voice request timed out (${command.cmd as string}).`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  /** Start microphone capture with the given model/language configuration. */
  async start(config: Record<string, unknown>): Promise<LocalVoiceStartResult> {
    const alive = await this.ensure();
    if (!alive) {
      return { ok: false, error: this.lastError ?? 'Local voice server could not start.' };
    }
    if (typeof config.model === 'string' && config.model) this.model = config.model;

    return new Promise<LocalVoiceStartResult>((resolve) => {
      const child = this.child;
      if (!child?.stdin || child.stdin.destroyed) {
        resolve({ ok: false, error: this.lastError ?? 'Local voice server is not running.' });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        off();
        resolve({ ok: false, error: 'Local speech engine took too long to start.' });
      }, START_TIMEOUT_MS);

      const off = this.onEvent((event) => {
        if (settled) return;
        if (event.type === 'start_result') {
          settled = true;
          clearTimeout(timer);
          off();
          resolve({
            ok: event.ok === true,
            engine: event.engine ?? 'local-whisper',
            model: event.model ?? this.model,
            ...(event.ok ? {} : { error: event.error ?? 'Local speech engine failed to start.' }),
          });
        } else if (event.type === 'error' && !this.listening) {
          // Startup-class errors (missing Python module, no mic, …).
          settled = true;
          clearTimeout(timer);
          off();
          resolve({ ok: false, error: event.message ?? 'Local speech engine failed to start.' });
        }
      });

      this.send({ cmd: 'start', config });
    });
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      this.listening = false;
      return;
    }
    this.send({ cmd: 'stop' });
    this.listening = false;
  }

  /** Synthesize speech locally. Returns the produced file's bytes. */
  async synthesize(
    text: string,
    options: { voice?: string; speed?: number; language?: string; format?: 'wav' | 'mp3' } = {},
  ): Promise<{ buffer: Buffer; format: string; path: string; duration: number }> {
    const alive = await this.ensure();
    if (!alive) throw new Error(this.lastError ?? 'Local voice server could not start.');

    const child = this.child;
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed) {
      throw new Error(this.lastError ?? 'Local voice server is not running.');
    }

    const id = this.nextId++;
    const payload = {
      cmd: 'speak',
      id,
      text,
      voice: options.voice,
      speed: options.speed ?? 1,
      language: options.language,
      format: options.format ?? 'wav',
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Local speech synthesis timed out.'));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (event) => {
          try {
            const path = event.path;
            if (!path || !existsSync(path)) {
              reject(new Error('Local speech synthesis produced no audio.'));
              return;
            }
            resolve({
              buffer: readFileSync(path),
              format: event.format ?? 'wav',
              path,
              duration: event.duration ?? 0,
            });
          } catch (error) {
            reject(error as Error);
          }
        },
        reject,
        timer,
      });

      try {
        stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });
  }

  /** Probe the child for model/microphone availability without touching audio. */
  async status(timeoutMs = 5_000): Promise<LocalVoiceEvent | null> {
    if (!this.isRunning) return null;
    try {
      return await this.request({ cmd: 'status' }, timeoutMs, ['status_report']);
    } catch {
      return null;
    }
  }

  /** Warm the Whisper model in the background (called once at app start). */
  async warm(): Promise<void> {
    const alive = await this.ensure();
    if (!alive) return;
    this.send({ cmd: 'boot' });
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    this.listening = false;
    if (!child) return;
    try {
      child.stdin?.write(`${JSON.stringify({ cmd: 'shutdown', id: this.nextId++ })}\n`);
      // Closing stdin ends the server's `for line in sys.stdin` loop even if
      // the kill timer below never runs (Electron quitting immediately after
      // this call), so no orphaned Python process keeps the microphone open.
      child.stdin?.end();
    } catch {
      /* pipe already gone */
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already exited */
      }
    }, 1_500);
    // Never hold the event loop open just to watch for a graceful exit.
    timer.unref?.();
    child.once('exit', () => clearTimeout(timer));
  }
}

let instance: LocalVoiceService | null = null;

export function getLocalVoice(): LocalVoiceService {
  if (!instance) instance = new LocalVoiceService();
  return instance;
}

export function disposeLocalVoice(): void {
  instance?.dispose();
  instance = null;
}
