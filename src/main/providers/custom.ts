/**
 * Custom provider — bring your own OpenAI-compatible endpoint.
 * The user supplies the base URL (e.g. https://my-gateway.example.com/v1),
 * the API key (stored in encrypted secrets like every other provider), and
 * the model ID. Anything reachable over POST {base}/chat/completions works:
 * private gateways, local servers, new providers we haven't registered yet.
 */
import { openaiCompatible } from './openai-compatible.js';
import type { ModelInfo } from '../../shared/types.js';

export async function customSettings(): Promise<{ baseUrl: string; model: string }> {
  const { settings } = await import('../settings/store.js');
  const baseUrl = String(settings.get('customBaseUrl') ?? '').trim().replace(/\/+$/, '');
  const model = String(settings.get('customModel') ?? '').trim();
  return { baseUrl, model };
}

function describeMissing(baseUrl: string, model: string): string | null {
  if (!baseUrl && !model) return 'Custom provider is not configured — set the base URL and model ID in Settings → Providers → Custom.';
  if (!baseUrl) return 'Custom provider base URL is missing — set it in Settings → Providers → Custom.';
  if (!model) return 'Custom provider model ID is missing — set it in Settings → Providers → Custom.';
  return null;
}

const base = openaiCompatible({
  id: 'custom',
  label: 'Custom',
  defaultBaseUrl: '',
  defaultModel: '',
  freeModels: [],
  homepage: undefined,
});

export const custom = {
  ...base,
  id: 'custom',
  label: 'Custom',
  requiresApiKey: true as const,
  defaultBaseUrl: '',
  defaultModel: '',
  freeModels: [] as ModelInfo[],

  async testConnection(apiKey: string) {
    const { baseUrl, model } = await customSettings();
    const missing = describeMissing(baseUrl, model);
    if (missing) return { ok: false, error: missing };
    if (!apiKey) return { ok: false, error: 'No API key saved for Custom — paste one and try again.' };
    return base.testConnection(apiKey, baseUrl);
  },

  async listModels(apiKey: string) {
    const { baseUrl, model } = await customSettings();
    const missing = describeMissing(baseUrl, model);
    if (missing) return [];
    try {
      const live = await base.listModels(apiKey, baseUrl);
      // The live catalog is authoritative when the endpoint exposes one…
      if (live.length > 0) return live;
    } catch { /* …otherwise fall through to the configured model */ }
    return [{ id: model, label: model, provider: 'custom', free: true, supports_tools: true }];
  },

  async *streamChat(req: Parameters<typeof base.streamChat>[0], apiKey: string) {
    const { baseUrl, model } = await customSettings();
    const missing = describeMissing(baseUrl, model);
    if (missing) {
      yield { type: 'error' as const, error: missing };
      return;
    }
    yield* base.streamChat({ ...req, model: req.model || model }, apiKey, baseUrl);
  },
};
