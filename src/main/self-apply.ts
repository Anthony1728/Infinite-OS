/**
 * Self-apply — make Infinite AI's edits to Infinite OS actually load.
 *
 * - Dev (`npm run dev`): electron-vite already hot-reloads the renderer (HMR)
 *   and restarts Electron when main-process code changes, so self-edits are
 *   live the moment they're written. planSelfApply reports that as `hot-reload`
 *   — nothing to run.
 * - Packaged build: source edits sit inert until a rebuild. planSelfApply
 *   reports `rebuild`, and the runner executes `npm run typecheck && ... build`
 *   (`npm run build`), then relaunches the app so the changes are usable
 *   immediately.
 * - No repo on disk (installed build without a checkout): `blocked` with a
 *   clear reason — there is nothing to rebuild.
 *
 * spawn and relaunch are injected so the decision logic and the runner's state
 * machine are unit-testable without Electron or a real build.
 */

import { spawn as nodeSpawn } from 'node:child_process';

export type SelfApplyAction = 'hot-reload' | 'rebuild' | 'blocked';

export interface SelfApplyPlan {
  action: SelfApplyAction;
  reason: string;
}

export function planSelfApply(input: {
  isPackaged: boolean;
  repoRoot: string | null;
  building?: boolean;
}): SelfApplyPlan {
  if (input.building) {
    return { action: 'blocked', reason: 'A rebuild is already running.' };
  }
  if (!input.isPackaged) {
    return {
      action: 'hot-reload',
      reason:
        'Dev mode: the renderer hot-reloads (HMR) and main-process edits restart Electron automatically — self-edits are already live.',
    };
  }
  if (!input.repoRoot) {
    return {
      action: 'blocked',
      reason: 'No source checkout found next to this build — run from a dev checkout to self-edit, or reinstall.',
    };
  }
  return {
    action: 'rebuild',
    reason: 'Packaged build: typecheck + rebuild + relaunch to load the self-edits.',
  };
}

export type SelfApplyPhase = 'idle' | 'building' | 'restarting' | 'done' | 'failed' | 'already-live';

export interface SelfApplyEvent {
  phase: SelfApplyPhase;
  line?: string;
  error?: string;
}

export interface SelfApplyStatus {
  phase: SelfApplyPhase;
  tail: string[];
  error: string | null;
}

interface ChildLike {
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'close', listener: (code: number | null) => void): unknown;
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
}

export type SpawnLike = (
  command: string,
  args: string[],
  options: { cwd: string; windowsHide: boolean },
) => ChildLike;

const defaultSpawn: SpawnLike = (command, args, options) => {
  // No shell:true (DEP0190): on Windows route npm through cmd with a static
  // argv, same pattern as scripts/dev.mjs.
  if (process.platform === 'win32') {
    return nodeSpawn('cmd', ['/c', command, ...args], options) as unknown as ChildLike;
  }
  return nodeSpawn(command, args, options) as unknown as ChildLike;
};

async function defaultRelaunch(): Promise<void> {
  try {
    const { app } = await import('electron');
    app.relaunch();
    app.exit(0);
  } catch {
    // Headless/tests — caller observes phase 'restarting' either way.
  }
}

const MAX_TAIL_LINES = 40;

/**
 * Emit a progress event without letting the listener break the build.
 *
 * `onEvent` writes to a window, and during a relaunch that window may already
 * be gone. A UI callback must never be able to fail an operation that has
 * otherwise succeeded.
 */
function emit(onEvent: ((event: SelfApplyEvent) => void) | undefined, event: SelfApplyEvent): void {
  try {
    onEvent?.(event);
  } catch {
    /* the window went away mid-relaunch; the build itself is unaffected */
  }
}

export class SelfApplyRunner {
  private phase: SelfApplyPhase = 'idle';
  private tail: string[] = [];
  private error: string | null = null;

