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
  async testConnection(apiKey: string) {
    return base.testConnection(apiKey, await cloudflareBaseUrl());
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
