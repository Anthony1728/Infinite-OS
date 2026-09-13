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
});
