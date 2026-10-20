import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Model commands must be answered by the Brain BEFORE any model is invoked —
// that is the whole point: when the active model is dead, the agent itself
// cannot understand "switch models", so the request must never reach a model.
import { whatsAppLink } from './whatsapp-link.js';

let testHome = '';

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'wa-model-cmd-'));
  process.env.INFINITE_TEST_HOME = testHome;
});

afterEach(async () => {
  whatsAppLink.stop();
  await whatsAppLink.unpair().catch(() => undefined);
  delete process.env.INFINITE_TEST_HOME;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

function mockSocket() {
  const handlers = new Map<string, (d: Record<string, unknown>) => void>();
  const sent: Array<{ jid: string; text: string }> = [];
  return {
    handlers,
    sent,
    sock: {
      user: { id: '15551234567@s.whatsapp.net' },
      ev: { on: (e: string, cb: (d: Record<string, unknown>) => void) => { handlers.set(e, cb); } },
      sendMessage: async (jid: string, c: { text: string }) => {
        sent.push({ jid, text: c.text });
        return { key: { id: `sent-${sent.length}` } };
      },
      end: () => undefined,
    },
  };
}

const selfMsg = (id: string, text: string) => ({
  key: { remoteJid: '15551234567@s.whatsapp.net', id, fromMe: true },
  messageTimestamp: Math.floor(Date.now() / 1000),
  message: { conversation: text },
});

async function boot(settings: Record<string, unknown>) {
  const { handlers, sent, sock } = mockSocket();
  let agentRuns = 0;
  await whatsAppLink.start({
    makeSocket: async () => sock,
    loadAuth: async () => ({ state: {}, saveCreds: async () => undefined }),
    getSetting: ((key: string) => settings[key]) as never,
    runAgentImpl: (async () => {
      agentRuns++;
      return [{ id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'agent-answer' }], timestamp: Date.now() }] as never[];
    }) as never,
  });
  return {
    handlers,
    sent,
    agentRuns: () => agentRuns,
    // Poll for completion instead of sleeping a fixed 150ms: under full-suite
    // load the handler's dynamic imports take longer than any fixed guess.
    send: async (text: string, settled: () => boolean = () => sent.length > 0) => {
      handlers.get('connection.update')!({ connection: 'open' });
      handlers.get('messages.upsert')!({ type: 'notify', messages: [selfMsg(`m-${Date.now()}`, text)] });
      const start = Date.now();
      while (!settled()) {
        if (Date.now() - start > 5_000) {
          throw new Error('message handling did not settle within 5s');
        }
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
}

describe('model commands from the phone', () => {
  it('answers "model status" without ever calling the agent', async () => {
    const w = await boot({ provider: 'groq', model: 'llama-3.3-70b', cwd: 'C:/work' });
    await w.send('model status');

    expect(w.agentRuns()).toBe(0);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toMatch(/Active model/);
    expect(w.sent[0].text).toMatch(/llama-3\.3-70b/);
  });

  it('guides setup when status is asked with nothing selected', async () => {
    const w = await boot({});
    await w.send('which model are you using?');

    expect(w.agentRuns()).toBe(0);
    expect(w.sent[0].text).toMatch(/No model selected/);
    expect(w.sent[0].text).toMatch(/switch to a working model/);
  });

  it('still sends ordinary messages to the agent (no hijacking)', async () => {
    const w = await boot({ provider: 'groq', model: 'llama-3.3-70b', cwd: 'C:/work' });
    await w.send(
      'write a script that switches models on provider errors',
      () => w.agentRuns() > 0 && w.sent.length > 0,
    );

    expect(w.agentRuns()).toBe(1);
    expect(w.sent[0].text).toBe('agent-answer');
  });
});
