/**
 * Run budget — one source of truth for how long an agent run may go.
 *
 * Three inputs with strict priority:
 *   1. per-run override (the chat "Keep working until done" toggle, WhatsApp
 *      turn caps) — callers that know this run needs a different ceiling
 *   2. the user's `agentMaxTurns` setting — an explicit global opt-in
 *   3. product defaults — bounded so a stuck model cannot loop for hours
 *
 * Wall-clock is resolved separately: an override may raise it (until-done
 * marathons) or shrink it (WhatsApp replies must come back fast), while plain
 * runs keep the 15-minute default.
 */

export const DEFAULT_MAX_TURNS = 60;
export const DEFAULT_WALL_CLOCK_MS = 15 * 60_000;

/** Work-until-done runs trade speed for completeness: every item finished. */
export const UNTIL_DONE_MAX_TURNS = 150;
export const UNTIL_DONE_WALL_CLOCK_MS = 45 * 60_000;

export interface RunBudget {
  maxTurns: number;
  wallClockMs: number;
}

export interface RunBudgetInput {
  /** Global setting (agentMaxTurns). Ignored when invalid. */
  configuredTurns?: number;
  /** Per-run turn ceiling. Wins over configuredTurns. */
  overrideTurns?: number;
  /** Per-run wall-clock ceiling in ms. Wins over the default. */
  overrideWallClockMs?: number;
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

export function resolveRunBudget(input: RunBudgetInput): RunBudget {
  const maxTurns =
    positiveInt(input.overrideTurns) ??
    positiveInt(input.configuredTurns) ??
    DEFAULT_MAX_TURNS;
  const wallClockMs = positiveInt(input.overrideWallClockMs) ?? DEFAULT_WALL_CLOCK_MS;
  return { maxTurns, wallClockMs };
}
