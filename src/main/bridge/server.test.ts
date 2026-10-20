import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { connect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { bridgeServer } from './server.js';
import type { BridgeStatus } from './server.js';

/**
 * The bridge binds the port a real browser extension connects to.
 *
 * `start()` had no port parameter, so this test always served on 8765 — the
 * production port. Anything already talking to it could attach mid-test, and
 * because `exec()` only returns "not connected" while `status.connected` is
 * false, three assertions here failed whenever the extension happened to be
 * running. They passed on a quiet machine and failed on a busy one, which is
 * the worst kind of test failure: it looks like a regression and is not.
 *
 * Binding an ephemeral port makes the suite hermetic. The tests below care about
 * the server's behaviour, never about which port it uses.
 */

const TOKEN_FILE = join(homedir(), '.infinite-ai', 'bridge-token');

// Port 0 lets the OS pick a free port, so nothing external can reach it.
const TEST_PORT = 0;
let baseUrl = '';
let testToken = '';

/** Complete a WebSocket upgrade by hand (no extension involved). */
function wsUpgrade(port: number, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1');
    const key = randomBytes(16).toString('base64');
    let upgraded = false;
    let buf = Buffer.alloc(0);
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded && buf.includes('\r\n\r\n')) {
        upgraded = true;
        resolve(sock);
      }
    });
    sock.write(
      `GET /bridge?token=${encodeURIComponent(token)} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
    );
  });
}

/** Build a masked client-side WebSocket text frame (RFC 6455). */
function wsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  let header: Buffer;
  if (payload.length <= 125) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }
  return Buffer.concat([header, mask, masked]);
}

async function fetchStatus(): Promise<BridgeStatus> {
  const res = await fetch(`${baseUrl}/status?token=${encodeURIComponent(testToken)}`);
  const data = await res.json() as { status: BridgeStatus };
  return data.status;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('BridgeServer', () => {
  beforeAll(async () => {
    await bridgeServer.start(TEST_PORT);
    baseUrl = `http://127.0.0.1:${bridgeServer.getStatus().port}`;
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
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { ok: boolean; ts: number };
    expect(data.ok).toBe(true);
    expect(data.ts).toBeTypeOf('number');
  });

  it('rejects /status without a token', async () => {
    const res = await fetch(`${baseUrl}/status`);
    expect(res.status).toBe(401);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(false);
  });

  it('serves /status with a valid token', async () => {
    const res = await fetch(`${baseUrl}/status?token=${encodeURIComponent(testToken)}`);
    expect(res.ok).toBe(true);
    const data = await res.json() as { ok: boolean; status: BridgeStatus };
    expect(data.ok).toBe(true);
    expect(data.status).toHaveProperty('connected');
    expect(data.status).toHaveProperty('port', bridgeServer.getStatus().port);
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
    expect(status).toHaveProperty('port', bridgeServer.getStatus().port);
    expect(status).toHaveProperty('tokenConfigured', testToken.length > 0);
    expect(status).toHaveProperty('commandsServed');
    expect(status).toHaveProperty('lastError');
    expect(status).toHaveProperty('connectedAt', null);
  });

  // ── Half-open ("zombie") socket regression ─────────────────────────────────
  // A TCP upgrade alone must never count as a connection. The live bug this
  // guards: Chrome held an Established socket whose MV3 service worker never
  // sent hello — /status reported connected:true with empty extensionId /
  // version / browser and every /exec hung for 45s.

  it('does not report connected from a bare upgrade that never sends hello', async () => {
    const sock = await wsUpgrade(bridgeServer.getStatus().port, testToken);
    try {
      await wait(300);
      const status = await fetchStatus();
      expect(status.connected).toBe(false);
      expect(status.extensionId).toBe('');
    } finally {
      sock.destroy();
    }
  });

  it('drops a hello-less socket within the hello timeout', async () => {
    const sock = await wsUpgrade(bridgeServer.getStatus().port, testToken);
    const closed = new Promise<void>((resolve) => {
      sock.on('close', () => resolve());
      sock.on('error', () => resolve());
    });
    // HELLO_TIMEOUT_MS is 5s — allow slack for CI timing.
    await Promise.race([closed, wait(8000)]);
    expect(sock.destroyed).toBe(true);
    const status = await fetchStatus();
    expect(status.connected).toBe(false);
  }, 10_000);

  it('reports connected with metadata after the extension sends hello', async () => {
    const sock = await wsUpgrade(bridgeServer.getStatus().port, testToken);
    try {
      sock.write(
        wsTextFrame(
          JSON.stringify({
            type: 'hello',
            version: '9.9.9',
            browser: 'TestBrowser/1.0',
            extensionId: 'test-extension-id',
            name: 'Infinite AI Bridge',
          }),
        ),
      );
      let status = await fetchStatus();
      for (let i = 0; i < 20 && !status.connected; i++) {
        await wait(100);
        status = await fetchStatus();
      }
      expect(status.connected).toBe(true);
      expect(status.extensionId).toBe('test-extension-id');
      expect(status.extensionVersion).toBe('9.9.9');
      expect(status.browser).toBe('TestBrowser/1.0');
    } finally {
      sock.destroy();
      await wait(100);
    }
  }, 10_000);
});
