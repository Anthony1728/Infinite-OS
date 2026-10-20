import { describe, expect, it } from 'vitest';
import { planSelfApply, applySelfEdit } from './self-apply.js';
import type { SelfApplyEvent } from './self-apply.js';

/**
 * Why this step exists at all.
 *
 * A packaged build runs a prebuilt renderer. So when the agent adds a UI
 * component or a theme, the file is written and nothing on screen changes until
 * someone restarts Infinite OS by hand. `BuildFeature` used to end with exactly
 * that instruction.
 *
 * These tests cover the decision logic: when nothing is needed, when a rebuild
 * is needed, and when there is nothing to rebuild at all.
 */

describe('deciding whether an edit needs anything done to it', () => {
  it('does nothing in dev, because hot reload already applied it', () => {
    const plan = planSelfApply({ isPackaged: false, repoRoot: 'C:\\repo' });
    expect(plan.action).toBe('hot-reload');
    expect(plan.reason).toMatch(/live|reload/i);
  });

  it('rebuilds in a packaged build', () => {
    // The case that matters: without this the feature is written and invisible.
    const plan = planSelfApply({ isPackaged: true, repoRoot: 'C:\\repo' });
    expect(plan.action).toBe('rebuild');
  });

  it('says there is nothing to rebuild when there is no source checkout', () => {
    // An installed build. Claiming success here would be a lie — there is no
    // way to rebuild something whose source is not present.
    const plan = planSelfApply({ isPackaged: true, repoRoot: null });
    expect(plan.action).toBe('blocked');
    expect(plan.reason).toMatch(/no source|checkout/i);
  });

  it('refuses to start a second rebuild while one is running', () => {
    const plan = planSelfApply({ isPackaged: true, repoRoot: 'C:\\repo', building: true });
    expect(plan.action).toBe('blocked');
    expect(plan.reason).toMatch(/already running/i);
  });
});

describe('applying an edit from the agent path', () => {
  it('reports nothing to do in dev, and does not call it a failure', async () => {
    const result = await applySelfEdit({ isPackaged: false, repoRoot: 'C:\\repo' });
    // `applied: false` here is the correct outcome, not a problem: HMR already
    // made it live. Reporting it as a failure would train the agent to retry
    // something that needs no retry.
    expect(result.applied).toBe(false);
    expect(result.message).toMatch(/live|reload/i);
  });

  it('explains rather than failing when there is no checkout', async () => {
    const result = await applySelfEdit({ isPackaged: true, repoRoot: null });
    expect(result.applied).toBe(false);
    expect(result.message.length).toBeGreaterThan(10);
    // It must be an explanation a user can act on.
    expect(result.message).toMatch(/checkout|rebuild|dev/i);
  });

  it('never throws, because a restart problem must not fail a good build', async () => {
    // The build already passed validation and the code is on disk. Losing that
    // work over a relaunch failure would be the worst possible outcome.
    let threw = false;
    try {
      await applySelfEdit({ isPackaged: true, repoRoot: null, onEvent: (() => { throw new Error('listener exploded'); }) as (e: SelfApplyEvent) => void });
    } catch {
      threw = true;
    }
    // A blocked plan must not throw regardless of what the event listener does.
    expect(threw).toBe(false);
  });
});