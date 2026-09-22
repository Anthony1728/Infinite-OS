// Shared credential resolution for the creative/commerce tools (music, video,
// sell). Mirrors ImageGenerator's rule: saved secret wins, env var is the
// fallback, and the key never appears in tool output or errors.

import { getApiKey } from '../settings/secrets.js';

export async function resolveProviderKey(providerId: string, envVar: string): Promise<string | null> {
  try {
    const saved = await getApiKey(providerId);
    if (saved && saved.trim()) return saved.trim();
  } catch { /* secrets store unavailable — fall through to env */ }
  const env = process.env[envVar];
  return env && env.trim() ? env.trim() : null;
}

/** Strip anything that looks like a key out of provider error bodies. */
export function redact(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/r8_[A-Za-z0-9]{8,}/g, 'r8_***')
    .replace(/[a-f0-9]{32}/gi, '***')
    .slice(0, 300);
}
