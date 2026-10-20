import { getAllApiKeys } from '../settings/secrets.js';
import { getProvider } from './registry.js';
import { isProviderAuthKnownBad } from './health.js';
import { getModelReliability, recordModelOutcome } from './model-performance.js';
export interface ProviderCandidate { provider: string; model: string; apiKey: string; label: string; }

export const PROVIDER_ORDER = ['nvidia', 'openrouter', 'groq', 'apinex', 'bluesminds', 'cloudflare', 'custom', 'ollama', 'opencode', 'freebuff', 'gemini', 'anthropic', 'openai'];
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

/**
 * Account-wide free-tier exhaustion (OpenCode free quota spent until reset).
 * The whole provider is unusable for hours — the run must leave it for a
 * keyed provider instead of cycling its dead free models.
 */
export function isFreeTierExhausted(error: string): boolean {
  return /free.?tier|free usage exceeded|resets in/i.test(error);
}

export function classifyError(error: string): FailoverReason {
  if (isFreeTierExhausted(error)) return 'billing';
  if (/\b(?:401|403|api.?key|auth|unauthori[sz]ed|forbidden|token\s*(?:expired|incorrect|invalid)|expired\s*(?:api\s*)?key)\b/i.test(error)) return 'auth';
  if (/\b(?:402|billing|insufficient\s+balance|quota\s*exceeded|credit)\b/i.test(error)) return 'billing';
  if (/\b(?:429|rate.?limit|quota|capacity|free.?usage.?limit|retrying.?upstream)\b/i.test(error)) return 'rate_limit';
  if (/\b(?:overloaded|capacity|try again|returned no output|no.?output|empty response)\b/i.test(error)) return 'overloaded';
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

/**
 * How many times a stream failure may retry on the SAME model before the
 * run is allowed to fail over to another candidate. Retrying first keeps
 * the user's explicit model selection stable across transient hiccups
 * (stalls, 5xx, network blips, rate limits) instead of changing models
 * on every blip.
 */
export const SAME_MODEL_STREAM_RETRIES = 3;

/**
 * How many times a NON-selected model (failover candidate) may retry
 * before moving to the next candidate. Lower than the selected-model
 * budget because the user did not explicitly pick these.
 */
export const FAILOVER_CANDIDATE_RETRIES = 2;

/**
 * Capability failure types — these are NOT API errors. They mean the model
 * is not strong enough for the task (can't code, can't use tools, etc.).
 */
export type CapabilityFailureType =
  | 'promise_only'      // Model said "I'll do X" but never did
  | 'explicit_failure'  // Model said "I can't do X"
  | 'tool_error'        // Model's edits/introductions broke something
  | 'no_execution';     // Model didn't call any tools when required

/**
 * Track capability failures per model to detect when a model is overmatched.
 * A model with too many capability failures should be swapped for a stronger one.
 */
export interface CapabilityTracker {
  /** Map of "provider:model" -> count of capability failures */
  failures: Map<string, number>;
  /** Map of "provider:model" -> list of failure descriptions */
  details: Map<string, CapabilityFailureType[]>;
}

export function createCapabilityTracker(): CapabilityTracker {
  return { failures: new Map(), details: new Map() };
}

export function recordCapabilityFailure(
  tracker: CapabilityTracker,
  candidate: Pick<ProviderCandidate, 'provider' | 'model'>,
  type: CapabilityFailureType,
): void {
  const id = candidateId(candidate);
  tracker.failures.set(id, (tracker.failures.get(id) ?? 0) + 1);
  const details = tracker.details.get(id) ?? [];
  details.push(type);
  tracker.details.set(id, details);
}

export function getCapabilityFailureCount(tracker: CapabilityTracker, candidate: Pick<ProviderCandidate, 'provider' | 'model'>): number {
  return tracker.failures.get(candidateId(candidate)) ?? 0;
}

/**
 * Threshold: after this many capability failures on the same model, switch.
 * The model is clearly overmatched — don't let it keep trying and potentially
 * breaking the user's project.
 */
export const CAPABILITY_FAILURE_THRESHOLD = 2;

/**
 * Transient stream failures: worth retrying on the same model before any
 * failover. Credential/billing/model/config/content failures are NOT
 * transient — retrying them on the same model can never succeed, so those
 * still switch candidates immediately.
 *
 * Rate limits ARE transient: the user's model selection matters, and a
 * short backoff often resolves a 429. The loop applies a longer
 * rate-limit-specific backoff before retrying.
 */
export function isTransientStreamFailure(error: string): boolean {
  // Credential/setup failures are never transient, even when the message
  // contains retry-sounding words ("try again" in a login hint must not read
  // as overloaded) — retrying the same model can never succeed.
  if (/api.?key|auth|login|sign.?in|credential|unauthori[sz]ed|forbidden|\b401\b|\b403\b|not signed in|no .*key saved/i.test(error)) {
    return false;
  }
  const reason = classifyError(error);
  return reason === 'timeout' || reason === 'network' || reason === 'server_error' || reason === 'overloaded' || reason === 'rate_limit';
}

/**
 * Errors that are fatal for the ENTIRE provider (all its models), not just
 * one model. If a provider's API key is dead, expired, or out of quota,
 * every model on that provider will fail the same way — skip them all.
 */
export function isProviderFatal(error: string): boolean {
  const reason = classifyError(error);
  return reason === 'auth' || reason === 'billing';
}

/**
 * Backoff delay in ms for a given error type. Rate limits get longer
 * backoff (the API needs time to reset the quota window); other
 * transient errors use shorter delays.
 */
export function backoffForError(error: string, attempt: number): number {
  const reason = classifyError(error);
  if (reason === 'rate_limit') {
    // Rate limits: 5s, 15s, 30s, 60s (cap) — quota windows are typically 1 min
    return Math.min(5000 * Math.pow(3, attempt), 60_000);
  }
  if (reason === 'overloaded') {
    // Overloaded: 3s, 8s, 20s
    return Math.min(3000 * Math.pow(2.5, attempt), 20_000);
  }
  // Default transient: jittered 1s–4s
  return jitteredBackoff(attempt, 1000, 4000);
}

/** Temporarily deprioritize a model that just failed so the next request starts with a known-healthier option. */
export function recordProviderFailure(candidate: Pick<ProviderCandidate, 'provider' | 'model'>, error: string): void {
  const reason = classifyError(error);
  const cooldown =
    reason === 'auth' || reason === 'billing' ? 10 * 60_000
    : reason === 'rate_limit' ? 60_000
    : reason === 'overloaded' ? 60_000
    : reason === 'server_error' ? 30_000
    : reason === 'timeout' || reason === 'network' ? 15_000
    : 20_000;
  unhealthyUntil.set(candidateId(candidate), Date.now() + cooldown);
  // Feed the persistent routing memory: every failure teaches the Brain which
  // models not to reach for next time (survives restarts, unlike the map above).
  recordModelOutcome(candidate.provider, candidate.model, false, error.slice(0, 300));
  // Auth/billing failures are provider-wide: mark ALL models on this provider
  // as unhealthy so the failover chain skips them entirely.
  if (reason === 'auth' || reason === 'billing') {
    const providerPrefix = `${candidate.provider}:`;
    for (const [key, expiry] of unhealthyUntil) {
      if (key.startsWith(providerPrefix)) {
        unhealthyUntil.set(key, Math.max(expiry ?? 0, Date.now() + 10 * 60_000));
      }
    }
  }
}

export function recordProviderSuccess(candidate: Pick<ProviderCandidate, 'provider' | 'model'>): void {
  const id = candidateId(candidate);
  unhealthyUntil.delete(id);
  lastSuccessfulAt.set(id, Date.now());
  // Same persistent memory, positive side: successes raise the model's learned
  // reliability so failover ordering improves with every conversation.
  recordModelOutcome(candidate.provider, candidate.model, true);
}

export function isProviderWideFailure(error: string): boolean {
  if (isFreeTierExhausted(error)) return true;
  return /\b(?:401|402|403|408|409|426|429|5\d\d|api.?key|auth|login|sign.?in|credential|rate.?limit|quota|credit|capacity|overloaded|upgrade.?required|newer is required|timeout|timed out|stalled|stall|no provider progress|supervisor.*restart|network|connection|fetch failed|stopped responding|econn\w*|etimedout|enotfound|ehostunreach|enotconn|eaddrinuse|aborted.*stream)\b/i.test(error);}

export function prioritizeProviderCandidates(candidates: ProviderCandidate[], now = Date.now()): ProviderCandidate[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      unhealthy: (unhealthyUntil.get(candidateId(candidate)) ?? 0) > now,
      // Learned reliability (Wilson over persisted outcomes, 0 until proven):
      // the Brain's long-term memory of which models have actually answered.
      learned: getModelReliability(candidate.provider, candidate.model),
      lastSuccess: lastSuccessfulAt.get(candidateId(candidate)) ?? 0,
    }))
    .sort((a, b) =>
      // The first item is the user's explicit selection. It always stays
      // first: a cooldown from an earlier failure must never silently swap
      // in a different model before the chosen one has been tried.
      Number(b.index === 0) - Number(a.index === 0) ||
      Number(a.unhealthy) - Number(b.unhealthy) ||
      // Among healthy candidates, proven-reliable models come first — this is
      // the ordering that gets smarter with every conversation.
      b.learned - a.learned ||
      b.lastSuccess - a.lastSuccess ||
      a.index - b.index,
    )
    .map(({ candidate }) => candidate);
}

