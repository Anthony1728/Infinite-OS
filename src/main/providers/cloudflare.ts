/**
 * Cloudflare Workers AI — OpenAI-compatible chat completions, but the account
 * ID lives in the URL path, so the shared factory's static base URL is not
 * enough. This wrapper resolves
 * https://api.cloudflare.com/client/v4/accounts/{id}/ai/v1 per call from the
 * `cloudflareAccountId` setting (Settings → Providers → Cloudflare).
 */
import { openaiCompatible } from './openai-compatible.js';
import type { ModelInfo } from '../../shared/types.js';

const FREE_FALLBACK: ModelInfo[] = [
  { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Fast (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
];

export async function cloudflareBaseUrl(): Promise<string> {
  const { settings } = await import('../settings/store.js');
  const account = String(settings.get('cloudflareAccountId') ?? '').trim();
  if (!account) {
    throw new Error('Cloudflare account ID is missing — set it in Settings → Providers → Cloudflare (find it in your Cloudflare dashboard URL).');
  }
  return `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
}

const base = openaiCompatible({
  id: 'cloudflare',
  label: 'Cloudflare Workers AI',
  defaultBaseUrl: 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1',
  defaultModel: '@cf/meta/llama-3.1-8b-instruct',
  freeModels: FREE_FALLBACK,
  homepage: 'https://developers.cloudflare.com/workers-ai/',
});

export const cloudflare = {
  ...base,
  // Workers AI has no GET /models route (405) — prove the token + account
  // with a 1-token completion instead.
  async testConnection(apiKey: string) {
    try {
      const url = `${await cloudflareBaseUrl()}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '@cf/meta/llama-3.1-8b-instruct', messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 404) return { ok: false, error: 'HTTP 404 — check the account ID.' };
      if (res.status === 401 || res.status === 403) {
        // Cloudflare names the real cause in the body (wrong token vs wrong
        // account vs missing permission) — surface it instead of a bare 401.
        let detail = '';
        try {
          const body = (await res.json()) as { errors?: Array<{ code?: number; message?: string }> };
          const first = body?.errors?.[0]?.message;
          if (first) detail = ` — ${first.slice(0, 160)}`;
        } catch { /* fall back to the status-only message */ }
        return { ok: false, error: `HTTP ${res.status} — API token rejected.${detail}` };
      }
      if (res.status === 429) return { ok: false, error: 'HTTP 429 — daily Neurons cap reached, retries tomorrow.' };
      return { ok: res.ok, error: res.ok ? undefined : `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
  async listModels(apiKey: string) {
    try {
      return await base.listModels(apiKey, await cloudflareBaseUrl());
    } catch {
      return FREE_FALLBACK;
    }
  },
  async *streamChat(req: Parameters<typeof base.streamChat>[0], apiKey: string) {
    yield* base.streamChat(req, apiKey, await cloudflareBaseUrl());
  },
};
