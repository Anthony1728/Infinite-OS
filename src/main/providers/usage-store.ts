import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { estimateCost, formatCost, pricingStatus, type PricingStatus, type UsageSample } from './pricing.js';

/**
 * Running token and cost totals for the user's conversations.
 *
 * Providers already report usage per response — `normalizeUsage` parses it out
 * of OpenAI, OpenRouter and DeepSeek shapes alike — and `pricing.ts` knows how
 * to turn that into money. Neither was connected to anything, so the app
 * captured the numbers and then dropped them: a user could not see what a
 * conversation had cost, which is the one number that matters when a provider
 * starts charging.
 *
 * Persisted rather than kept in memory so a total survives closing the app.
 */

export interface ModelUsage {
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  requests: number;
  costUsd: number;
  /** Whether the model had a published rate when this usage was recorded. */
  pricing: PricingStatus;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  requests: number;
  costUsd: number;
  /**
   * Requests whose model had no published rate. Their tokens are included in
   * the totals, but their cost is not, so the figure is a floor — not a
   * complete bill. Surfaced in `formatted.note`.
   */
  unpricedRequests: number;
  /** Same figures pre-formatted, so the UI does not reimplement the rules. */
  formatted: {
    cost: string;
    input: string;
    output: string;
    /** Empty when every request had a known price or was genuinely free. */
    note: string;
  };
  byModel: ModelUsage[];
}

interface StoredShape {
  input: number;
  output: number;
  cacheRead: number;
  requests: number;
  costUsd: number;
  unpricedRequests: number;
  byModel: Record<string, ModelUsage>;
}

function filePath(): string {
  return join(infiniteHome(), 'usage-totals.json');
}

function empty(): StoredShape {
  return { input: 0, output: 0, cacheRead: 0, requests: 0, costUsd: 0, unpricedRequests: 0, byModel: {} };
}

/** Wording is composed here so all three settings surfaces stay consistent. */
function unpricedNote(count: number): string {
  if (count <= 0) return '';
  return count === 1
    ? '1 reply used a model with no published price and is counted as $0.'
    : `${count} replies used models with no published price and are counted as $0.`;
}

let cache: StoredShape | null = null;

function load(): StoredShape {
  if (cache) return cache;
  try {
    const path = filePath();
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredShape>;
      const byModel = (parsed.byModel ?? {}) as Record<string, ModelUsage>;
      const hadField = typeof parsed.unpricedRequests === 'number';
      let unpricedRequests = Number(parsed.unpricedRequests) || 0;

      // Files written before this field existed carry no pricing status. Backfill
      // it so an old total is not silently presented as complete.
      for (const entry of Object.values(byModel)) {
        const status = entry.pricing ?? pricingStatus(entry.provider, entry.model);
        entry.pricing = status;
        if (!hadField && status === 'unknown') unpricedRequests += entry.requests;
      }

      cache = {
        input: Number(parsed.input) || 0,
        output: Number(parsed.output) || 0,
        cacheRead: Number(parsed.cacheRead) || 0,
        requests: Number(parsed.requests) || 0,
        costUsd: Number(parsed.costUsd) || 0,
        unpricedRequests,
        byModel,
      };
      return cache;
    }
  } catch {
    // A corrupt totals file must not break the app; start clean instead.
  }
  cache = empty();
  return cache;
}

function save(): void {
  try {
    mkdirSync(infiniteHome(), { recursive: true });
    writeFileSync(filePath(), JSON.stringify(load(), null, 2));
  } catch { /* best-effort — losing a total is not worth failing a reply */ }
}

/** Record one response's usage. Safe to call with null or an empty sample. */
export function recordUsage(sample: UsageSample | null | undefined, provider?: string, model?: string): void {
  if (!sample) return;
  const input = Number(sample.input) || 0;
  const output = Number(sample.output) || 0;
  const cacheRead = Number(sample.cache_read) || 0;
  // Providers that report nothing should not inflate the request count.
  if (input === 0 && output === 0 && cacheRead === 0) return;

  const resolvedProvider = sample.provider ?? provider ?? 'unknown';
  const resolvedModel = sample.model ?? model ?? 'unknown';
  const pricing = pricingStatus(resolvedProvider, resolvedModel);
  const cost = estimateCost({ ...sample, provider: resolvedProvider, model: resolvedModel });

  const state = load();
  state.input += input;
  state.output += output;
  state.cacheRead += cacheRead;
  state.requests += 1;
  state.costUsd += cost;
  if (pricing === 'unknown') state.unpricedRequests += 1;

  const key = `${resolvedProvider}/${resolvedModel}`;
  const existing = state.byModel[key];
  state.byModel[key] = existing
    ? {
        ...existing,
        input: existing.input + input,
        output: existing.output + output,
        cacheRead: existing.cacheRead + cacheRead,
        requests: existing.requests + 1,
        costUsd: existing.costUsd + cost,
        pricing,
      }
    : { provider: resolvedProvider, model: resolvedModel, input, output, cacheRead, requests: 1, costUsd: cost, pricing };

  save();
}

export function getUsageTotals(): UsageTotals {
  const state = load();
  return {
    input: state.input,
    output: state.output,
    cacheRead: state.cacheRead,
    requests: state.requests,
    costUsd: state.costUsd,
    unpricedRequests: state.unpricedRequests,
    formatted: {
      cost: formatCost(state.costUsd),
      input: state.input.toLocaleString(),
      output: state.output.toLocaleString(),
      note: unpricedNote(state.unpricedRequests),
    },
    // Busiest first: the top of the list is where the money went.
    byModel: Object.values(state.byModel).sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests),
  };
}

export function resetUsage(): void {
  cache = empty();
  try { rmSync(filePath(), { force: true }); } catch { /* best-effort */ }
}

/** Test seam: drop the in-memory copy so the next call re-reads from disk. */
export function resetUsageCacheForTests(): void {
  cache = null;
}