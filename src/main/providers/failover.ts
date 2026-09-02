import { getApiKey } from '../settings/secrets.js';
import { getProvider } from './registry.js';

export interface ProviderCandidate { provider: string; model: string; apiKey: string; label: string; }

const PROVIDER_ORDER = ['nvidia', 'openrouter', 'groq', 'ollama', 'opencode', 'gemini', 'anthropic', 'openai'];
const unhealthyUntil = new Map<string, number>();
const lastSuccessfulAt = new Map<string, number>();

function candidateId(candidate: Pick<ProviderCandidate, 'provider' | 'model'>): string {
  return `${candidate.provider}:${candidate.model}`;
}

/** Classify provider errors into categories (inspired by Hermes Agent's FailoverReason taxonomy). */
export type FailoverReason =
  | 'auth' | 'auth_permanent' | 'billing' | 'rate_limit' | 'overloaded'
  | 'server_error' | 'timeout' | 'context_overflow' | 'model_not_found'
  | 'content_blocked' | 'format_error' | 'network' | 'unknown';

export function classifyError(error: string): FailoverReason {
  if (/\b(?:401|403|api.?key|auth|unauthori[sz]ed|forbidden|token\s*(?:expired|incorrect|invalid)|expired\s*(?:api\s*)?key)\b/i.test(error)) return 'auth';
  if (/\b(?:402|billing|insufficient\s+balance|quota\s*exceeded|credit)\b/i.test(error)) return 'billing';
  if (/\b(?:429|rate.?limit|quota|capacity)\b/i.test(error)) return 'rate_limit';
  if (/\b(?:overloaded|capacity|try again)\b/i.test(error)) return 'overloaded';
  if (/\b(?:5\d\d|server.?error|internal.?error|bad.?gateway|service.?unavailable)\b/i.test(error)) return 'server_error';
  if (/\b(?:timeout|timed.?out|stalled|stall|no provider progress|supervisor.*restart|aborted.*stream)\b/i.test(error)) return 'timeout';
  if (/\b(?:context.?overflow|context.?length|too.?many.?tokens|payload.?too.?large|max.?tokens)\b/i.test(error)) return 'context_overflow';
  if (/\b(?:404|model\s*(?:not found|unavailable|doesn'?t exist)|invalid model|unknown model)\b/i.test(error)) return 'model_not_found';
  if (/\b(?:content.?policy|content.?blocked|policy.?blocked|safety|harmful)\b/i.test(error)) return 'content_blocked';
  if (/\b(?:format.?error|invalid.?request|malformed|parse.?error)\b/i.test(error)) return 'format_error';
  if (/\b(?:network|connection|fetch failed|stopped responding|econn\w*|etimedout|enotfound|ehostunreach|enotconn|eaddrinuse)\b/i.test(error)) return 'network';
  return 'unknown';
}

/** Jittered exponential backoff (Hermes-inspired decorrelated jitter). */
export function jitteredBackoff(attempt: number, baseMs = 800, maxMs = 30_000): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = exp * 0.3 * (Math.random() * 2 - 1); // ±30%
  return Math.max(200, Math.round(exp + jitter));
}

/** Temporarily deprioritize a model that just failed so the next request starts with a known-healthier option. */
export function recordProviderFailure(candidate: Pick<ProviderCandidate, 'provider' | 'model'>, error: string): void {
  const reason = classifyError(error);
  const cooldown =
    reason === 'auth' || reason === 'billing' ? 10 * 60_000
    : reason === 'rate_limit' ? 2 * 60_000
    : reason === 'overloaded' ? 60_000
    : reason === 'server_error' ? 30_000
    : reason === 'timeout' || reason === 'network' ? 15_000
    : 20_000;
  unhealthyUntil.set(candidateId(candidate), Date.now() + cooldown);
}

export function recordProviderSuccess(candidate: Pick<ProviderCandidate, 'provider' | 'model'>): void {
  const id = candidateId(candidate);
  unhealthyUntil.delete(id);
  lastSuccessfulAt.set(id, Date.now());
}

export function isProviderWideFailure(error: string): boolean {
  return /\b(?:401|402|403|408|409|429|5\d\d|api.?key|auth|rate.?limit|quota|credit|capacity|overloaded|timeout|timed out|stalled|stall|no provider progress|supervisor.*restart|network|connection|fetch failed|stopped responding|econn\w*|etimedout|enotfound|ehostunreach|enotconn|eaddrinuse|aborted.*stream)\b/i.test(error);
}

export function prioritizeProviderCandidates(candidates: ProviderCandidate[], now = Date.now()): ProviderCandidate[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      unhealthy: (unhealthyUntil.get(candidateId(candidate)) ?? 0) > now,
      lastSuccess: lastSuccessfulAt.get(candidateId(candidate)) ?? 0,
    }))
    .sort((a, b) =>
      // The first item is the user's explicit selection. It always stays
      // first: a cooldown from an earlier failure must never silently swap
      // in a different model before the chosen one has been tried.
      Number(b.index === 0) - Number(a.index === 0) ||
      Number(a.unhealthy) - Number(b.unhealthy) ||
      b.lastSuccess - a.lastSuccess ||
      a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/** Errors that mean the selected provider itself is unusable and the run may leave it. */
const CREDENTIAL_FAILURE = /\b(401|402|403|api.?key|auth|unauthori[sz]ed|forbidden|quota|credit|insufficient\s+balance|token\s*(?:expired|incorrect|invalid)|expired\s*(?:api\s*)?key)\b/i;
// A 404 from an OpenAI-compatible endpoint almost always means "that model
// string does not exist on this provider" — the configured (provider, model)
// pair is wrong. That is a hard misconfiguration, not a transient issue, so
// the agent must be allowed to try the next candidate anywhere.
const BAD_MODEL_FAILURE = /\b(404|model\s*(?:not found|unavailable|doesn'?t exist|does not exist)|page not found|invalid model|unknown model)\b/i;

export function selectNextProviderCandidate(
  plan: ProviderCandidate[],
  currentIndex: number,
  active: ProviderCandidate,
  error: string,
): ProviderCandidate | undefined {
  const remaining = plan.slice(currentIndex + 1);
  // While the user's explicit selection is still the active candidate, the
  // run must not wander across unrelated providers on transient or
  // model-specific failures ("The selected model is not available", timeouts,
  // 5xx, rate limits). Stay inside the chosen provider; only a credential-level
  // failure (dead/expired key, quota, forbidden) may leave it, so the recovery
  // chain still covers "this provider can never answer again" without ever
  // silently answering from a model the user did not pick.
  const selectionFailing = currentIndex === 0;
  if (selectionFailing && !CREDENTIAL_FAILURE.test(error)) {
    const sameProvider = remaining.find((candidate) => candidate.provider === active.provider && candidate.model !== active.model);
    if (sameProvider) return sameProvider;
    // No other model on this provider — if the error is a bad-model 404 or a
    // provider-wide transient (429/5xx/timeout/network), the chosen provider
    // itself cannot serve this turn; hop to the next healthy provider instead
    // of killing the run.
    if (BAD_MODEL_FAILURE.test(error)) {
      return remaining[0];
    }
    if (isProviderWideFailure(error)) {
      const otherProvider = remaining.find((candidate) => candidate.provider !== active.provider);
      if (otherProvider) return otherProvider;
    }
    return undefined;
  }
  return (isProviderWideFailure(error)
    ? remaining.find((candidate) => candidate.provider !== active.provider)
    : undefined)
    ?? remaining.find((candidate) => candidate.provider !== active.provider || candidate.model !== active.model);
}

/** Build a credential-aware recovery chain: current model, same provider, then free/local alternatives. */
export async function buildProviderFailoverPlan(selected: { provider: string; model: string }): Promise<ProviderCandidate[]> {
  const candidates: ProviderCandidate[] = [];
  const seen = new Set<string>();
  const credentials = new Map<string, string>();
  const add = async (providerId: string, model: string) => {
    const provider = getProvider(providerId);
    if (!provider || !model) return;
    const id = `${providerId}:${model}`;
    if (seen.has(id)) return;
    seen.add(id);
    let apiKey = '';
    if (provider.requiresApiKey || provider.acceptsApiKey) {
      if (!credentials.has(providerId)) credentials.set(providerId, await getApiKey(providerId) ?? '');
      apiKey = credentials.get(providerId) ?? '';
    }
    if (provider.requiresApiKey && !apiKey) return;
    candidates.push({ provider: providerId, model, apiKey, label: `${provider.label} / ${model}` });
  };

  await add(selected.provider, selected.model);
  const orderedProviders = [selected.provider, ...PROVIDER_ORDER.filter((id) => id !== selected.provider)];
  for (const providerId of orderedProviders) {
    const provider = getProvider(providerId);
    if (!provider) continue;
    for (const model of provider.freeModels) await add(providerId, model.id);
    if (provider.defaultModel) await add(providerId, provider.defaultModel);
  }

  // Cap the chain so a heavily-configured install never tries providers for hours.
  const MAX_CANDIDATES = 10;
  const prioritized = prioritizeProviderCandidates(candidates);
  // Live model scanning belongs in settings. Keeping it off the request path
  // lets an agent begin and publish visible activity immediately.
  // Preserve configured preference while moving recently failed models behind
  // healthy candidates. Cooldowns are in-memory and never expose key material.
  return prioritized.slice(0, MAX_CANDIDATES);
}

export function isRecoverableProviderError(error: string): boolean {
  return /\b(401|402|403|404|408|409|429|5\d\d|api\s*key|auth|unauthori[sz]ed|forbidden|token\s+(?:expired|incorrect|invalid)|expired\s+(?:api\s*)?key|rate.?limit|quota|credit|capacity|overloaded|timeout|timed out|network|connection|fetch failed|stopped responding|econn\w*|etimedout|enotfound|ehostunreach|enotconn|eaddrinuse|aborted|cancelled|canceled|model.*(?:unavailable|not found))\b/i.test(error);
}
