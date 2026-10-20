import { describe, expect, it, vi } from 'vitest';
import {
  EVOLVE_DEFAULT_FIRST_DELAY_MS,
  EVOLVE_MAX_CONSECUTIVE_FAILURES,
  EVOLVE_MIN_INTERVAL_MS,
  EvolutionLoop,
  evolutionCyclePrompt,
} from './evolution-loop.js';
import type { EvolutionSnapshot } from './evolution-loop.js';

/** Manual timer queue so tests drive every tick deterministically. */
function fakeScheduler() {
  const pending: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  return {
    schedule: (fn: () => void, ms: number) => {
      const handle = { fn, ms, cleared: false };
      pending.push(handle);
      return { clear: () => { handle.cleared = true; } };
    },
    /** Fire the oldest live timer (the scheduled evolve tick). */
    fire: () => {
      const next = pending.find((p) => !p.cleared);
      if (!next) throw new Error('no timer scheduled');
      next.cleared = true;
      next.fn();
    },
    liveCount: () => pending.filter((p) => !p.cleared).length,
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('EvolutionLoop', () => {
  it('starts disabled, arms the first cycle on start, and persists state', async () => {
    const scheduler = fakeScheduler();
    const runCycle = vi.fn(async () => 'built a thing');
    const snapshots: EvolutionSnapshot[] = [];
    const loop = new EvolutionLoop({
      runCycle,
      schedule: scheduler.schedule,
      onChange: (s) => snapshots.push(s),
    });

    expect(loop.status().enabled).toBe(false);
    expect(scheduler.liveCount()).toBe(0);

    loop.start({ intervalMs: 60_000 });
    expect(loop.status().enabled).toBe(true);
    expect(loop.status().nextRunAt).not.toBeNull();
    expect(scheduler.liveCount()).toBe(1);
    expect(snapshots.at(-1)?.enabled).toBe(true);

    scheduler.fire();
    await flush();
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(loop.status().cyclesCompleted).toBe(1);
    expect(loop.status().lastSummary).toBe('built a thing');
    expect(loop.status().lastDurationMs).not.toBeNull();
    // Re-armed for the next cycle after the first one completed.
    expect(scheduler.liveCount()).toBe(1);
    expect(snapshots.at(-1)?.cyclesCompleted).toBe(1);
  });

  it('never overlaps cycles: a scheduled tick during an in-flight cycle is dropped', async () => {
    const scheduler = fakeScheduler();
    let release!: () => void;
    const runCycle = vi.fn(
      () => new Promise<string>((resolve) => { release = () => resolve('slow cycle'); }),
    );
    const loop = new EvolutionLoop({ runCycle, schedule: scheduler.schedule });
    loop.start({ intervalMs: 60_000 });

    scheduler.fire();
    await flush();
    expect(loop.status().cycleInFlight).toBe(true);

    // A second fire while the first cycle runs must not start another one.
    const before = runCycle.mock.calls.length;
    try { scheduler.fire(); } catch { /* may already be cleared */ }
    await flush();
    expect(runCycle.mock.calls.length).toBe(before);

    release();
    await flush();
    expect(loop.status().cycleInFlight).toBe(false);
    expect(loop.status().cyclesCompleted).toBe(1);
    expect(scheduler.liveCount()).toBe(1);
  });

  it('records failures, keeps cycling, and auto-pauses after repeated failures', async () => {
    const scheduler = fakeScheduler();
    const runCycle = vi.fn(() => Promise.reject<string>(new Error('no model selected')));
    const snapshots: EvolutionSnapshot[] = [];
    const loop = new EvolutionLoop({ runCycle, schedule: scheduler.schedule, onChange: (s) => snapshots.push(s) });
    loop.start({ intervalMs: 60_000 });

    scheduler.fire();
    await flush();
    expect(loop.status().lastError).toMatch(/no model selected/);
    expect(loop.status().consecutiveFailures).toBe(1);
    expect(loop.status().cyclesCompleted).toBe(0);
    // Failures still re-arm: transient errors do not kill the loop.
    expect(scheduler.liveCount()).toBe(1);

    // Drive failures up to the auto-pause threshold.
    for (let i = 0; i < EVOLVE_MAX_CONSECUTIVE_FAILURES - 1; i++) {
      scheduler.fire();
      await flush();
    }
    expect(loop.status().consecutiveFailures).toBe(EVOLVE_MAX_CONSECUTIVE_FAILURES);
    expect(loop.status().enabled).toBe(false);
    expect(loop.status().lastError).toMatch(/auto-paused/);
    expect(scheduler.liveCount()).toBe(0);
    expect(snapshots.at(-1)?.enabled).toBe(false);
  });

  it('resets the failure streak after a successful cycle', async () => {
    const scheduler = fakeScheduler();
    let shouldFail = true;
    const loop = new EvolutionLoop({
      runCycle: async () => {
        if (shouldFail) throw new Error('boom');
        return 'recovered';
      },
      schedule: scheduler.schedule,
    });
    loop.start({ intervalMs: 60_000 });

    scheduler.fire();
    await flush();
    expect(loop.status().consecutiveFailures).toBe(1);

    shouldFail = false;
    scheduler.fire();
    await flush();
    expect(loop.status().consecutiveFailures).toBe(0);
    expect(loop.status().lastError).toBeNull();
    expect(loop.status().enabled).toBe(true);
  });

  it('stop cancels the pending cycle and persists disabled', () => {
    const scheduler = fakeScheduler();
    const snapshots: EvolutionSnapshot[] = [];
    const loop = new EvolutionLoop({
      runCycle: async () => 'x',
      schedule: scheduler.schedule,
      onChange: (s) => snapshots.push(s),
    });
    loop.start({ intervalMs: 60_000 });
    loop.stop();

    expect(loop.status().enabled).toBe(false);
    expect(loop.status().nextRunAt).toBeNull();
    expect(scheduler.liveCount()).toBe(0);
    expect(snapshots.at(-1)?.enabled).toBe(false);
  });

  it('clamps the interval to the minimum', () => {
    const scheduler = fakeScheduler();
    const loop = new EvolutionLoop({ runCycle: async () => 'x', schedule: scheduler.schedule });
    loop.start({ intervalMs: 1_000 });
    expect(loop.status().intervalMs).toBe(EVOLVE_MIN_INTERVAL_MS);
    loop.dispose();
  });

  it('re-arms automatically when constructed from an enabled snapshot (launch auto-resume)', async () => {
    const scheduler = fakeScheduler();
    const runCycle = vi.fn(async () => 'resumed');
    const loop = new EvolutionLoop({
      runCycle,
      schedule: scheduler.schedule,
      initial: { enabled: true, intervalMs: 60_000, cyclesCompleted: 7 },
    });

    expect(loop.status().enabled).toBe(true);
    expect(scheduler.liveCount()).toBe(1);
    expect(loop.status().cyclesCompleted).toBe(7);

    scheduler.fire();
    await flush();
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(loop.status().cyclesCompleted).toBe(8);
  });

  it('runNow executes a cycle immediately regardless of the armed timer', async () => {
    const scheduler = fakeScheduler();
    const runCycle = vi.fn(async () => 'on demand');
    const loop = new EvolutionLoop({ runCycle, schedule: scheduler.schedule });

    const status = await loop.runNow();
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(status.cyclesCompleted).toBe(1);
    expect(status.enabled).toBe(false); // never started → nothing to re-arm
    expect(scheduler.liveCount()).toBe(0);
  });

  it('uses a sane default first delay when started', () => {
    const scheduler = fakeScheduler();
    const loop = new EvolutionLoop({ runCycle: async () => 'x', schedule: scheduler.schedule });
    loop.start();
    const live = scheduler.liveCount();
    expect(live).toBe(1);
    expect(EVOLVE_DEFAULT_FIRST_DELAY_MS).toBeGreaterThan(0);
    loop.dispose();
  });
});

describe('evolutionCyclePrompt', () => {
  it('rotates through different cycle angles', () => {
    const a = evolutionCyclePrompt(0, 'C:/repo');
    const b = evolutionCyclePrompt(1, 'C:/repo');
    expect(a).not.toBe(b);
    expect(a).toContain('CYCLE #1');
    expect(b).toContain('CYCLE #2');
  });

  it('naming the repo when present and degrading to research-only without one', () => {
    expect(evolutionCyclePrompt(0, 'C:/repo')).toContain('C:/repo');
    const noRepo = evolutionCyclePrompt(0, null);
    expect(noRepo).toContain('research only');
    expect(noRepo).toContain('SELF-EVOLUTION CYCLE');
  });

  it('carries the verification + hot-reload standing orders', () => {
    const prompt = evolutionCyclePrompt(0, 'C:/repo');
    expect(prompt).toContain('npm run typecheck');
    expect(prompt).toContain('Rebuild & Apply');
    expect(prompt).toContain('Never delete or weaken a test');
  });
});
