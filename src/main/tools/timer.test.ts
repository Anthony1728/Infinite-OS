import { afterEach, describe, expect, it } from 'vitest';
import { timerTool } from './timer.js';
import { parseCompactDuration } from './timer.js';

function exec(action: string, args: Record<string, unknown>) {
  return timerTool.execute({ action, ...args }, {} as never);
}

afterEach(async () => {
  await exec('clear', {});
});

describe('Timer tool', () => {
  it('starts a timer and reports its schedule', async () => {
    const result = await exec('start', { seconds: 3600, label: 'focus session' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.ok).toBe(true);
    expect(parsed.id).toMatch(/^timer-/);
    expect(parsed.remainingMs).toBe(3_600_000);
    expect(parsed.endsAt).toBe(parsed.startedAt + parsed.remainingMs);
  });

  it('parses compact durations and combines units', async () => {
    expect(parseCompactDuration('90s')).toBe(90_000);
    expect(parseCompactDuration('5m')).toBe(300_000);
    expect(parseCompactDuration('2h30m')).toBe(9_000_000);
    expect(parseCompactDuration('1h15m30s')).toBe(4_530_000);
    expect(parseCompactDuration('banana')).toBeNull();
    expect(parseCompactDuration('')).toBeNull();
  });

  it('supports the duration shorthand and precedence', async () => {
    const result = await exec('start', { duration: '2m' });
    expect(JSON.parse(String(result.content)).remainingMs).toBe(120_000);
  });

  it('lists active timers with remaining time', async () => {
    await exec('start', { seconds: 600, label: 'pomodoro' });
    const list = JSON.parse(String((await exec('list', {})).content));
    expect(list.activeCount).toBe(1);
    expect(list.active[0].remainingLabel).toBe('10m 0s');
  });

  it('cancels timers', async () => {
    const started = JSON.parse(String((await exec('start', { seconds: 999 })).content));
    const cancelled = JSON.parse(String((await exec('cancel', { id: started.id })).content));
    expect(cancelled.ok).toBe(true);
    expect(JSON.parse(String((await exec('list', {})).content)).activeCount).toBe(0);
  });

  it('check reports fired timers deterministically (polling)', async () => {
    await exec('start', { seconds: 1, label: 'quick beep' });
    // Poll up to ~8s for the 1s timer to fire (generous under CI load).
    let fired: { label: string }[] = [];
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const check = JSON.parse(String((await exec('check', {})).content));
      if (check.firedCount > 0) { fired = check.fired; break; }
    }
    expect(fired).toHaveLength(1);
    expect(fired[0].label).toBe('quick beep');
  });

  it('requires a positive duration', async () => {
    const zero = await exec('start', { seconds: 0 });
    expect(zero.is_error).toBe(true);
    const empty = await exec('start', {});
    expect(empty.is_error).toBe(true);
  });

  it('rejects durations over a year', async () => {
    const result = await exec('start', { duration: '10000h' });
    expect(result.is_error).toBe(true);
  });
});
