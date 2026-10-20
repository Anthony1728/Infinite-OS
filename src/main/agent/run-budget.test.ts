import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_TURNS,
  DEFAULT_WALL_CLOCK_MS,
  UNTIL_DONE_MAX_TURNS,
  UNTIL_DONE_WALL_CLOCK_MS,
  resolveRunBudget,
} from './run-budget.js';

describe('resolveRunBudget', () => {
  it('falls back to product defaults with no inputs', () => {
    expect(resolveRunBudget({})).toEqual({
      maxTurns: DEFAULT_MAX_TURNS,
      wallClockMs: DEFAULT_WALL_CLOCK_MS,
    });
  });

  it('uses the user setting when nothing overrides it', () => {
    expect(resolveRunBudget({ configuredTurns: 120 }).maxTurns).toBe(120);
  });

  it('prefers the per-run override over the setting', () => {
    expect(
      resolveRunBudget({ configuredTurns: 120, overrideTurns: 8 }).maxTurns,
    ).toBe(8);
  });

  it('ignores invalid turn counts at every level', () => {
    expect(resolveRunBudget({ configuredTurns: 0 }).maxTurns).toBe(DEFAULT_MAX_TURNS);
    expect(resolveRunBudget({ configuredTurns: Number.NaN }).maxTurns).toBe(DEFAULT_MAX_TURNS);
    expect(resolveRunBudget({ overrideTurns: -5, configuredTurns: 30 }).maxTurns).toBe(30);
    expect(resolveRunBudget({ overrideTurns: 12.7 }).maxTurns).toBe(12);
  });

  it('resolves wall-clock independently from turns', () => {
    const budget = resolveRunBudget({ overrideTurns: 8, overrideWallClockMs: 3 * 60_000 });
    expect(budget).toEqual({ maxTurns: 8, wallClockMs: 3 * 60_000 });

    const noClock = resolveRunBudget({ overrideTurns: 8 });
    expect(noClock.wallClockMs).toBe(DEFAULT_WALL_CLOCK_MS);
  });

  it('exposes an until-done budget that is strictly larger than the default', () => {
    expect(UNTIL_DONE_MAX_TURNS).toBeGreaterThan(DEFAULT_MAX_TURNS);
    expect(UNTIL_DONE_WALL_CLOCK_MS).toBeGreaterThan(DEFAULT_WALL_CLOCK_MS);
    expect(
      resolveRunBudget({
        overrideTurns: UNTIL_DONE_MAX_TURNS,
        overrideWallClockMs: UNTIL_DONE_WALL_CLOCK_MS,
      }),
    ).toEqual({ maxTurns: UNTIL_DONE_MAX_TURNS, wallClockMs: UNTIL_DONE_WALL_CLOCK_MS });
  });
});
