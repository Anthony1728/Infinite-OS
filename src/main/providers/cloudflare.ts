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
  { id: '@cf/meta/llama-3.1-8b-instruct-fast', label: 'Llama 3.1 8B Fast (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B Fast (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', label: 'Qwen 3 30B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/google/gemma-3-12b-it', label: 'Gemma 3 12B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/openai/gpt-oss-20b', label: 'GPT-OSS 20B (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
  { id: '@cf/zai-org/glm-4.7-flash', label: 'GLM 4.7 Flash (Workers AI)', provider: 'cloudflare', free: true, supports_tools: true },
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
  // with a 1-token completion. Walk the known catalog so one retired model
  // id can never fail an otherwise valid key + account pair.
  async testConnection(apiKey: string) {
    let base: string;
    try {
      base = await cloudflareBaseUrl();
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    const candidates = ['@cf/meta/llama-3.1-8b-instruct', ...FREE_FALLBACK.map((m) => m.id)];
    const seen = new Set<string>();
    let lastError = '';
    for (const model of candidates) {
      if (seen.has(model)) continue;
      seen.add(model);
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(20000),
        });
        if (res.ok) return { ok: true };
        if (res.status === 404) {
          // One retired model id must not fail a valid key — and if every
          // model 404s, the account ID itself is wrong.
          lastError = `HTTP 404 — check the account ID.`;
          continue;
        }
        if (res.status === 401 || res.status === 403) {
          // Cloudflare names the real cause in the body (wrong token vs wrong
          // account vs missing permission) — surface it instead of a bare 401.
          let detail = '';
          try {
            const body = (await res.json()) as { errors?: Array<{ code?: number; message?: string }> };
            const first = body?.errors?.[0]?.message;
            if (first) detail = ` — ${first.slice(0, 160)}`;
          } catch { /* fall back to the status-only message */ }
          const hint = detail ? '' : ' Check the token belongs to the same account as the account ID above, and that the token has the Workers AI Read permission (recreate it from the Workers AI setup template).';
          return { ok: false, error: `HTTP ${res.status} — API token rejected.${detail}${hint}` };
        }
        if (res.status === 429) return { ok: false, error: 'HTTP 429 — daily Neurons cap reached, retries tomorrow.' };
        return { ok: false, error: `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    }
    return { ok: false, error: lastError || 'No usable Workers AI model answered.' };
  },
  async listModels(apiKey: string) {
    try {
      return await base.listModels(apiKey, await cloudflareBaseUrl());
    } catch {
      return FREE_FALLBACK;
    }
  },
  async *streamChat(req: Parameters<typeof base.streamChat>[0], apiKey: string) {
    // A missing account ID must fail as a plain chat error, never as a
    // thrown exception that could wedge the turn.
    let url: string;
    try {
      url = await cloudflareBaseUrl();
    } catch (e) {
      yield { type: 'error' as const, error: (e as Error).message };
      return;
    }
    yield* base.streamChat(req, apiKey, url);
  },
};
