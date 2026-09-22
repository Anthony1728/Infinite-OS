import { afterEach, describe, expect, it, vi } from 'vitest';

const runHandler: { fn: ((args: Record<string, unknown>) => Promise<{ output: unknown }>) | null } = { fn: null };

vi.mock('@codebuff/sdk', () => ({
  CodebuffClient: class {
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
    }
    async run(args: Record<string, unknown>) {
      if (!runHandler.fn) throw new Error('run handler not set');
      return runHandler.fn(args);
    }
  },
}));

import { buildFreebuffCatalog, freebuff, getFreebuffCredentials, hasInstalledFreebuffCli, resolveFreebuffAgent } from './freebuff.js';
import type { ChatRequest } from './base.js';
import type { Message } from '../../shared/types.js';

function chatRequest(text: string, model = 'z-ai/glm-5.3-flash'): ChatRequest {
  const message: Message = { id: 'm1', role: 'user', timestamp: Date.now(), content: [{ type: 'text', text }] };
  return { model, messages: [message], stream: true };
}

async function collect(req: ChatRequest): Promise<Array<{ type: string } & Record<string, unknown>>> {
  const chunks = [];
  for await (const chunk of freebuff.streamChat(req, '')) chunks.push(chunk);
  return chunks;
}

describe('freebuff provider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    runHandler.fn = null;
  });

  it('rejects unknown models without touching the network', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const chunks = await collect(chatRequest('hi', 'nope/not-a-model'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect(String((chunks[0] as unknown as { error: string }).error)).toMatch(/Unknown Freebuff model/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for `freebuff login` when the stored credential is rejected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    const result = await freebuff.testConnection('');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/freebuff login/);
  });

  it('reports the CLI missing when no binary exists', async () => {
    if (hasInstalledFreebuffCli()) return; // covered on machines without the CLI
    const result = await freebuff.testConnection('');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not installed/);
    await expect(freebuff.listModels('')).resolves.toEqual([]);
  });

  it('lists the free catalog when the CLI is installed', async () => {
    if (!hasInstalledFreebuffCli()) return; // covered on machines with the CLI
    const models = await freebuff.listModels('');
    expect(models.length).toBeGreaterThanOrEqual(10);
    expect(models.every((m) => m.provider === 'freebuff' && m.free)).toBe(true);
    expect(models.some((m) => m.id === 'z-ai/glm-5.3-flash')).toBe(true);
  });

  it('surfaces rate limits as plain errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/session/admission')) {
        return Response.json({ status: 'rate_limited' }, { status: 429 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const chunks = await collect(chatRequest('hi'));
    expect(chunks[chunks.length - 1].type).toBe('error');
    expect(String((chunks[chunks.length - 1] as unknown as { error: string }).error)).toMatch(/rate-limited/i);
  });

  it('streams an admitted turn and releases the slot', async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      seen.push(`${(init as { method?: string })?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/session/admission')) {
        return Response.json({ status: 'active', instanceId: 'inst-1', model: 'z-ai/glm-5.3-flash' });
      }
      if (url.endsWith('/session')) {
        return Response.json({ status: 'ended' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    let captured: Record<string, unknown> = {};
    runHandler.fn = async (args) => {
      captured = args;
      const onChunk = args.handleStreamChunk as (c: unknown) => void;
      onChunk('hello ');
      onChunk('world');
      return { output: { type: 'text', message: 'hello world' } };
    };
    const chunks = await collect(chatRequest('hi'));
    expect(chunks.map((c) => c.type)).toEqual([
      'provider_status',
      'provider_status',
      'text_delta',
      'text_delta',
      'message_end',
    ]);
    expect(chunks.filter((c) => c.type === 'text_delta').map((c) => (c as unknown as { text: string }).text).join('')).toBe('hello world');
    // Admission carried the model; run used the model's first-party agent in free mode.
    expect(captured.agent).toBe('base3-free-glm-5-3-flash');
    expect(captured.costMode).toBe('free');
    // Slot released after the turn — through www (the apex redirects and
    // cross-host redirects strip the Authorization header).
    expect(seen).toContain('DELETE https://www.codebuff.com/api/v1/freebuff/session');
    expect(seen.some((call) => call.includes('https://codebuff.com/'))).toBe(false);
  });

  it('reads the installed CLI credential when present', async () => {
    const creds = await getFreebuffCredentials();
    expect(creds === null || typeof creds.authToken === 'string').toBe(true);
  });

  it('merges server price-table models into the catalog without losing known rows', () => {
    const catalog = buildFreebuffCatalog(['brand/new-model', 'z-ai/glm-5.3-flash']);
    expect(catalog.some((m) => m.id === 'brand/new-model')).toBe(true);
    expect(catalog.some((m) => m.id === 'z-ai/glm-5.3-flash' && m.label === 'GLM 5.3 Flash')).toBe(true);
    expect(new Set(catalog.map((m) => m.id)).size).toBe(catalog.length);
  });

  it('derives agent ids for unknown server rows and keeps exact ids for known rows', () => {
    expect(resolveFreebuffAgent('z-ai/glm-5.3-flash').agent).toBe('base3-free-glm-5-3-flash');
    const derived = resolveFreebuffAgent('brand/new-model');
    expect(derived.agent).toBe('base3-free-new-model');
  });

  it('admits and runs a model that is only in the server price table', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/session/admission')) {
        expect((init as { headers?: Record<string, string> })?.headers?.['x-freebuff-model']).toBe('brand/new-model');
        return Response.json({ status: 'active', instanceId: 'inst-live', model: 'brand/new-model' });
      }
      if (url.endsWith('/session') && (init as { method?: string })?.method === 'DELETE') return Response.json({ status: 'ended' });
      if (url.endsWith('/session')) {
        return Response.json({ status: 'none', prices: { 'z-ai/glm-5.3-flash': 5, 'brand/new-model': 5 } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    // Real flow: the picker lists models first; streamChat accepts what it listed.
    const listed = await freebuff.listModels('');
    expect(listed.some((m) => m.id === 'brand/new-model')).toBe(true);
    runHandler.fn = async (args) => {
      expect(args.agent).toBe('base3-free-new-model');
      return { output: { type: 'text', message: 'live model replied' } };
    };
    const chunks = await collect(chatRequest('hi', 'brand/new-model'));
    expect(chunks[chunks.length - 1].type).toBe('message_end');
    expect(chunks.some((c) => (c as unknown as { text?: string }).text === 'live model replied')).toBe(true);
  });
});
