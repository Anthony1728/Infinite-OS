import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  requestPermission: vi.fn<(tool: unknown, options: unknown) => Promise<boolean>>(),
}));

vi.mock('../settings/store.js', () => ({
  settings: { get: (key: string) => mocks.values.get(key) },
}));
vi.mock('./permission-prompt.js', () => ({
  requestPermission: mocks.requestPermission,
}));

import { executeToolCall } from './tool-execution.js';
import { actionAuditLog } from '../audit/action-log.js';
import { bash } from '../tools/bash.js';

const options = {
  sessionId: 'pipeline-integration',
  cwd: process.cwd(),
  parentSignal: new AbortController().signal,
  onUpdate: () => {},
};

beforeEach(() => {
  actionAuditLog.setMemoryOnly(true);
  actionAuditLog.reset();
  mocks.values.clear();
  mocks.requestPermission.mockReset().mockResolvedValue(false);
});

describe('real tool pipeline (permission -> executeToolCall -> bash)', () => {
  it('executes a read-only PowerShell pipeline on this machine without prompting in workspace mode', { timeout: 15000 }, async () => {
    mocks.values.set('permissionMode', 'workspace');
    const result = await executeToolCall({
      tool: bash,
      toolUse: {
        id: 'real-1',
        type: 'tool_use',
        name: 'Bash',
        input: { command: 'Get-ChildItem -Force | Select-Object Name, Mode, Length' },
      },
      ...options,
    });
    expect(result.is_error).not.toBe(true);
    expect(String(result.content)).toContain('Name');
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it('hard-blocks a destructive command in workspace mode before any prompt', async () => {
    // rm -rf-class commands are stopped by the autonomy-policy gate INSIDE
    // executeToolCall — a hard stop that no profile can wave through. The
    // permission layer is never reached: an irreversible command must not be
    // one click away from running, it must be re-planned.
    mocks.values.set('permissionMode', 'workspace');
    const result = await executeToolCall({
      tool: bash,
      toolUse: {
        id: 'real-2',
        type: 'tool_use',
        name: 'Bash',
        input: { command: 'Remove-Item -Recurse -Force C:\\nonexistent-infinite-os-guard' },
      },
      ...options,
    });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('Blocked by policy');
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it('returns a useful error for an empty command instead of hanging', async () => {
    mocks.values.set('permissionMode', 'workspace');
    const result = await executeToolCall({
      tool: bash,
      toolUse: { id: 'real-3', type: 'tool_use', name: 'Bash', input: {} },
      ...options,
    });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('command');
  });
});
