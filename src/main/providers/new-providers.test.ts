import { afterEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, unknown>();

vi.mock('../settings/store.js', () => ({
  settings: { get: (key: string) => values.get(key) },
}));

import { cloudflare, cloudflareBaseUrl } from './cloudflare.js';
import { extractCatalogEntries, openaiCompatible } from './openai-compatible.js';
import { getProvider } from './registry.js';

describe('new providers', () => {
  it('registers apinex and cloudflare in the provider registry', () => {
    const apinex = getProvider('apinex');
    expect(apinex?.label).toBe('APInex');
    expect(apinex?.defaultBaseUrl).toBe('https://api.apinex.bond/v1');
    expect(apinex?.freeModels.some((m) => m.id === 'free/muse-spark-1.3')).toBe(true);
    const cf = getProvider('cloudflare');
    expect(cf?.label).toBe('Cloudflare Workers AI');
    expect(cloudflare.id).toBe('cloudflare');
    const bm = getProvider('bluesminds');
    expect(bm?.label).toBe('BlueSminds');
    expect(bm?.defaultBaseUrl).toBe('https://api.bluesminds.com/v1');
    expect(bm?.freeModels.some((m) => m.id === 'gemini-2.0-flash')).toBe(true);
  });

  it('builds the account-scoped Workers AI URL', async () => {
    values.set('cloudflareAccountId', 'abc123');
    await expect(cloudflareBaseUrl()).resolves.toBe(
      'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1',
    );
    values.set('cloudflareAccountId', '  ');
    await expect(cloudflareBaseUrl()).rejects.toThrow('account ID is missing');
    values.delete('cloudflareAccountId');
    await expect(cloudflareBaseUrl()).rejects.toThrow('account ID is missing');
  });
});

describe('gateway catalog discovery (apinex / bluesminds)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function gatewayAdapter() {
    return openaiCompatible({
      id: 'probe-gateway',
      label: 'Probe Gateway',
      defaultBaseUrl: 'https://example.test/v1',
      defaultModel: 'probe-default',
      freeModels: [{ id: 'probe-default', label: 'Default', provider: 'probe-gateway', free: true, supports_tools: true }],
      gatewayCatalog: true,
    });
  }

  it('accepts every catalog envelope gateways actually return', () => {
    expect(extractCatalogEntries({ data: [{ id: 'a' }] })).toHaveLength(1);
    expect(extractCatalogEntries({ models: [{ id: 'b' }] })).toHaveLength(1);
    expect(extractCatalogEntries({ result: [{ id: 'c' }] })).toHaveLength(1);
    expect(extractCatalogEntries([{ id: 'd' }])).toHaveLength(1);
    expect(extractCatalogEntries({ data: [] })).toHaveLength(0);
    expect(extractCatalogEntries(null)).toHaveLength(0);
  });

  it('tags every live catalog entry with its own provider id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ id: 'x-1', name: 'X One' }] }), { status: 200 }),
    );
    const models = await gatewayAdapter().listModels('k');
    expect(models.some((m) => m.id === 'x-1' && m.provider === 'probe-gateway')).toBe(true);
  });

  it('validates the key with a chat probe when the catalog route is missing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/models')) return new Response('not found', { status: 404 });
      if (url.endsWith('/chat/completions')) return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch);
    const result = await gatewayAdapter().testConnection('good-key');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a bad key without a chat probe', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('unauthorized', { status: 401 }),
    );
    const result = await gatewayAdapter().testConnection('bad-key');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rejected/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a model-naming 404 from the chat probe as a valid key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/models')) return new Response('gone', { status: 404 });
      return new Response(JSON.stringify({ error: { message: 'model probe-default not found', code: 404 } }), { status: 404 });
    }) as typeof fetch);
    const result = await gatewayAdapter().testConnection('good-key');
    expect(result.ok).toBe(true);
  });
});

describe('cloudflare key validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    values.delete('cloudflareAccountId');
  });
  it('walks past a retired model instead of failing a valid key', async () => {
    values.set('cloudflareAccountId', 'abc123');
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (_input: unknown, init?: { body?: unknown }) => {
      const model = String((JSON.parse(String((init as { body?: string }).body)) as { model?: string }).model ?? '');
      seen.push(model);
      if (seen.length === 1) return new Response(JSON.stringify({ errors: [{ message: 'model not found' }] }), { status: 404 });
      return new Response(JSON.stringify({ result: { response: 'ok' } }), { status: 200 });
    }) as typeof fetch);
    const result = await cloudflare.testConnection('good-token');
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
  });

  it('blames the account ID when every model 404s', async () => {
    values.set('cloudflareAccountId', 'wrong');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'no such model' }] }), { status: 404 }),
    );
    const result = await cloudflare.testConnection('some-token');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/account ID/i);
  });

  it('fails a turn as a plain error chunk when the account ID is missing', async () => {
    values.delete('cloudflareAccountId');
    const chunks = [];
    for await (const chunk of cloudflare.streamChat(
      { model: '@cf/meta/llama-3.1-8b-instruct', messages: [], stream: true },
      'some-token',
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect((chunks[0] as { error: string }).error).toMatch(/account ID is missing/i);
  });
});

