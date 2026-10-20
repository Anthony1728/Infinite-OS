// Cost telemetry — estimates dollars per run from token usage. Codex and
// Claude Code both surface spend; free-tier providers report $0.00. Prices are
// USD per 1M tokens and intentionally coarse (list price, no tiering) — the
// goal is an honest "about this much" signal, not accounting.

export interface ModelPrice {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens (defaults to input price). */
  cacheRead?: number;
}

const PRICE_TABLE: Record<string, ModelPrice> = {
  // Anthropic
  'claude-opus-4-1': { input: 15, output: 75 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08 },
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10, cacheRead: 1.25 },
  'gpt-4.1': { input: 2, output: 8, cacheRead: 0.5 },
  'gpt-5.1': { input: 1.25, output: 10, cacheRead: 0.12 },
  'o4-mini': { input: 1.1, output: 4.4 },
  // DeepSeek
  'deepseek-reasoner': { input: 0.55, output: 2.19, cacheRead: 0.14 },
  'deepseek-chat': { input: 0.27, output: 1.1, cacheRead: 0.07 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Meta / open models on gateways (typical hosted pricing)
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
};

export type PricingStatus = 'priced' | 'free' | 'unknown';

/**
 * Local runtimes never bill, and OpenRouter's `:free` variants are zero-cost
 * by contract. Everything else without a table entry is *unpriced*, which is
 * not the same as free: pricing an unknown model at $0 would let the total
 * silently understate what a provider will charge.
 */
const FREE_PROVIDERS = new Set(['ollama', 'lmstudio', 'llamacpp', 'llama.cpp', 'local']);

/** Classify a model so callers can tell a real $0 from a missing price. */
export function pricingStatus(provider: string | undefined, model: string | undefined): PricingStatus {
  if (!model) return 'unknown';
  if (/:free$/i.test(model)) return 'free';
  if (provider && FREE_PROVIDERS.has(provider.toLowerCase())) return 'free';
  return priceForModel(provider, model) ? 'priced' : 'unknown';
}

/** Prefix matcher: `provider/model` and bare model ids both resolve. */
export function priceForModel(provider: string | undefined, model: string | undefined): ModelPrice | null {
  if (!model) return null;
  const bare = model.includes('/') ? model.split('/').pop()! : model;
  const stripSuffix = (id: string) => id.replace(/:(free|latest)$/, '');
  return (
    PRICE_TABLE[stripSuffix(model)] ??
    PRICE_TABLE[stripSuffix(bare)] ??
    (provider && PRICE_TABLE[`${provider}/${model}`]) ??
    null
  );
}

export interface UsageSample {
  provider?: string;
  model?: string;
  input: number;
  output: number;
  cache_read?: number;
}

/**
 * Estimated cost in USD for one usage sample.
 *
 * Genuinely free models cost zero. Unpriced models also cost zero here, but
 * the usage store records them separately so the UI can disclose the gap
 * rather than presenting the number as complete.
 */
export function estimateCost(sample: UsageSample): number {
  if (pricingStatus(sample.provider, sample.model) !== 'priced') return 0;
  const price = priceForModel(sample.provider, sample.model);
  if (!price) return 0;
  const cached = sample.cache_read ?? 0;
  const uncachedInput = Math.max(0, sample.input - cached);
  const cachePrice = price.cacheRead ?? price.input;
  return (
    (uncachedInput / 1_000_000) * price.input +
    (cached / 1_000_000) * cachePrice +
    (sample.output / 1_000_000) * price.output
  );
}

/** Total cost across samples (a run, a session). */
export function estimateTotalCost(samples: UsageSample[]): number {
  return samples.reduce((sum, s) => sum + estimateCost(s), 0);
}

/** Human formatting: `$1.2345` → `$1.23`, `$0.0031` → `$0.0031` (4dp under a cent). */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
