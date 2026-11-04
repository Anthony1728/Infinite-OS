import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

vi.mock('../agent/active-model.js', () => ({
  resolveActiveModel: () => ({ provider: 'opencode', model: 'opencode::pulse-alpha-free', cwd: '.' }),
  NoActiveModelError: class NoActiveModelError extends Error {
    constructor() {
      super('No AI provider selected in Infinite OS.');
      this.name = 'NoActiveModelError';
    }
  },
}));

vi.mock('../agent/loop.js', () => ({
  runAgent: vi.fn(async (history: unknown[], userMessage: unknown, opts: { onEvent?: (ev: unknown) => void }) => {
    opts.onEvent?.({ type: 'assistant_start' });
    opts.onEvent?.({ type: 'text_delta', text: 'hello from smoke test' });
    opts.onEvent?.({ type: 'done', success: true });
    return [
      ...(history as never[]),
      userMessage as never,
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'hello from smoke test' }], timestamp: Date.now() } as never,
    ];
  }),
}));

vi.mock('../session/store.js', () => ({
  loadMessages: vi.fn(async () => []),
  appendMessage: vi.fn(async () => undefined),
}));

process.env.INFINITE_REMOTE_PORT = '8799';

describe('phone remote server smoke', () => {
  let server: typeof import('./server.js').phoneRemoteServer;
  let token = '';

  beforeAll(async () => {
    const mod = await import('./server.js');
    server = mod.phoneRemoteServer;
    server.start();
    await new Promise((r) => setTimeout(r, 300));
    const tokenPath = join(homedir(), '.infinite-ai', 'remote-token');
    token = existsSync(tokenPath) ? readFileSync(tokenPath, 'utf-8').trim() : '';
  });

  afterAll(() => {
    server.stop();
  });

  it('reports listening info with a phone URL and port', async () => {
    const info = await server.getInfo();
    expect(info.running).toBe(true);
    expect(info.port).toBe(8799);
    expect(info.url).toContain(`:${8799}/?token=`);
    expect(info.qrDataUrl.length).toBeGreaterThan(10);
  });

  it('rejects bad tokens with 401', async () => {
    const res = await fetch('http://127.0.0.1:8799/?token=wrong');
    expect(res.status).toBe(401);
  });

  it('serves the phone page with the fixed token handling', async () => {
    const res = await fetch(`http://127.0.0.1:8799/?token=${token}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Infinite OS');
    expect(html).toContain('URLSearchParams');
    expect(html).not.toContain('location.search.slice(1)');
    expect(html).toContain('/api/history');
    expect(html).toContain('id="stop"');
    expect(html).toContain('Reasoning');
  });

  it('status endpoint answers with ok:true for valid token', async () => {
    const res = await fetch(`http://127.0.0.1:8799/api/status?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; app: string };
    expect(body.ok).toBe(true);
    expect(body.app).toBe('Infinite OS');
  });

  it('history endpoint answers with a messages array for valid token', async () => {
    const res = await fetch(`http://127.0.0.1:8799/api/history?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('history endpoint rejects a bad token', async () => {
    const res = await fetch('http://127.0.0.1:8799/api/history?token=wrong');
    expect(res.status).toBe(401);
  });

  it('rejects an empty chat message with 400', async () => {
    const res = await fetch(`http://127.0.0.1:8799/api/chat?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('accepts a chat message and completes the mocked turn', async () => {
    const res = await fetch(`http://127.0.0.1:8799/api/chat?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 300));
    const info = await server.getInfo();
    expect(info.busy).toBe(false);
  });
});
