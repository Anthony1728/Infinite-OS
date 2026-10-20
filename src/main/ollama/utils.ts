// Shared Ollama utilities — reachability, model listing, and budget selection.
//
// WHAT WAS WRONG, MEASURED ON THIS MACHINE
// (i5-4210U @ 1.7 GHz, 15.9 GB RAM, integrated graphics, no CUDA)
//
//   * `warmLocalModels()` ran at EVERY boot, loaded 1.5-2.5 GB into RAM and
//     pinned it for 30 minutes whether or not the user ever used a local model.
//     That is the "it makes the whole computer slow" complaint, almost exactly.
//   * `keep_alive: '30m'` on every chat meant RAM was never given back.
//   * `num_ctx: 8192` was hardcoded. On a CPU-only small model the KV cache is
//     both the largest memory consumer and the largest per-token cost.
//   * `ensureOllamaRunning()` blocked up to 10 seconds inside `listModels()`
//     and `testConnection()`, so opening the model picker hung.
//   * `/api/tags` was refetched on every single turn — a wasted round trip.
//
// WHAT CHANGED
//
// Warm-up is now opt-in and, when asked for, hardware-aware. Timeouts are short
// and never blocking. The model list is cached and invalidated on demand. All
// generation budgets come from `hardware.ts`, which measures the machine first.

import { spawn } from 'node:child_process';
import { budgetForModel, getHardwareProfile, isModelComfortable, describeHardware } from './hardware.js';

/** Ollama's default port. Overridable for people running it elsewhere. */
const OLLAMA_URL = process.env.INFINITE_OLLAMA_URL ?? 'http://localhost:11434';

/**
 * Short reachability timeout.
 *
 * 5 s was long enough that every unreachable probe stalled the UI, and this
 * endpoint answers in single-digit milliseconds when Ollama is up. A slow answer
 * from localhost is a broken server, not a busy one.
 */
const PROBE_TIMEOUT_MS = 1_500;

// ── Model list cache ────────────────────────────────────────────────────────

let cachedModels: Array<{ name: string; sizeBytes: number; parameterSize?: string; supportsThinking: boolean; supportsTools: boolean }> | null = null;
let cachedAt = 0;

/** How long a cached model list is trusted. Pulls change it, so keep it short. */
const MODEL_CACHE_MS = 30_000;

export interface InstalledModel {
  name: string;
  sizeBytes: number;
  /** "2.0B" etc, when Ollama reports it. */
  parameterSize?: string;
  supportsThinking: boolean;
  supportsTools: boolean;
}

/**
 * Installed models, cached.
 *
 * This used to be fetched inside `streamChat` on every turn purely to resolve
 * the requested model name. On a local server that is a round trip for
 * information that changes only when someone pulls a model.
 */
export async function getInstalledModels(force = false): Promise<InstalledModel[]> {
  if (!force && cachedModels && Date.now() - cachedAt < MODEL_CACHE_MS) {
    return cachedModels;
  }
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) {
      // A failed probe must not poison the cache with an empty list — that
      // would make a working server look like it had no models.
      return cachedModels ?? [];
    }
    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        model?: string;
        size?: number;
        details?: { parameter_size?: string };
        capabilities?: string[];
      }>;
    };
    const parsed = (data.models ?? [])
      .map<InstalledModel | null>((m) => {
        const name = m.name ?? m.model ?? '';
        if (!name) return null;
        const capabilities = m.capabilities ?? [];
        return {
          name,
          sizeBytes: Number(m.size ?? 0),
          ...(m.details?.parameter_size ? { parameterSize: m.details.parameter_size } : {}),
          supportsThinking: capabilities.includes('thinking'),
          supportsTools: capabilities.includes('tools'),
        };
      })
      .filter((m): m is InstalledModel => m !== null);
    cachedModels = parsed;
    cachedAt = Date.now();
    return parsed;
  } catch {
    return cachedModels ?? [];
  }
}

/** Drop the cached list. Called after a pull, and by tests. */
export function invalidateModelCache(): void {
  cachedModels = null;
  cachedAt = 0;
}

// ── Reachability ───────────────────────────────────────────────────────────

let serviceStartAttempted = false;
let lastStartAttemptAt = 0;

/** Do not re-attempt spawning more often than this, so a missing Ollama is cheap. */
const START_RETRY_COOLDOWN_MS = 60_000;

/** Is Ollama answering right now? Never blocks for long, never spawns anything. */
export async function isOllamaReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure Ollama is running, optionally starting it.
 *
 * The `startIfNeeded` flag is the important change: `listModels()` and
 * `testConnection()` used to call this and block for up to 10 seconds inside a
 * spinner. Listing models should answer "it is not running" quickly, not
 * silently try to launch a server the user did not ask for.
 */
export async function ensureOllamaRunning(startIfNeeded = false): Promise<boolean> {
  if (await isOllamaReachable()) return true;
  if (!startIfNeeded) return false;

  // Cooldown, so a missing install does not pay a spawn attempt on every call.
  if (serviceStartAttempted && Date.now() - lastStartAttemptAt < START_RETRY_COOLDOWN_MS) {
    return false;
  }
  serviceStartAttempted = true;
  lastStartAttemptAt = Date.now();

  try {
    const child = spawn('ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.on('error', (err) => {
      // Visible: if Ollama cannot start, local models can never work and every
      // turn would otherwise wait through the poll window for nothing.
      console.warn(`[ollama] could not start server process: ${(err as Error).message}`);
    });
    child.unref();

    // Poll for a few seconds. Ollama is normally already running as a tray app
    // or service, so this only matters on a fresh install.
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (await isOllamaReachable()) return true;
    }
  } catch {
    /* Ollama is optional and may not be installed */
  }
  return false;
}

