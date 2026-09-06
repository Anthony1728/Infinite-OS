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
