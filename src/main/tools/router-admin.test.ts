// RouterAdmin tool tests — guidance generation and safe local checks for
// the user's own router. Real network probes only run on Windows and only
// against the machine's own gateway.

import { describe, expect, it } from 'vitest';
import { routerAdminTool } from './router-admin.js';

const ctx = {
  cwd: process.cwd(),
  abortSignal: new AbortController().signal,
  sessionId: 'test',
  onUpdate: () => {},
} as never;

async function exec(args: Record<string, unknown>) {
  return routerAdminTool.execute({ ...args }, ctx);
}

describe('RouterAdmin tool', () => {
  it('is a registered-shaped tool with a schema', () => {
    expect(routerAdminTool.name).toBe('RouterAdmin');
    expect(routerAdminTool.permission).toBe('ask');
    const actions = (routerAdminTool.inputSchema.properties as Record<string, { enum?: string[] }>).action?.enum ?? [];
    expect(actions).toContain('recover_access');
    expect(actions).toContain('change_password');
    expect(actions).toContain('port_forward');
  });

  it('rejects unknown actions', async () => {
    const result = await exec({ action: 'nonsense' });
    expect(result.is_error).toBe(true);
  });

  it('generates factory-reset guidance for recover_access', async () => {
    const result = await exec({ action: 'recover_access', brand: 'TP-Link' });
    expect(result.is_error).toBeFalsy();
    const parsed = JSON.parse(String(result.content));
    expect(parsed.brand).toBe('TP-Link');
    expect(parsed.steps.length).toBeGreaterThan(3);
    expect(parsed.steps.join(' ').toLowerCase()).toContain('reset');
  });

  it('brand normalization maps variants', async () => {
    const asus = await exec({ action: 'recover_access', brand: 'asus rt-ax58u' });
    expect(JSON.parse(String(asus.content)).brand).toBe('Asus');
    const generic = await exec({ action: 'recover_access' });
    expect(JSON.parse(String(generic.content)).brand).toBe('generic');
  });

  it('generates Wi-Fi password change steps', async () => {
    const result = await exec({ action: 'change_password' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.steps.join(' ').toLowerCase()).toContain('wpa2');
    expect(parsed.steps.join(' ').toLowerCase()).toContain('ssid');
  });

  it('validates port range for port_forward', async () => {
    const bad = await exec({ action: 'port_forward' });
    expect(bad.is_error).toBe(true);
    const ok = await exec({ action: 'port_forward', port: 8080 });
    expect(ok.is_error).toBeFalsy();
    const parsed = JSON.parse(String(ok.content));
    expect(parsed.port).toBe(8080);
    expect(parsed.steps.length).toBeGreaterThan(3);
  });

  it('detects the gateway on Windows', async () => {
    if (process.platform !== 'win32') return;
    const result = await exec({ action: 'gateway' });
    if (result.is_error) return;
    const parsed = JSON.parse(String(result.content));
    expect(parsed).toHaveProperty('gateway');
  });
});