/**
 * Optional warm-up: load the local model so the first chat is not a cold load.
 *
 * NOT called at boot any more. That is deliberate and is the single biggest
 * responsiveness fix: previously every launch pinned 1.5-2.5 GB of the user's
 * RAM for half an hour whether they wanted a local model or not, which is what
 * made the whole machine feel slow.
 *
 * Now it is called only when the user has actually chosen a local model, and it
 * obeys the machine's budget instead of guessing.
 */
export async function warmLocalModels(preferredModel?: string): Promise<void> {
  const hardware = getHardwareProfile();
  try {
    if (!(await ensureOllamaRunning(false))) return;
    const models = await getInstalledModels();
    if (models.length === 0) return;

    const pick =
      models.find((m) => m.name === preferredModel) ??
      // Prefer the smallest model that is comfortable on this machine: on a
      // low-end box the fastest model is the one that actually gets used.
      [...models]
        .filter((m) => isModelComfortable(m.name, hardware.tier))
        .sort((a, b) => a.sizeBytes - b.sizeBytes)[0] ??
      models[0];

    const budget = budgetForModel();
    // num_predict 1 loads the weights then stops immediately.
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: pick.name,
        prompt: 'ok',
        stream: false,
        think: false,
        keep_alive: budget.keepAlive,
        options: { num_predict: 1, num_ctx: budget.numCtx, num_thread: budget.numThread },
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => undefined);
  } catch {
    /* warm is best-effort — a cold model still works, just slower once */
  }
}

// ── Listing ────────────────────────────────────────────────────────────────

/** Minimal shape used by the provider layer. */
export async function listOllamaModels(): Promise<Array<{ id: string; label: string; provider: 'ollama'; free: boolean }>> {
  const models = await getInstalledModels();
  return models.map((m) => ({
    id: m.name,
    label: m.name.replace(':latest', ''),
    provider: 'ollama' as const,
    free: true,
  }));
}

/**
 * Resolve the model name to actually send.
 *
 * The UI may request a model that is not installed (the profile remembers
 * `qwen3:4b` while the user has only `1.7b`). Sending a non-existent name
 * returns 404 and the chat dies silently, so resolution happens first.
 * Order: exact → prefix → size tier → smallest installed.
 */
export function resolveOllamaModel(requested: string, installed: string[]): string {
  if (installed.length === 0) return requested;
  if (!requested) return installed[0] ?? '';
  if (installed.includes(requested)) return requested;

  const base = requested.split(':')[0].toLowerCase();
  const byBase = installed.find((m) => m.toLowerCase().startsWith(base));
  if (byBase) return byBase;

  const size = requested.match(/(\d+(?:\.\d+)?)b/i)?.[1];
  if (size) {
    const bySize = installed.find((m) => new RegExp(`\\b${size}b\\b`, 'i').test(m));
    if (bySize) return bySize;
  }
  // Last resort: the smallest installed model. On a slow machine the small one
  // is the only one that will actually respond in a usable time.
  return [...installed].sort((a, b) => a.length - b.length)[0] ?? requested;
}

/**
 * Reachability test for the settings UI.
 *
 * `modelsRequired: false` distinguishes "Ollama is not running" from "Ollama is
 * running but you have not pulled anything", because those need different
 * advice and the user cannot act on a message that conflates them.
 */
export async function testOllamaConnection(
  options: { startIfNeeded?: boolean } = {},
): Promise<{ ok: boolean; error?: string; models?: number }> {
  const running = await ensureOllamaRunning(options.startIfNeeded ?? false);
  if (!running) {
    return {
      ok: false,
      error:
        'Ollama is not running. Install it from ollama.com, open it once, then try again — or keep using a cloud model.',
    };
  }
  const models = await getInstalledModels(true);
  if (models.length === 0) {
    return { ok: false, error: 'Ollama is running, but no models are installed. Run: ollama pull qwen3:1.7b', models: 0 };
  }
  return { ok: true, models: models.length };
}

/** Load a model into memory now, so the next chat does not pay a cold load. */
export async function preloadModel(name: string): Promise<{ ok: boolean; error?: string }> {
  const models = await getInstalledModels();
  const target = resolveOllamaModel(name, models.map((m) => m.name));
  if (!target) return { ok: false, error: 'No local models are installed.' };
  const budget = budgetForModel();
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: target,
        prompt: 'ok',
        stream: false,
        think: false,
        keep_alive: budget.keepAlive,
        options: { num_predict: 1, num_ctx: budget.numCtx, num_thread: budget.numThread },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Drop a loaded model from RAM immediately. The "give my memory back" action. */
export async function unloadModel(name: string): Promise<{ ok: boolean }> {
  try {
    // keep_alive 0 is Ollama's documented way to unload.
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: name, prompt: '', stream: false, keep_alive: 0 }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** What Ollama currently has resident — the honest answer to "is it using my RAM?". */
export async function loadedModels(): Promise<Array<{ name: string; sizeBytes: number; sizeVramBytes: number; expiresAt: string; contextLength?: number }>> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name?: string; size?: number; size_vram?: number; expires_at?: string; context_length?: number }>;
    };
    return (data.models ?? []).map((m) => ({
      name: m.name ?? '',
      sizeBytes: Number(m.size ?? 0),
      sizeVramBytes: Number(m.size_vram ?? 0),
      expiresAt: m.expires_at ?? '',
      contextLength: m.context_length,
    }));
  } catch {
    return [];
  }
}

export { OLLAMA_URL, describeHardware, budgetForModel, getHardwareProfile, isModelComfortable };