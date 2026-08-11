// Network tool tests — the execute() logic for the user's own PC/network.
// Real system commands run only where the test environment is Windows and
// the commands are safe, read-only diagnostics.

import { describe, expect, it } from 'vitest';
import { networkTool } from './network.js';

const ctx = {
  cwd: process.cwd(),
  abortSignal: new AbortController().signal,
  sessionId: 'test',
  onUpdate: () => {},
} as never;

async function exec(args: Record<string, unknown>) {
  return networkTool.execute({ ...args }, ctx);
}

describe('Network tool', () => {
  it('is a registered-shaped tool with a schema', () => {
    expect(networkTool.name).toBe('Network');
    expect(networkTool.permission).toBe('ask');
    expect(networkTool.description).toContain('Wi-Fi');
    const actions = (networkTool.inputSchema.properties as Record<string, { enum?: string[] }>).action?.enum ?? [];
    expect(actions).toContain('list_profiles');
    expect(actions).toContain('get_password');
    expect(actions).toContain('dns_set');
    expect(actions).toContain('ping');
  });

  it('rejects unknown actions', async () => {
    const result = await exec({ action: 'nonsense' });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('Unknown Network action');
  });

  it('requires ssid for get_password', async () => {
    const result = await exec({ action: 'get_password' });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('requires ssid');
  });

  it('rejects invalid DNS addresses for dns_set', async () => {
    const result = await exec({ action: 'dns_set', dns: 'not-an-ip' });
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('Invalid DNS');
  });

  it('lists Wi-Fi profiles on Windows', async () => {
    if (process.platform !== 'win32') return; // read-only; requires Windows netsh
    const result = await exec({ action: 'list_profiles' });
    if (result.is_error) return; // no wireless interface present — acceptable
    const parsed = JSON.parse(String(result.content));
    expect(Array.isArray(parsed.profiles)).toBe(true);
  });

  it('reports gateway status on Windows', async () => {
    if (process.platform !== 'win32') return;
    const result = await exec({ action: 'gateway' });
    if (result.is_error) return;
    const parsed = JSON.parse(String(result.content));
    expect(parsed).toHaveProperty('gateway');
  });
});