/** Errors that mean the selected provider itself is unusable and the run may leave it. */
const CREDENTIAL_FAILURE = /\b(401|402|403|api.?key|auth|login|sign.?in|credential|unauthori[sz]ed|forbidden|quota|credit|free.?tier|free usage exceeded|resets in|insufficient\s+balance|token\s*(?:expired|incorrect|invalid)|expired\s*(?:api\s*)?key)\b/i;// A 404 from an OpenAI-compatible endpoint almost always means "that model
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
  const credentials = new Map<string, string[]>();
  const add = async (providerId: string, model: string) => {
    const provider = getProvider(providerId);
    if (!provider || !model) return;
    if (provider.requiresApiKey) {
      if (!credentials.has(providerId)) credentials.set(providerId, await getAllApiKeys(providerId));
      const keys = credentials.get(providerId) ?? [];
      if (!keys.length) return;
      // Create a candidate for each API key (currently one per provider)
      for (const apiKey of keys) {
        const id = `${providerId}:${model}:${apiKey.slice(-4)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        candidates.push({ provider: providerId, model, apiKey, label: `${provider.label} / ${model}` });
      }
      return;
    }
    // Keyless-capable providers (Ollama, installed OpenCode CLI, FreeBuff):
    // keyed candidates first when keys exist, then the keyless route.
    if (!credentials.has(providerId)) credentials.set(providerId, await getAllApiKeys(providerId));
    const keys = credentials.get(providerId) ?? [];
    for (const apiKey of keys) {
      const id = `${providerId}:${model}:${apiKey.slice(-4)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push({ provider: providerId, model, apiKey, label: `${provider.label} / ${model}` });
    }
    const id = `${providerId}:${model}`;
    if (seen.has(id)) return;
    seen.add(id);
    candidates.push({ provider: providerId, model, apiKey: '', label: `${provider.label} / ${model}` });
  };

  await add(selected.provider, selected.model);
  const orderedProviders = [selected.provider, ...PROVIDER_ORDER.filter((id) => id !== selected.provider)];
  for (const providerId of orderedProviders) {
    const provider = getProvider(providerId);
    if (!provider) continue;
    // A keyless provider whose login was just rejected fails every model
    // identically. Keep the user's explicit selection (it fails fast with the
    // fix), but don't offer its dead catalog as automatic fallback.
    if (providerId !== selected.provider && !provider.requiresApiKey && isProviderAuthKnownBad(providerId)) continue;
    for (const model of provider.freeModels) await add(providerId, model.id);
    if (provider.defaultModel) await add(providerId, provider.defaultModel);
  }

  // Include ALL available models — no cap. If a user has 10 API keys, the
  // failover chain tries every one. Cooldowns and provider-wide auth/billing
  // skips prevent wasted attempts.
  const prioritized = prioritizeProviderCandidates(candidates);
  return prioritized;
}

export function isRecoverableProviderError(error: string): boolean {
  return /\b(401|402|403|404|408|409|426|429|5\d\d|api\s*key|auth|unauthori[sz]ed|forbidden|invalid credential|freebuff|consent_required|spend_limited|ip_capped|model_locked|model_unavailable|token\s+(?:expired|incorrect|invalid)|expired\s+(?:api\s*)?key|upgrade.?required|newer is required|rate.?limit|quota|credit|capacity|overloaded|timeout|timed out|network|connection|fetch failed|stopped responding|econn\w*|etimedout|enotfound|ehostunreach|enotconn|eaddrinuse|aborted|cancelled|canceled|model.*(?:unavailable|not found))\b/i.test(error);}
