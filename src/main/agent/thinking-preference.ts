// Whether to ask the model to show its reasoning, and how much of its budget.
//
// WHY THIS IS TWO SETTINGS
//
// Reasoning is not free, and its cost differs by a factor of about fifty
// depending on where the model runs. Measured on the development machine
// (i5-4210U @ 1.7 GHz, integrated graphics, no CUDA):
//
//   Cloud model, no reasoning      -> normal latency, normal cost
//   qwen3:1.7b, no reasoning      -> "Reply with exactly: ready" in 0.2 s
//   qwen3:1.7b, with reasoning    -> 17.5 s for the same class of answer
//
// One boolean for both would force a bad default for somebody: on for cloud
// models (cheap, and genuinely useful) and off for local ones, or the reverse.
// So cloud and local get separate switches, and each is honest about its cost.

import { settings } from '../settings/store.js';

/** Cloud providers: reasoning is cheap enough to leave on by default. */
export const SHOW_MODEL_THINKING_KEY = 'showModelThinking';
/** Local (Ollama) models: every reasoning token is real seconds. */
export const SHOW_LOCAL_MODEL_THINKING_KEY = 'showLocalModelThinking';

/** Providers that run on the user's own machine. */
const LOCAL_PROVIDERS = new Set(['ollama']);

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

/**
 * What to send in `ChatRequest.thinking` for this provider.
 *
 * Returns an empty object when the answer is no, so the call site stays a clean
 * spread and the request keeps whatever default the provider has.
 */
export function resolveThinkingPreference(provider: string): { thinking?: boolean } {
  const key = isLocalProvider(provider) ? SHOW_LOCAL_MODEL_THINKING_KEY : SHOW_MODEL_THINKING_KEY;
  const value = settings.get(key);
  // Cloud defaults ON because the user asked to see the thinking and a cloud
  // reasoning model produces it for free. Local defaults OFF because on a CPU
  // it costs seconds per turn, and a local user who wants it can say so.
  const enabled = typeof value === 'boolean' ? value : !isLocalProvider(provider);
  return enabled ? { thinking: true } : {};
}

/** What the settings page should show as the cost of turning it on. */
export function thinkingCostNote(provider: string): string {
  return isLocalProvider(provider)
    ? 'On this machine a local model spends roughly 10-20 extra seconds per turn reasoning, and it is done in a second pass so you always still get an answer.'
    : 'Cloud reasoning models produce this as part of the answer, so it adds no extra round trip.';
}