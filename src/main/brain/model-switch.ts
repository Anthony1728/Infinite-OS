// Model switching — the Brain's hands for "move me to a model that works".
//
// Used by the phone paths (WhatsApp/Telegram) as a fast path that runs BEFORE
// any model is invoked, so a dead model can still be replaced by asking in
// plain language, and by the agent loop when it auto-switches after a hard
// failure. Every switch is PROBED with a real tiny completion first — the Brain
// never claims a model works on the strength of a catalog entry — and every
// probe outcome feeds model-performance.json, so routing learns which models
// actually answer.

import { randomUUID } from 'node:crypto';
import type { Message } from '../../shared/types.js';
import { settings } from '../settings/store.js';
import { getProvider, listProviders } from '../providers/registry.js';
import { getAllApiKeys } from '../settings/secrets.js';
import {
  buildProviderFailoverPlan,
  recordProviderFailure,
  recordProviderSuccess,
  type ProviderCandidate,
} from '../providers/failover.js';
import {
  getModelPerformance,
  getModelReliability,
} from '../providers/model-performance.js';
import type { ModelCommand } from './model-command.js';

/** Per-candidate probe budget — a dead endpoint must not stall the phone. */
export const PROBE_TIMEOUT_MS = 10_000;
/** How many candidates one switch may try before giving up with advice. */
export const MAX_PROBE_CANDIDATES = 4;

export interface ProbeResult {
  ok: boolean;
  ms: number;
  error?: string;
}

export interface SwitchResult {
  ok: boolean;
  provider?: string;
  model?: string;
  label?: string;
  /** Every candidate attempted, in order, with its outcome — for the reply. */
  tried: Array<{ label: string; ok: boolean; error?: string; ms?: number }>;
  /** Why the whole switch failed, when ok === false. */
  error?: string;
}

export interface SwitchDeps {
  getSetting?: <T = unknown>(key: string) => T | undefined;
  /** Override persistence (tests). Defaults to the user settings scope. */
  persist?: (provider: string, model: string, cwd: string) => Promise<void>;
  /** Override the probe (tests). Defaults to a real 8-token completion. */
  probe?: (candidate: ProviderCandidate, timeoutMs?: number) => Promise<ProbeResult>;
  /** Override candidate discovery (tests). */
  buildPlan?: (selected: { provider: string; model: string }) => Promise<ProviderCandidate[]>;
  probeTimeoutMs?: number;
  maxCandidates?: number;
}

