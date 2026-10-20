/**
 * Continuous Self-Evolution loop.
 *
 * The Settings "Self-Evolve" card used to fire one chat prompt and hope.
 * This module makes evolution a supervised background loop: while enabled it
 * dispatches a fresh evolve cycle on an interval, never overlaps cycles,
 * records per-cycle results, auto-pauses after repeated failures, and
 * survives restarts (state persisted in the settings store; main auto-resumes
 * on launch).
 *
 * The actual work — an agent run — is INJECTED so the loop itself is unit
 * testable without providers, sessions, Electron, or real timers.
 */

import { randomUUID } from 'node:crypto';
import { settings } from '../settings/store.js';
import { IPC } from '../../shared/ipc.js';
import { findSelfRepoRoot } from '../self-repo.js';

export const EVOLVE_DEFAULT_INTERVAL_MS = 45 * 60_000;
export const EVOLVE_MIN_INTERVAL_MS = 5 * 60_000;
export const EVOLVE_DEFAULT_FIRST_DELAY_MS = 10_000;
/** Consecutive failures before the loop protects itself by auto-pausing. */
export const EVOLVE_MAX_CONSECUTIVE_FAILURES = 5;

export interface EvolutionStatus {
  enabled: boolean;
  intervalMs: number;
  cycleInFlight: boolean;
  cyclesCompleted: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  nextRunAt: number | null;
  lastSummary: string | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface EvolutionSnapshot {
  enabled: boolean;
  intervalMs: number;
  cyclesCompleted: number;
  lastRunAt: number | null;
}

interface TimerHandle {
  clear(): void;
}

export interface EvolutionLoopOptions {
  /** Runs one full evolve cycle (agent research + implement). Resolves with a short summary. */
  runCycle: () => Promise<string>;
  now?: () => number;
  /** Timer factory; tests inject a manual scheduler. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => TimerHandle;
  initial?: Partial<EvolutionSnapshot>;
  /** Called on every persisted-state change (enabled / counters). */
  onChange?: (snapshot: EvolutionSnapshot) => void;
}

function clampInterval(ms: unknown): number {
  const value = typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : EVOLVE_DEFAULT_INTERVAL_MS;
  return Math.max(EVOLVE_MIN_INTERVAL_MS, Math.trunc(value));
}

function defaultSchedule(fn: () => void, ms: number): TimerHandle {
  const t = setTimeout(fn, ms);
  // Never hold the process open just for the evolution cadence.
  if (typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref();
  return { clear: () => clearTimeout(t) };
}

export class EvolutionLoop {
  private readonly runCycle: () => Promise<string>;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => TimerHandle;
  private readonly onChange?: (snapshot: EvolutionSnapshot) => void;

  private timer: TimerHandle | null = null;
  private inFlight = false;
  private enabled = false;
  private intervalMs: number;
  private cyclesCompleted: number;
  private lastRunAt: number | null;
  private lastDurationMs: number | null = null;
  private nextRunAt: number | null = null;
  private lastSummary: string | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;

  constructor(options: EvolutionLoopOptions) {
    this.runCycle = options.runCycle;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.onChange = options.onChange;
    this.intervalMs = clampInterval(options.initial?.intervalMs);
    this.enabled = options.initial?.enabled === true;
    this.cyclesCompleted =
      typeof options.initial?.cyclesCompleted === 'number' && options.initial.cyclesCompleted > 0
        ? Math.trunc(options.initial.cyclesCompleted)
        : 0;
    this.lastRunAt = options.initial?.lastRunAt ?? null;
    // Auto-resume on launch: an enabled persisted loop re-arms immediately.
    if (this.enabled) this.arm(EVOLVE_DEFAULT_FIRST_DELAY_MS);
  }

  status(): EvolutionStatus {
    return {
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      cycleInFlight: this.inFlight,
      cyclesCompleted: this.cyclesCompleted,
      lastRunAt: this.lastRunAt,
      lastDurationMs: this.lastDurationMs,
      nextRunAt: this.nextRunAt,
      lastSummary: this.lastSummary,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  start(opts?: { intervalMs?: number }): EvolutionStatus {
    if (opts?.intervalMs !== undefined) this.intervalMs = clampInterval(opts.intervalMs);
    this.enabled = true;
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.emitSnapshot();
    if (!this.inFlight) this.arm(EVOLVE_DEFAULT_FIRST_DELAY_MS);
    return this.status();
  }

  stop(): EvolutionStatus {
    this.enabled = false;
    this.clearTimer();
    this.emitSnapshot();
    return this.status();
  }

  /** Run one cycle right now (Settings "Evolve once" / tests). */
  async runNow(): Promise<EvolutionStatus> {
    await this.tick();
    return this.status();
  }

  dispose(): void {
    this.clearTimer();
  }

  private arm(delayMs: number): void {
    this.clearTimer();
    this.nextRunAt = this.now() + Math.max(0, delayMs);
    this.timer = this.schedule(() => {
      this.timer = null;
      this.nextRunAt = null;
      void this.tick();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      this.timer.clear();
      this.timer = null;
    }
    this.nextRunAt = null;
  }

  private emitSnapshot(): void {
    this.onChange?.({
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      cyclesCompleted: this.cyclesCompleted,
      lastRunAt: this.lastRunAt,
    });
  }

  private async tick(): Promise<void> {
    // Cycles never overlap: a long build in cycle N delays N+1 instead of
    // racing it.
    if (this.inFlight) return;
    this.inFlight = true;
    const started = this.now();
    try {
      const summary = await this.runCycle();
      this.cyclesCompleted += 1;
      this.lastSummary = (summary ?? '').trim().slice(0, 800) || null;
      this.lastError = null;
      this.consecutiveFailures = 0;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.consecutiveFailures += 1;
    } finally {
      this.inFlight = false;
      this.lastRunAt = this.now();
      this.lastDurationMs = this.lastRunAt - started;
      this.emitSnapshot();
    }

    // Re-arm outside finally (a return there would swallow errors — and lint
    // forbids it outright).
    if (!this.enabled) return;
    if (this.consecutiveFailures >= EVOLVE_MAX_CONSECUTIVE_FAILURES) {
      // Repeated failures (no model selected, repo gone, ...) — stop burning
      // cycles and tell the user through the status they can read in Settings.
      this.enabled = false;
      this.clearTimer();
      this.lastError = `${this.lastError ?? 'Cycle failed'} — evolution auto-paused after ${EVOLVE_MAX_CONSECUTIVE_FAILURES} consecutive failures. Fix the cause, then toggle it back on.`;
      this.emitSnapshot();
      return;
    }
    this.arm(this.intervalMs);
  }
}

// ---------------------------------------------------------------------------
// Production wiring (settings persistence + the real agent cycle)
// ---------------------------------------------------------------------------

export function loadEvolutionSnapshot(): EvolutionSnapshot {
  const lastRunAt = settings.get<number>('evolveLastRunAt');
  return {
    enabled: settings.get<boolean>('evolveLoopEnabled') === true,
    intervalMs: clampInterval(settings.get<number>('evolveIntervalMs')),
    cyclesCompleted: Number(settings.get<number>('evolveCycles')) || 0,
    lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : null,
  };
}

export function persistEvolutionSnapshot(snapshot: EvolutionSnapshot): void {
  const cwd = process.cwd();
  void settings.set('user', 'evolveLoopEnabled', snapshot.enabled, cwd).catch(() => undefined);
  void settings.set('user', 'evolveIntervalMs', snapshot.intervalMs, cwd).catch(() => undefined);
  void settings.set('user', 'evolveCycles', snapshot.cyclesCompleted, cwd).catch(() => undefined);
  void settings.set('user', 'evolveLastRunAt', snapshot.lastRunAt, cwd).catch(() => undefined);
}

/**
 * Each cycle attacks a different angle so repeated evolution keeps producing
 * new value instead of re-running the same sweep forever.
 */
export const EVOLVE_ANGLES = [
  'COMPETITOR GAP SWEEP: research what Claude, OpenCode, OpenClaw, FreeBuff, Grokbot and other leading AI workspace apps shipped recently that Infinite OS lacks. Pick the single highest-value missing capability and build it end to end.',
  'QUALITY SWEEP: audit the most-used code paths (chat, settings, builders) for bugs, dead ends and rough UI. Fix what you find, run typecheck and targeted tests, and leave the code better than you found it.',
  'SPEED & RELIABILITY SWEEP: find the slowest or most fragile flows (first token latency, WhatsApp reply time, session switching, startup) and make a measurable improvement with evidence before and after.',
  'CAPABILITY SWEEP: pick one standing order the app claims but does not fully deliver, or one gap a power user would hit, and build it completely — with tests — using BuildFeature so it ships checkpointed.',
];

export function evolutionCyclePrompt(cycleIndex: number, repoRoot: string | null): string {
  const angle = EVOLVE_ANGLES[cycleIndex % EVOLVE_ANGLES.length];
  return [
    `SELF-EVOLUTION CYCLE #${cycleIndex + 1} — Infinite OS improving itself.`,
    repoRoot
      ? `Work in the Infinite OS repository: ${repoRoot}`
      : 'No app repository was detected on disk — research only, then report a prioritized build plan for the next cycle.',
    `This cycle's angle: ${angle}`,
    '',
    'Rules:',
    '- Research first (WebSearch/WebFetch over competitor changelogs, feature pages and docs), then IMPLEMENT directly into this repo with BuildFeature (checkpointed, rollback on failure) or surgical Write/Edit for single files.',
    '- Verify before claiming done: `npm run typecheck` plus `npx vitest run <files you touched>`; fix every failure yourself. Never delete or weaken a test to make it pass.',
    '- No placeholders, no TODOs, no half-done features — follow the existing code style.',
    '- Hot reload: under `npm run dev`, renderer edits apply instantly via HMR and main-process edits restart Electron automatically. A packaged build needs Settings → Self-Evolve → "Rebuild & Apply" (typecheck + rebuild + relaunch) — tell the user to press it when you finish.',
    '- End with: what you researched, what you built, what you verified (exact commands + results), and what deliberately remains.',
  ].join('\n');
}

/** Stable persisted session so every cycle continues the same self-evolution transcript. */
async function resolveEvolutionSession(cwd: string, model: string, provider: string): Promise<string> {
  const existing = settings.get<string>('evolveSessionId');
  if (existing) return existing;
  try {
    const sessionStore = await import('../session/store.js');
    const created = await sessionStore.createSession({ cwd, model, provider, title: 'Self-Evolution' });
    await settings.set('user', 'evolveSessionId', created.id, process.cwd()).catch(() => undefined);
    return created.id;
  } catch {
    return `evolve-${Date.now()}`;
  }
}

async function emitToRenderer(sessionId: string, event: unknown): Promise<void> {
  try {
    const { BrowserWindow } = await import('electron');
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send(IPC.CHAT_STREAM_EVENT, { sessionId, ...(event as Record<string, unknown>) });
  } catch {
    // Headless/tests — mirroring is best-effort.
  }
}

let cycleAngleCounter = 0;

/** The real cycle: resolve the selected model, then run the evolve prompt as an agent turn. */
export async function runEvolutionCycle(): Promise<string> {
  const { resolveActiveModel } = await import('../agent/active-model.js');
  const active = resolveActiveModel((key) => settings.get(key));
  const repoRoot = findSelfRepoRoot();
  const cwd = repoRoot ?? active.cwd;
  const sessionId = await resolveEvolutionSession(cwd, active.model, active.provider);

  const sessionStore = await import('../session/store.js');
  const history = await sessionStore.loadMessages(sessionId).catch(() => []);
  const cycleIndex = cycleAngleCounter++;
  const userMessage = {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: evolutionCyclePrompt(cycleIndex, repoRoot) }],
    timestamp: Date.now(),
  } as never;
  await sessionStore.appendMessage(sessionId, userMessage).catch(() => undefined);

  const controller = new AbortController();
  // Cycles are real builds: 40 minutes covers a research + implement + verify pass.
  const timer = setTimeout(() => controller.abort(), 40 * 60_000);
  try {
    const { runAgent } = await import('../agent/loop.js');
    const completed = await runAgent([...history] as never, userMessage, {
      sessionId,
      cwd,
      provider: active.provider,
      model: active.model,
      signal: controller.signal,
      // Self-evolution is allowed a long, complete run — quality first.
      maxTurns: 80,
      wallClockMs: 40 * 60_000,
      onEvent: (event) => void emitToRenderer(sessionId, event),
    });
    for (const message of (completed as unknown as Array<{ role: string }>).slice((history as unknown[]).length + 1)) {
      await sessionStore.appendMessage(sessionId, message as never).catch(() => undefined);
    }
    const last = [...(completed as unknown as Array<{ role: string; content?: Array<{ type?: string; text?: string }> }>)]
      .reverse()
      .find((m) => m.role === 'assistant');
    const summary = (last?.content ?? [])
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('\n')
      .trim();
    return summary.slice(0, 800) || 'Cycle finished without a text summary.';
  } finally {
    clearTimeout(timer);
  }
}

/** Singleton factory used by IPC + launch auto-resume. */
export function createEvolutionLoop(): EvolutionLoop {
  return new EvolutionLoop({
    runCycle: runEvolutionCycle,
    initial: loadEvolutionSnapshot(),
    onChange: persistEvolutionSnapshot,
  });
}