describe('gateway catalog honesty (apinex free/ vs paid)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function apinexAdapter() {
    return openaiCompatible({
      id: 'apinex',
      label: 'APInex',
      defaultBaseUrl: 'https://api.apinex.bond/v1',
      defaultModel: 'free/muse-spark-1.3',
      freeModels: [{ id: 'free/muse-spark-1.3', label: 'Muse Spark 1.3 (free)', provider: 'apinex', free: true, supports_tools: true }],
      gatewayCatalog: true,
      freePattern: /^free\//,
    });
  }

  it('badges free/ ids free and lists paid ids without the badge', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [
        { id: 'free/muse-spark-1.3', name: 'Muse Spark 1.3', dollarsPer1M: 0.25 },
        { id: 'deepseek-v4.1-flash', name: 'Deepseek V4.1 Flash', dollarsPer1M: 0.06 },
        { id: 'free/unlisted-model', name: 'Unlisted Free Model' },
        { id: 'paid-unlisted-model', name: 'Unlisted Paid Model' },
      ] }), { status: 200 }),
    );
    const models = await apinexAdapter().listModels('k');
    const spark = models.find((m) => m.id === 'free/muse-spark-1.3');
    const deepseek = models.find((m) => m.id === 'deepseek-v4.1-flash');
    // Both usable on the key: both list…
    expect(spark).toBeDefined();
    expect(deepseek).toBeDefined();
    // …but only the free/ id wears the Free badge, and every entry is
    // tagged with this provider's own id.
    expect(spark?.free).toBe(true);
    expect(deepseek?.free).toBe(false);
    // No pricing info at all: the free/ pattern alone decides the badge.
    expect(models.find((m) => m.id === 'free/unlisted-model')?.free).toBe(true);
    expect(models.find((m) => m.id === 'paid-unlisted-model')?.free).toBe(false);
    expect(models.every((m) => m.provider === 'apinex')).toBe(true);
  });

  it('parses the live public-catalog shape (contextWindow, dollarsPer1M)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [
        { id: 'free/gemini-3.8-flash', provider: 'Free', name: 'Gemini 3.8 Flash', contextWindow: '1M', weight: 4, dollarsPer1M: 1, tags: [], health: 'live' },
      ] }), { status: 200 }),
    );
    const models = await apinexAdapter().listModels('k');
    expect(models).toHaveLength(1);
    expect(models[0].context_window).toBe(1_000_000);
  });

  it('accepts a `model` field as the id and skips display-name-only entries', async () => {
    const adapter = openaiCompatible({
      id: 'probe-gateway-2',
      label: 'Probe',
      defaultBaseUrl: 'https://example.test/v1',
      defaultModel: 'probe-default',
      freeModels: [{ id: 'probe-default', label: 'Default', provider: 'probe-gateway-2', free: true, supports_tools: true }],
      gatewayCatalog: true,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [
        { model: 'alt-id-model' },
        { name: 'Just A Display Name' },
      ] }), { status: 200 }),
    );
    const models = await adapter.listModels('k');
    expect(models.some((m) => m.id === 'alt-id-model')).toBe(true);
    expect(models.some((m) => m.id === 'Just A Display Name')).toBe(false);
  });

  it('accepts doubly-nested catalog envelopes', async () => {
    const { extractCatalogEntries } = await import('./openai-compatible.js');
    expect(extractCatalogEntries({ data: { data: [{ id: 'a' }] } })).toHaveLength(1);
    expect(extractCatalogEntries({ data: { result: [{ id: 'b' }] } })).toHaveLength(1);
    expect(extractCatalogEntries({ data: { models: [{ id: 'c' }] } })).toHaveLength(1);
  });

  it('suffixes gateway-routed models with their upstream vendor', async () => {
    const adapter = openaiCompatible({
      id: 'bluesminds',
      label: 'BlueSminds',
      defaultBaseUrl: 'https://api.bluesminds.com/v1',
      defaultModel: 'gpt-4o',
      freeModels: [{ id: 'gpt-4o', label: 'GPT-4o', provider: 'bluesminds', free: true, supports_tools: true }],
      gatewayCatalog: true,
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [
        { id: 'gpt-4o', provider: 'OpenAI' },
        { id: 'own-model', provider: 'bluesminds' },
      ] }), { status: 200 }),
    );
    const models = await adapter.listModels('k');
    const routed = models.find((m) => m.id === 'gpt-4o');
    expect(routed?.provider).toBe('bluesminds');
    expect(routed?.label).toMatch(/OpenAI/);
    expect(models.find((m) => m.id === 'own-model')?.label).toBe('own-model');
  });
});
