// Shared Ollama utilities — auto-start, health check, model listing.
// Used by both the provider adapter and OllamaBrain.

import { spawn } from 'node:child_process';

const OLLAMA_URL = 'http://localhost:11434';
let serviceStartAttempted = false;

/**
 * Ensure Ollama is running. If not, attempt to start it.
 * Returns true if Ollama is reachable after this call.
 */
export async function ensureOllamaRunning(): Promise<boolean> {
  // Quick check — is it already up?
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return true;
  } catch { /* not running */ }

  // Already tried starting once this process lifetime — don't spam.
  if (serviceStartAttempted) return false;
  serviceStartAttempted = true;

  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.on('error', () => { /* Ollama binary not found — graceful fallback */ });
    child.unref();

    // Poll up to 10 seconds for Ollama to come up.
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
        if (response.ok) return true;
      } catch { /* keep polling during startup */ }
    }
  } catch { /* Ollama is optional and may not be installed */ }

  // Allow retry later (e.g. user installs Ollama after first failure).
  serviceStartAttempted = false;
  return false;
}

/**
 * List models currently installed in the local Ollama instance.
 */
export async function listOllamaModels(): Promise<Array<{ id: string; label: string; provider: 'ollama'; free: boolean }>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
    return (data.models ?? []).map((m) => ({
      id: m.name,
      label: m.name.replace(':latest', ''),
      provider: 'ollama' as const,
      free: true,
    }));
  } catch {
    return [];
  }
}

/**
 * Resolve the model to actually send to Ollama.
 * The UI may request a model that was uninstalled (e.g. minicpm-v4.6) while
 * the user has a different model installed (e.g. qwen3:4b). Never send a
 * non-existent model name to Ollama — it returns 404 and the chat silently
 * dies. Resolution order: exact → base-name → size-tier → first installed.
 */
export function resolveOllamaModel(requested: string, installed: string[]): string {
  if (!requested) return installed[0] ?? '';
  if (installed.includes(requested)) return requested;
  const base = requested.split(':')[0].toLowerCase();
  const fuzzy = installed.find((m) => m.toLowerCase().startsWith(base));
  if (fuzzy) return fuzzy;
  // Size-tier match (4b request → any installed 4b model, etc.)
  const size = requested.match(/\b\d+(?:\.\d+)?b\b/i)?.[0]?.toLowerCase();
  if (size) {
    const sized = installed.find((m) => m.toLowerCase().includes(size));
    if (sized) return sized;
  }
  return installed[0] ?? requested;
}

/**
 * Test if Ollama is reachable and has at least one model.
 */
export async function testOllamaConnection(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `Ollama returned HTTP ${res.status}.` };
    const data = (await res.json()) as { models?: unknown[] };
    return data.models?.length
      ? { ok: true }
      : { ok: false, error: 'Ollama is running, but no models are installed.' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export { OLLAMA_URL };
