import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { bridgeServer } from './server.js';
import type { BridgeStatus } from './server.js';

const TOKEN_FILE = join(homedir(), '.infinite-ai', 'bridge-token');
const BASE_URL = 'http://127.0.0.1:8765';

let testToken = '';

describe('BridgeServer', () => {
  beforeAll(async () => {
    await bridgeServer.start();
    try {
      testToken = readFileSync(TOKEN_FILE, 'utf8').trim();
    } catch {
      testToken = '';
    }
  });

  afterAll(() => {
    bridgeServer.stop();
  });

  it('serves a healthz endpoint without authentication', async () => {
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { ok: boolean; ts: number };
    expect(data.ok).toBe(true);
    expect(data.ts).toBeTypeOf('number');
  });

  it('rejects /status without a token', async () => {
    const res = await fetch(`${BASE_URL}/status`);
    expect(res.status).toBe(401);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(false);
  });

  it('serves /status with a valid token', async () => {
    const res = await fetch(`${BASE_URL}/status?token=${encodeURIComponent(testToken)}`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { ok: boolean; status: BridgeStatus };
    expect(data.ok).toBe(true);
    expect(data.status).toHaveProperty('connected');
    expect(data.status).toHaveProperty('port', 8765);
    expect(data.status).toHaveProperty('commandsServed');
    expect(typeof data.status.commandsServed).toBe('number');
  });

  it('returns "not connected" from exec() when no extension is connected', async () => {
    const result = await bridgeServer.exec('list_tabs', {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected bridge exec to fail while disconnected.');
    expect(result.error).toContain('not connected');
  });

  it('returns "not connected" from exec() for ping command', async () => {
    const result = await bridgeServer.exec('ping', {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected bridge exec to fail while disconnected.');
    expect(result.error).toContain('not connected');
  });

  it('exposes a status object with expected fields', () => {
    const status = bridgeServer.getStatus();
    expect(status).toHaveProperty('connected', false);
    expect(status).toHaveProperty('port', 8765);
    expect(status).toHaveProperty('tokenConfigured', testToken.length > 0);
    expect(status).toHaveProperty('commandsServed');
    expect(status).toHaveProperty('lastError');
    expect(status).toHaveProperty('connectedAt', null);
  });
});
