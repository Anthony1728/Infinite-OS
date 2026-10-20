import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '../tools/base.js';

vi.mock('./hooks.js', () => ({ runHooks: vi.fn().mockResolvedValue({ blocked: false }) }));vi.mock('./permissions.js', () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  currentPermissionProfile: vi.fn().mockReturnValue('default'),
}));

import { executeToolCall, getToolTimeout, mapWithConcurrency } from './tool-execution.js';

const toolUse = { id: 'tool-1', name: 'Bash', input: { command: 'hang' }, type: 'tool_use' } as const;

afterEach(() => {
  vi.useRealTimers();
});

describe('executeToolCall', () => {
  it('aborts a stuck tool instead of leaving it running after the watchdog fires', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const tool: Tool = {
      name: 'Bash',
      description: '',
      inputSchema: {},
      permission: 'none',
      execute: async (_args, ctx) => new Promise(() => {
        ctx.abortSignal.addEventListener('abort', () => { aborted = true; }, { once: true });
      }),
    };

    const result = executeToolCall({
      tool,
      toolUse,
      sessionId: 'session-1',
      cwd: process.cwd(),
      parentSignal: new AbortController().signal,
      onUpdate: () => {},
    });
    const rejection = expect(result).rejects.toThrow('was cancelled');
    await vi.advanceTimersByTimeAsync(getToolTimeout('Bash'));
    await rejection;
    expect(aborted).toBe(true);
  });

  it('cancels the active tool when the parent run is aborted', async () => {
    let aborted = false;
    const tool: Tool = {
      name: 'Bash',
      description: '',
      inputSchema: {},
      permission: 'none',
      execute: async (_args, ctx) => new Promise(() => {
        ctx.abortSignal.addEventListener('abort', () => { aborted = true; }, { once: true });
      }),
    };
    const parent = new AbortController();
    const result = executeToolCall({ tool, toolUse, sessionId: 'session-1', cwd: process.cwd(), parentSignal: parent.signal, onUpdate: () => {} });
    await new Promise((resolve) => setImmediate(resolve));
    const rejection = expect(result).rejects.toThrow('cancelled');
    parent.abort();
    await rejection;
    expect(aborted).toBe(true);
  });
});

describe('mapWithConcurrency', () => {
  it('caps how many run at once while keeping results in input order', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);

    const results = await mapWithConcurrency(items, 4, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Finish out of order on purpose: whoever returns first must not reorder
      // the results.
      await new Promise((resolve) => setTimeout(resolve, (item % 5) + 1));
      inFlight--;
      return item * 2;
    });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(results).toEqual(items.map((item) => item * 2));
  });

  it('treats a limit of zero or less as one worker rather than stalling', async () => {
    await expect(mapWithConcurrency([1, 2, 3], 0, async (item) => item + 1)).resolves.toEqual([2, 3, 4]);
  });

  it('returns an empty result for an empty batch', async () => {
    await expect(mapWithConcurrency([], 4, async (item: number) => item)).resolves.toEqual([]);
  });

  it('surfaces a rejection from any worker', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error('tool blew up');
        return item;
      }),
    ).rejects.toThrow('tool blew up');
  });
});
