import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '../tools/base.js';

vi.mock('./hooks.js', () => ({ runHooks: vi.fn().mockResolvedValue({ blocked: false }) }));
vi.mock('./permissions.js', () => ({
  checkPermission: vi.fn().mockResolvedValue(true),
  currentPermissionProfile: vi.fn().mockReturnValue('default'),
}));

import { executeToolCall, getToolTimeout } from './tool-execution.js';

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