  constructor(
    private readonly deps: {
      spawn?: SpawnLike;
      relaunch?: () => void | Promise<void>;
      now?: () => number;
    } = {},
  ) {}

  status(): SelfApplyStatus {
    return { phase: this.phase, tail: [...this.tail], error: this.error };
  }

  private pushLine(line: string): void {
    this.tail.push(line);
    if (this.tail.length > MAX_TAIL_LINES) this.tail = this.tail.slice(-MAX_TAIL_LINES);
  }

  async run(input: {
    isPackaged: boolean;
    repoRoot: string | null;
    onEvent?: (event: SelfApplyEvent) => void;
    relaunch?: () => void | Promise<void>;
  }): Promise<{ ok: boolean; plan: SelfApplyPlan }> {
    const building = this.phase === 'building' || this.phase === 'restarting';
    const plan = planSelfApply({ ...input, building });

    if (plan.action === 'blocked') {
      // "Already running" must NOT clobber the in-flight build's phase — only
      // a genuinely failed plan marks the runner failed.
      if (!building) {
        this.phase = 'failed';
        this.error = plan.reason;
        emit(input.onEvent, { phase: 'failed', error: plan.reason });
      }
      return { ok: false, plan };
    }
    if (plan.action === 'hot-reload') {
      this.phase = 'already-live';
      this.error = null;
      emit(input.onEvent, { phase: 'already-live', line: plan.reason });
      return { ok: true, plan };
    }
    emit(input.onEvent, { phase: 'building', line: plan.reason });

    this.phase = 'building';
    this.error = null;
    this.tail = [];
    const spawnImpl = this.deps.spawn ?? defaultSpawn;
    const child = spawnImpl('npm', ['run', 'build'], { cwd: input.repoRoot as string, windowsHide: true });

    const forward = (chunk: Buffer | string) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.pushLine(line);
        emit(input.onEvent, { phase: this.phase, line });
      }
    };
    child.stdout?.on('data', forward);
    child.stderr?.on('data', forward);

    const exit = await new Promise<number | null>((resolve) => {
      child.on('error', (err: Error) => {
        this.phase = 'failed';
        this.error = err.message;
        emit(input.onEvent, { phase: 'failed', error: err.message });
        resolve(null);
      });
      child.on('close', (code: number | null) => resolve(code));
    });

    if (exit !== 0) {
      this.phase = 'failed';
      this.error = this.error ?? `Build failed (exit ${exit ?? 'unknown'}).`;
      emit(input.onEvent, { phase: 'failed', error: this.error });
      return { ok: false, plan };
    }

    this.phase = 'restarting';
    emit(input.onEvent, { phase: 'restarting', line: 'Build passed — relaunching Infinite OS…' });
    await (input.relaunch ?? this.deps.relaunch ?? defaultRelaunch)();
    this.phase = 'done';
    emit(input.onEvent, { phase: 'done' });
    return { ok: true, plan };
  }
}

/**
 * Apply the app's own source edits so they take effect, and say what happened.
 *
 * A convenience wrapper over {@link SelfApplyRunner} for callers that do not
 * need the progress events — the agent path, where the answer is written into
 * the tool result rather than streamed to a window.
 *
 * `applied: false` is a normal outcome, not a failure. In dev the edits are
 * already live from hot reload, and an installed build with no checkout has
 * nothing to rebuild. Neither should be reported as a problem.
 */
export async function applySelfEdit(input: {
  isPackaged: boolean;
  repoRoot: string | null;
  relaunch?: () => void | Promise<void>;
  onEvent?: (event: SelfApplyEvent) => void;
}): Promise<{ applied: boolean; message: string }> {
  const runner = new SelfApplyRunner();
  const { ok, plan } = await runner.run(input);
  if (ok && plan.action === 'rebuild') {
    return { applied: true, message: 'Rebuilt and relaunched; the change is live.' };
  }
  return { applied: false, message: plan.reason };
}
