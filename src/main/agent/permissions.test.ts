import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock } from '../../shared/types.js';

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

import { checkPermission } from './permissions.js';

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;
const options = { sessionId: 'permission-test', cwd: 'C:\\work\\project' };
const tool = (name: string, input: Record<string, unknown> = {}): ToolUse => ({
  type: 'tool_use',
  id: `test-${name}`,
  name,
  input,
});

beforeEach(() => {
  mocks.values.clear();
  mocks.requestPermission.mockReset().mockResolvedValue(false);
});

describe('permission profiles', () => {
  it.each([':full-system-access', 'fullSystemAccess', 'full-system-access', 'full_system_access']) (
    'allows tools without prompting for the full-system profile alias %s',
    async (profile) => {
      mocks.values.set('permissionProfile', profile);
      await expect(checkPermission(tool('Computer', { action: 'mouse_click' }), options)).resolves.toBe(true);
      expect(mocks.requestPermission).not.toHaveBeenCalled();
    },
  );

  it('keeps read-only mode side-effect free', async () => {
    mocks.values.set('permissionMode', 'readOnly');
    await expect(checkPermission(tool('Read', { file_path: 'README.md' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('PowerShell', { command: 'Get-Content README.md' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('PowerShell', { command: 'Get-Content README.md | Remove-Item' }), options)).resolves.toBe(false);
    await expect(checkPermission(tool('Write', { file_path: 'changed.txt' }), options)).resolves.toBe(false);
    await expect(checkPermission(tool('Computer', { action: 'type_text' }), options)).resolves.toBe(false);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it('honors the explicit accept-edits profile outside the workspace', async () => {
    mocks.values.set('permissionProfile', ':accept-edits');
    await expect(checkPermission(tool('Write', { file_path: 'C:\\outside\\accepted.ts' }), options)).resolves.toBe(true);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });

  it('allows workspace writes but prompts for external and traversal paths', async () => {
    mocks.values.set('permissionMode', 'workspace');
    mocks.requestPermission.mockResolvedValueOnce(false).mockResolvedValueOnce(false);

    await expect(checkPermission(tool('Write', { file_path: 'src\\safe.ts' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('Write', { file_path: 'C:\\outside\\file.ts' }), options)).resolves.toBe(false);
    await expect(checkPermission(tool('Write', { file_path: '..\\outside.ts' }), options)).resolves.toBe(false);
    expect(mocks.requestPermission).toHaveBeenCalledTimes(2);
  });

  it('auto-approves read-only pipelines in workspace mode without prompting', async () => {
    mocks.values.set('permissionMode', 'workspace');
    mocks.requestPermission.mockResolvedValueOnce(false);
    await expect(checkPermission(tool('Bash', { command: 'Get-ChildItem -Force | Select-Object Name, Mode, Length' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('Bash', { command: 'git status | Select-Object -First 5' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('Bash', { command: 'Get-Content README.md | Remove-Item' }), options)).resolves.toBe(false);
    expect(mocks.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('honors explicit deny rules before allow rules', async () => {
    mocks.values.set('permissionMode', 'default');
    mocks.values.set('permissions', {
      allow: ['Bash(npm *)'],
      deny: ['Bash(npm publish*)'],
    });
    await expect(checkPermission(tool('Bash', { command: 'npm test' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('Bash', { command: 'npm publish --access public' }), options)).resolves.toBe(false);
  });

  it('full system access allows everything with zero prompts', async () => {
    mocks.values.set('permissionProfile', ':full-system-access');
    mocks.values.set('permissions', { deny: ['Bash(*)'] });
    await expect(checkPermission(tool('Write', { file_path: 'C:\\\\outside\\\\secret.txt' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('Bash', { command: 'Remove-Item C:\\\\ -Recurse -Force' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('BuildFeature', { name: 'x' }), options)).resolves.toBe(true);
    await expect(checkPermission(tool('Computer', { action: 'type_text' }), options)).resolves.toBe(true);
    expect(mocks.requestPermission).not.toHaveBeenCalled();
  });
});
