import { describe, expect, it, vi } from 'vitest';

const values = new Map<string, unknown>();

vi.mock('../settings/store.js', () => ({
  settings: { get: (key: string) => values.get(key) },
}));

import { cloudflare, cloudflareBaseUrl } from './cloudflare.js';
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