function setting(deps: SwitchDeps | undefined, key: string): string {
  const get = deps?.getSetting ?? ((k: string) => settings.get(k));
  const value = get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Send an 8-token completion and require real signal back. Accepts any
 * text/message_end chunk as proof of life; an error chunk or a silent stream
 * counts as failure so a broken endpoint can never be selected as "working".
 */
export async function probeCandidate(
  candidate: ProviderCandidate,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const started = Date.now();
  const provider = getProvider(candidate.provider);
  if (!provider) return { ok: false, ms: 0, error: `Provider ${candidate.provider} is not registered.` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const message: Message = {
      id: randomUUID(),
      role: 'user',
      timestamp: Date.now(),
      content: [{ type: 'text', text: 'Reply with the single word: pong' }],
    };
    let sawSignal = false;
    let error = '';
    for await (const chunk of provider.streamChat({
      model: candidate.model,
      messages: [message],
      max_tokens: 8,
      temperature: 0,
      stream: true,
      signal: controller.signal,
    }, candidate.apiKey)) {
      if (chunk.type === 'text_delta' && chunk.text.trim()) sawSignal = true;
      else if (chunk.type === 'message_end') sawSignal = true;
      else if (chunk.type === 'error') { error = chunk.error; break; }
      if (sawSignal) break;
    }
    const ms = Date.now() - started;
    if (error) return { ok: false, ms, error };
    if (!sawSignal) return { ok: false, ms, error: 'The model produced no response.' };
    return { ok: true, ms };
  } catch (e) {
    const raw = (e as Error)?.message ?? String(e);
    const aborted = /abort/i.test(raw);
    return {
      ok: false,
      ms: Date.now() - started,
      error: aborted ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : raw,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Save the new active selection so background turns (WhatsApp, Telegram,
 * scheduled runs) and the next launch all use the model that actually works. */
export async function persistActiveModel(
  provider: string,
  model: string,
  cwd?: string,
): Promise<void> {
  const dir = cwd || setting(undefined, 'cwd') || process.cwd();
  await settings.set('user', 'provider', provider, dir);
  await settings.set('user', 'model', model, dir);
}

async function runProbe(
  candidate: ProviderCandidate,
  deps: SwitchDeps | undefined,
): Promise<ProbeResult> {
  const timeout = deps?.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
  const result = deps?.probe
    ? await deps.probe(candidate, timeout)
    : await probeCandidate(candidate, timeout);
  // recordProviderSuccess/Failure feed the persistent routing memory
  // (model-performance.json) as well as the in-memory quarantine, so one call
  // teaches the Brain both for now and for after a restart.
  if (result.ok) recordProviderSuccess(candidate);
  else recordProviderFailure(candidate, result.error ?? 'probe failed');
  return result;
}

/**
 * Walk candidates until one answers, persist it, and report every attempt.
 * The Brain's default hands: used by "switch to a working model".
 */
export async function switchToCandidateList(
  candidates: ProviderCandidate[],
  deps?: SwitchDeps,
): Promise<SwitchResult> {
  const limit = deps?.maxCandidates ?? MAX_PROBE_CANDIDATES;
  const tried: SwitchResult['tried'] = [];
  const seen = new Set<string>();
  let lastError = '';

  for (const candidate of candidates) {
    const key = `${candidate.provider}:${candidate.model}:${candidate.apiKey.slice(-4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tried.length >= limit) break;

    const result = await runProbe(candidate, deps);
    tried.push({ label: candidate.label, ok: result.ok, error: result.error, ms: result.ms });
    if (result.ok) {
      const cwd = setting(deps, 'cwd') || process.cwd();
      await (deps?.persist ?? persistActiveModel)(candidate.provider, candidate.model, cwd);
      return {
        ok: true,
        provider: candidate.provider,
        model: candidate.model,
        label: candidate.label,
        tried,
      };
    }
    lastError = result.error ?? 'unreachable';
  }

  return {
    ok: false,
    tried,
    error: tried.length
      ? `Tried ${tried.length} model(s) and none answered${lastError ? ` (last error: ${lastError})` : ''}. Check your API keys in Settings → Providers, your internet connection, or start Ollama for a local model.`
      : 'No usable model candidates are configured. Add an API key in Settings → Providers, or install a model in Ollama.',
  };
}

/** "Switch to a working model" — plan from the current selection (so an
 * explicitly selected provider stays preferred) and probe down the chain. */
export async function switchToWorkingModel(deps?: SwitchDeps): Promise<SwitchResult> {
  const current = {
    provider: setting(deps, 'provider'),
    model: setting(deps, 'model'),
  };
  const plan = deps?.buildPlan
    ? await deps.buildPlan(current)
    : await buildProviderFailoverPlan(current);
  // Learned reliability reorders the chain: proven models get probed first.
  const ordered = [...plan].sort((a, b) => {
    if (a.provider === current.provider && a.model === current.model) return -1;
    if (b.provider === current.provider && b.model === current.model) return 1;
    return getModelReliability(b.provider, b.model) - getModelReliability(a.provider, a.model);
  });
  return switchToCandidateList(ordered, deps);
}

interface ProviderMatch {
  providerId: string;
  candidates: ProviderCandidate[];
}

/** Resolve free text ("groq", "nvidia", "gpt-4o", "llama 3.3") to concrete
 * candidate lists. Providers first (user naming a platform beats a model hit),
 * then model ids/labels across every keyed/local provider. */
export async function resolveTargetCandidates(target: string): Promise<ProviderMatch[]> {
  const needle = target.toLowerCase().replace(/\s+/g, '');
  if (!needle) return [];
  const providers = listProviders();

  const makeCandidate = async (providerId: string, model: string): Promise<ProviderCandidate | null> => {
    const provider = getProvider(providerId);
    if (!provider) return null;
    let keys: string[] = [];
    try {
      keys = await getAllApiKeys(providerId);
    } catch { /* keyless providers answer with '' below */ }
    // Keyed providers with no saved key cannot be candidates at all.
    if (provider.requiresApiKey && !keys.length) return null;
    return { provider: providerId, model, apiKey: keys[0] ?? '', label: `${provider.label} / ${model}` };
  };

  const matches: ProviderMatch[] = [];

  // 1. Provider id / label match.
  const providerHit = providers.find((p) =>
    p.id.toLowerCase() === needle
    || p.id.toLowerCase().includes(needle)
    || p.label.toLowerCase().replace(/\s+/g, '').includes(needle));
  if (providerHit) {
    const models = providerHit.defaultModel
      ? [providerHit.defaultModel, ...providerHit.freeModels.map((m) => m.id)]
      : providerHit.freeModels.map((m) => m.id);
    const seen = new Set<string>();
    const candidates: ProviderCandidate[] = [];
    for (const model of models) {
      if (!model || seen.has(model)) continue;
      seen.add(model);
      const candidate = await makeCandidate(providerHit.id, model);
      if (candidate) candidates.push(candidate);
    }
    if (candidates.length) {
      candidates.sort((a, b) => getModelReliability(b.provider, b.model) - getModelReliability(a.provider, a.model));
      matches.push({ providerId: providerHit.id, candidates });
    }
  }

  // 2. Model id / label match across all providers.
  for (const provider of providers) {
    if (matches.some((m) => m.providerId === provider.id)) continue;
    const models = [
      ...(provider.defaultModel ? [provider.defaultModel] : []),
      ...provider.freeModels.map((m) => m.id),
    ];
    const hit = models.find((id) => {
      const norm = id.toLowerCase().replace(/[\s/_-]/g, '');
      if (!norm) return false;
      return norm.includes(needle) || needle.includes(norm) || id.toLowerCase().includes(target.toLowerCase().trim());
    });
    if (!hit) continue;
    const candidate = await makeCandidate(provider.id, hit);
    if (candidate) matches.push({ providerId: provider.id, candidates: [candidate] });
  }

  return matches;
}

/** "switch to <target>" — resolve, probe the strongest match, persist. */
export async function switchToTarget(target: string, deps?: SwitchDeps): Promise<SwitchResult> {
  const matches = deps?.buildPlan
    ? [{ providerId: 'custom', candidates: await deps.buildPlan({ provider: target, model: target }) }]
    : await resolveTargetCandidates(target);
  const flat = matches.flatMap((m) => m.candidates);
  if (!flat.length) {
    const available = listProviders()
      .filter((p) => p.freeModels.length || p.defaultModel)
      .map((p) => p.id)
      .join(', ');
    return {
      ok: false,
      tried: [],
      error: `No provider or model matches "${target}". Available: ${available}. Reply "switch to a working model" and I'll pick a healthy one for you.`,
    };
  }
  return switchToCandidateList(flat, deps);
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Human-readable model status for the phone. */
export async function describeActiveModel(deps?: SwitchDeps): Promise<string> {
  const provider = setting(deps, 'provider');
  const model = setting(deps, 'model');
  if (!provider || !model) {
    return 'No model selected yet. Reply "switch to a working model" and I\'ll probe the available providers and set one that answers.';
  }
  const adapter = getProvider(provider);
  const label = adapter ? `${adapter.label} / ${model}` : `${provider} / ${model}`;
  const record = getModelPerformance(provider, model);
  const reliability = getModelReliability(provider, model);

  const lines = [`Active model: ${label}`];
  if (record) {
    const attempts = record.successes + record.failures;
    const ago = Math.max(0, Math.round((Date.now() - record.lastAt) / 60_000));
    lines.push(
      `Learned reliability: ${attempts >= 3 ? pct(reliability) + ' over ' + attempts + ' runs' : `${attempts}/3 runs recorded (not yet ranked)`} · last result: ${record.lastResult === 'ok' ? '✅ worked' : '❌ failed'}${ago}m ago`,
    );
    if (record.lastError) lines.push(`Last error: ${record.lastError}`);
  } else {
    lines.push('Learned reliability: not tested yet — it will be scored after a few conversations.');
  }
  lines.push('Say "switch to a working model" or "switch to <provider>" to change it.');
  return lines.join('\n');
}

/**
 * Entry point for the phone fast path: executes a parsed model command and
 * returns the reply text. Callers only reach this AFTER parseModelCommand
 * matched, so it always answers with something actionable.
 */
export async function answerModelCommand(
  command: ModelCommand,
  deps?: SwitchDeps,
): Promise<string> {
  if (command.kind === 'status') return describeActiveModel(deps);

  const before = { provider: setting(deps, 'provider'), model: setting(deps, 'model') };
  const previousLabel = before.provider && before.model ? `${before.provider}/${before.model}` : 'none selected';
  const result = command.kind === 'switch_working'
    ? await switchToWorkingModel(deps)
    : await switchToTarget(command.target, deps);

  if (!result.ok) return `⚠️ Could not switch models.\n${result.error ?? 'No candidate answered.'}\n\nAttempts:\n${result.tried.map((t) => `• ${t.label}: ${t.ok ? '✅ ok' : `❌ ${t.error ?? 'failed'}`}`).join('\n')}`;

  const attempts = result.tried
    .map((t) => `• ${t.label}: ${t.ok ? `✅ answered in ${t.ms ?? 0}ms` : `❌ ${t.error ?? 'failed'}`}`)
    .join('\n');
  const probeNote = result.tried.length > 1
    ? `\nTried:\n${attempts}`
    : '';
  const sameAsBefore = result.provider && result.model && result.provider === before.provider && result.model === before.model;
  return [
    `✅ Switched to ${result.label} — probe answered, so it works right now.`,
    sameAsBefore ? `(This was already the active model; probe re-verified it.)` : `Previous: ${previousLabel}.`,
    probeNote,
    'Saved as the active model for desktop, WhatsApp, and scheduled runs. Send your next message and I\'ll continue from there.',
  ].filter(Boolean).join('\n');
}
