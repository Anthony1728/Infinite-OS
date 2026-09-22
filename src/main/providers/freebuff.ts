// Freebuff provider — free models through the installed Freebuff CLI's own
// login (ad-supported free tier, no API key to paste).
//
// How it works: the Freebuff CLI is TUI-only (no local server like OpenCode),
// so chat runs against the Freebuff backend directly using the CLI's stored
// credential (~/.config/manicode/credentials.json, same file the CLI reads).
// Each turn admits a free session for the selected model, runs the model's
// first-party agent via @codebuff/sdk with the session id attached, then
// releases the slot. Turns are serialized: the free tier holds one live slot
// per account.
//
// Sources (all MIT-licensed, public CodebuffAI/freebuff repo):
// - cli/src/utils/freebuff-session-api.ts (admission request shape/statuses)
// - common/src/constants/free-agents.ts (per-model agent ids)
// - sdk/src/{client,run}.ts (CodebuffClient.run with extraCodebuffMetadata)

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ProviderAdapter, ChatRequest, StreamChunk } from './base.js';
import type { ModelInfo, Message } from '../../shared/types.js';
import { clearProviderAuthFailure, noteProviderAuthFailure } from './health.js';

// www.codebuff.com on purpose: the apex domain 301/307-redirects here, and
// cross-host redirects strip the Authorization header (fetch spec) — requests
// through the apex arrive logged-out and every turn fails as if no key existed.
const FREEBUFF_BASE_URL = 'https://www.codebuff.com';
const ADMISSION_PATH = '/api/v1/freebuff/session/admission';
const SESSION_PATH = '/api/v1/freebuff/session';

const INSTANCE_HEADER = 'x-freebuff-instance-id';
const MODEL_HEADER = 'x-freebuff-model';
const WALLET_HEADER = 'x-freebuff-wallet-spend-limit';
const FIRST_TAB_DISCOUNT_HEADER = 'x-freebuff-first-tab-discount';

/** Known picker rows (wire ids) and the first-party agent root each runs on. */
const FREEBUFF_AGENT_ROOTS: Array<{ id: string; label: string; agent: string; multimodal: boolean }> = [
  { id: 'z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', agent: 'base3-free-glm-5-3-flash', multimodal: false },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', agent: 'base2-free-deepseek-v4-1-flash', multimodal: false },
  { id: 'openai/gpt-5.6-luna', label: 'GPT-5.6 Luna', agent: 'base3-free-luna', multimodal: true },
  { id: 'mimo/mimo-v2.5', label: 'MiMo 2.5', agent: 'base3-free-mimo', multimodal: true },
  { id: 'upstage/solar-pro4', label: 'Solar Pro 4', agent: 'base3-free-solar-pro4', multimodal: false },
  { id: 'meta/muse-spark-1.3-contributor', label: 'Muse Spark 1.3', agent: 'base3-free-muse-spark-1-3', multimodal: false },
  { id: 'meta/muse-spark-1.2-contributor', label: 'Muse Spark 1.2', agent: 'base3-free-muse-spark-1-2', multimodal: false },
  { id: 'google/gemini-3.8-flash', label: 'Gemini 3.8 Flash', agent: 'base3-free-gemini-3-8-flash', multimodal: true },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', agent: 'base3-free-deepseek-flash', multimodal: false },
  { id: 'crof/kimi-k3-eco', label: 'Kimi K3 Eco', agent: 'base3-free-kimi-k3-eco', multimodal: false },
];

const FREEBUFF_LABELS: Record<string, string> = Object.fromEntries(
  FREEBUFF_AGENT_ROOTS.map((e) => [e.id, e.label]),
);

function freebuffLabel(id: string): string {
  const known = FREEBUFF_LABELS[id];
  if (known) return known;
  return (id.split('/').pop() ?? id)
    .split(/[-_.]/g)
    .filter(Boolean)
    .map((part) => (/^\d/.test(part) ? part : `${part[0]!.toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

/** Agent root for a wire model id. Known rows use the CLI's exact agent ids;
 * unknown rows derive a base3 agent from the model tail (mirrors the CLI's
 * naming, so newly added server rows keep working without a code change). */
export function resolveFreebuffAgent(modelId: string): { agent: string; multimodal: boolean } {
  const known = FREEBUFF_AGENT_ROOTS.find((entry) => entry.id === modelId);
  if (known) return { agent: known.agent, multimodal: known.multimodal };
  const tail = (modelId.split('/').pop() ?? modelId).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { agent: `base3-free-${tail}`, multimodal: false };
}

/** Catalog builder: known rows first, then any ids the server's live price
 * table reports (the picker changes server-side without app releases). */
export function buildFreebuffCatalog(liveIds: readonly string[]): ModelInfo[] {
  const ids = [...new Set([...FREEBUFF_AGENT_ROOTS.map((e) => e.id), ...liveIds])].filter(Boolean);
  return ids
    .map((id) => ({ id, label: freebuffLabel(id), provider: 'freebuff', free: true, supports_tools: false }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const FREEBUFF_FREE_MODELS: ModelInfo[] = buildFreebuffCatalog([]);

// Wire ids surfaced by the live server picker (listModels) — streamChat also
// accepts these, so server-added models stay runnable without a release.
const liveCatalogIds = new Set<string>();

function freebuffConfigDir(): string {
  return join(homedir(), '.config', 'manicode');
}

function freebuffBinaryPath(): string | null {
  const exe = process.platform === 'win32' ? 'freebuff.exe' : 'freebuff';
  const direct = join(freebuffConfigDir(), exe);
  if (existsSync(direct)) return direct;
  for (const directory of (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['freebuff.exe', 'freebuff.cmd'] : ['freebuff']) {
      try {
        const full = join(directory.replace(/^"|"$/g, ''), name);
        if (existsSync(full)) return full;
      } catch { /* unreadable PATH entry */ }
    }
  }
  return null;
}

export function hasInstalledFreebuffCli(): boolean {
  return freebuffBinaryPath() !== null;
}

export async function getInstalledFreebuffVersion(): Promise<string | null> {
  try {
    const raw = await readFile(join(freebuffConfigDir(), 'freebuff-metadata.json'), 'utf8');
    const data = JSON.parse(raw) as { version?: unknown };
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

interface FreebuffCredentials {
  authToken: string;
  fingerprintId?: string;
}

/** The CLI's own login (same file the CLI reads). Never logged or exposed. */
export async function getFreebuffCredentials(): Promise<FreebuffCredentials | null> {
  try {
    const raw = await readFile(join(freebuffConfigDir(), 'credentials.json'), 'utf8');
    const data = JSON.parse(raw) as { default?: { authToken?: unknown; fingerprintId?: unknown } };
    const authToken = data.default?.authToken;
    if (typeof authToken !== 'string' || !authToken) return null;
    const fingerprintId = data.default?.fingerprintId;
    return { authToken, ...(typeof fingerprintId === 'string' ? { fingerprintId } : {}) };
  } catch {
    return null;
  }
}

export function freebuffLoginHint(): string {
  return 'Freebuff is not signed in. Run `freebuff login` in a terminal and complete the sign-in, then try again.';
}

type SessionStatus =
  | { status: 'active'; instanceId: string; model?: string }
  | { status: string; [key: string]: unknown };

async function admitFreebuffSession(
  token: string,
  model: string,
  signal?: AbortSignal,
): Promise<SessionStatus> {
  const res = await fetch(`${FREEBUFF_BASE_URL}${ADMISSION_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      [MODEL_HEADER]: model,
      [WALLET_HEADER]: '0',
      [FIRST_TAB_DISCOUNT_HEADER]: '0',
    },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403) {
    const probe = (await res.clone().json().catch(() => null)) as { status?: unknown } | null;
    const blocked = probe && (probe.status === 'country_blocked' || probe.status === 'banned');
    if (blocked) throw new Error('Freebuff free access is not available for this account or region.');
    throw new Error(freebuffLoginHint());
  }
  const raw = await res.text().catch(() => '');
  let body: SessionStatus | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    body = (parsed && typeof parsed === 'object' ? parsed : null) as SessionStatus | null;
  } catch {
    body = null;
  }
  // Typed statuses ride on non-2xx codes — read them before the generic
  // failure, mirroring the CLI's own session client.
  if (res.status === 429 && body && (body.status === 'rate_limited' || body.status === 'spend_limited' || body.status === 'ip_capped')) {
    if (body.status === 'rate_limited') throw new Error('Freebuff free tier is rate-limited right now. Wait a little and retry.');
    if (body.status === 'spend_limited') throw new Error('Freebuff free session budget is spent for now. Wait for the next window and retry.');
    throw new Error('Freebuff capped this network for free sessions. Try another network or wait and retry.');
  }
  if (res.status === 409 && body && (body.status === 'model_locked' || body.status === 'model_unavailable' || body.status === 'consent_required')) {
    if (body.status === 'consent_required') throw new Error('Freebuff needs a consent confirmation in the CLI first. Open `freebuff` once, accept, then retry.');
    throw new Error(`Freebuff model ${model} is not available right now. Pick another free model.`);
  }
  if (!res.ok || !body) {
    throw new Error(`Freebuff session admission failed (HTTP ${res.status})${raw ? `: ${raw.slice(0, 160)}` : ''}.`);
  }
  switch (body.status) {
    case 'active':
      if (!body.instanceId) throw new Error('Freebuff admitted no session instance. Try again.');
      return body;
    case 'rate_limited':
      throw new Error('Freebuff free tier is rate-limited right now. Wait a little and retry.');
    case 'spend_limited':
      throw new Error('Freebuff free session budget is spent for now. Wait for the next window and retry.');
    case 'ip_capped':
      throw new Error('Freebuff capped this network for free sessions. Try another network or wait and retry.');
    case 'model_locked':
    case 'model_unavailable':
      throw new Error(`Freebuff model ${model} is not available right now. Pick another free model.`);
    case 'consent_required':
      throw new Error('Freebuff needs a consent confirmation in the CLI first. Open `freebuff` once, accept, then retry.');
    case 'country_blocked':
    case 'banned':
      throw new Error('Freebuff free access is not available for this account or region.');
    default:
      throw new Error(`Freebuff session status: ${body.status}. Try again shortly.`);
  }
}

async function releaseFreebuffSession(token: string, instanceId: string): Promise<void> {
  try {
    await fetch(`${FREEBUFF_BASE_URL}${SESSION_PATH}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, [INSTANCE_HEADER]: instanceId },
      signal: AbortSignal.timeout(10_000),
    });
  } catch { /* slot release is best-effort */ }
}

function freebuffTranscript(messages: Message[], system?: string): string {
  const parts: string[] = [];
  if (system?.trim()) parts.push(`[System]\n${system.trim()}`);
  parts.push(
    ...messages.slice(-40).map((message) => {
      const content = message.content
        .map((block) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_result') {
            const value = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            return `[Tool result${block.is_error ? ' error' : ''}]: ${value}`;
          }
          if (block.type === 'tool_use') return `[Tool requested: ${block.name} ${JSON.stringify(block.input)}]`;
          if (block.type === 'image') return '[Image attached — this Freebuff model row may not see pixels; describe images in words.]';
          return '';
        })
        .filter(Boolean)
        .join('\n');
      return `${message.role.toUpperCase()}: ${content}`;
    }),
  );
  return parts.join('\n\n').slice(-40_000);
}

function extractRunText(output: unknown): string {
  if (!output || typeof output !== 'object') return typeof output === 'string' ? output : '';
  const o = output as Record<string, unknown>;
  for (const key of ['text', 'message', 'content', 'output']) {
    if (typeof o[key] === 'string' && (o[key] as string).trim()) return (o[key] as string).trim();
  }
  return '';
}

// One live free slot per account — serialize turns process-wide.
let freebuffQueueTail: Promise<void> = Promise.resolve();

async function acquireFreebuffSlot(): Promise<() => void> {
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const waitFor = freebuffQueueTail;
  freebuffQueueTail = current;
  await waitFor;
  return release;
}

interface FreebuffTurnEntry {
  id: string;
  label: string;
  agent: string;
  multimodal: boolean;
}

async function* runFreebuffTurn(
  req: ChatRequest,
  creds: FreebuffCredentials,
  entry: FreebuffTurnEntry,
): AsyncIterable<StreamChunk> {
  yield { type: 'provider_status', status: 'connecting', provider: 'freebuff', model: entry.id };
  let session: SessionStatus;
  try {
    session = await admitFreebuffSession(creds.authToken, entry.id, req.signal);
  } catch (e) {
    const message = (e as Error).message;
    // A rejected login fails every model identically — remember it briefly
    // so the plan skips this provider instead of grinding its catalog.
    if (/not signed in|401|403|invalid credential|unauthori[sz]ed|forbidden/i.test(message)) {
      noteProviderAuthFailure('freebuff');
    }
    yield { type: 'error', error: message };
    return;
  }
  if (session.status !== 'active') {
    yield { type: 'error', error: 'Freebuff admitted no session instance. Try again.' };
    return;
  }
  const instanceId = (session as { instanceId?: unknown }).instanceId;
  if (typeof instanceId !== 'string' || !instanceId) {
    yield { type: 'error', error: 'Freebuff admitted no session instance. Try again.' };
    return;
  }
  try {
    yield { type: 'provider_status', status: 'streaming', provider: 'freebuff', model: entry.id };
    const { CodebuffClient } = await import('@codebuff/sdk');
    const client = new CodebuffClient({ apiKey: creds.authToken, cwd: req.cwd ?? process.cwd() });

    const queue: StreamChunk[] = [];
    let wake: (() => void) | null = null;
    const notify = () => {
      const current = wake;
      wake = null;
      current?.();
    };
    let settled = false;
    let liveTextStreamed = false;
    const usage = { input: 0, output: 0 };

    const outcome = (async (): Promise<{ output?: unknown } | { failure: Error }> => {
      try {
        // NOTE: @codebuff/sdk@0.10.7 has no per-run usage callback or
        // instance-metadata passthrough, so usage stays zero and the
        // admission slot held above is what attributes the turn.
        const state = await client.run({
          agent: entry.agent,
          prompt: freebuffTranscript(req.messages, req.system),
          costMode: 'free',
          maxAgentSteps: 25,
          signal: req.signal,
          handleStreamChunk: (chunk: unknown) => {
            if (typeof chunk === 'string' && chunk) {
              liveTextStreamed = true;
              queue.push({ type: 'text_delta', text: chunk });
              notify();
            }
          },
        });
        return { output: (state as { output?: unknown }).output };
      } catch (error) {
        return { failure: error instanceof Error ? error : new Error(String(error)) };
      } finally {
        settled = true;
        notify();
      }
    })();

    while (true) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (settled) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (settled || queue.length > 0) resolve();
      });
    }
    const result = await outcome;
    if ('failure' in result) {
      const message = result.failure.message;
      if (/invalid credential|unauthori[sz]ed|forbidden|401|403/i.test(message)) {
        noteProviderAuthFailure('freebuff');
        yield { type: 'error', error: `${message} ${freebuffLoginHint()}` };
      } else {
        yield { type: 'error', error: message };
      }
      return;
    }
    // When live text already streamed, the final output would duplicate it.
    if (!liveTextStreamed) {
      const text = extractRunText(result.output);
      if (text) yield { type: 'text_delta', text };
    }
    const tail = extractRunText(result.output);
    if (!liveTextStreamed && !tail) {
      yield { type: 'error', error: 'Freebuff returned no text. Try again or pick another free model.' };
      return;
    }
    clearProviderAuthFailure('freebuff');
    yield { type: 'message_end', stop_reason: 'end_turn', usage };
  } finally {
    await releaseFreebuffSession(creds.authToken, instanceId);
  }
}

export const freebuff: ProviderAdapter = {
  id: 'freebuff',
  label: 'Freebuff (free)',
  requiresApiKey: false,
  defaultModel: 'z-ai/glm-5.3-flash',
  freeModels: FREEBUFF_FREE_MODELS,
  homepage: 'https://freebuff.com',

  async testConnection() {
    if (!hasInstalledFreebuffCli()) {
      return { ok: false, error: 'Freebuff CLI is not installed. Install it (`npm install -g freebuff`), then sign in (`freebuff login`) to use the free models with no API key.' };
    }
    const creds = await getFreebuffCredentials();
    if (!creds) return { ok: false, error: freebuffLoginHint() };
    try {
      const res = await fetch(`${FREEBUFF_BASE_URL}${SESSION_PATH}`, {
        headers: { Authorization: `Bearer ${creds.authToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: freebuffLoginHint() };
      // 404/no-session and active sessions both prove the login works.
      if (res.ok || res.status === 404) {
        clearProviderAuthFailure('freebuff');
        return { ok: true };
      }
      return { ok: false, error: `Freebuff returned HTTP ${res.status}.` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },

  async listModels() {
    if (!hasInstalledFreebuffCli()) return [];
    let models = FREEBUFF_FREE_MODELS.map((m) => ({ ...m }));
    // Live picker: the session endpoint's price table lists the models the
    // server currently offers (the picker changes server-side without an
    // app release). Falls back to the built-in catalog on any failure.
    try {
      const creds = await getFreebuffCredentials();
      if (creds) {
        const res = await fetch(`${FREEBUFF_BASE_URL}${SESSION_PATH}`, {
          headers: { Authorization: `Bearer ${creds.authToken}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const body = await res.json() as { prices?: Record<string, unknown> };
          const liveIds = Object.keys(body.prices ?? {}).filter((id) => typeof id === 'string' && id.includes('/'));
          if (liveIds.length > 0) {
            models = buildFreebuffCatalog(liveIds);
            liveCatalogIds.clear();
            for (const model of models) liveCatalogIds.add(model.id);
          }
        }
      }
    } catch { /* built-in catalog is the fallback */ }
    this.freeModels = models;
    return models;
  },

  async *streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    const creds = await getFreebuffCredentials();
    if (!creds) {
      yield { type: 'error', error: freebuffLoginHint() };
      return;
    }
    const entry: FreebuffTurnEntry = { id: req.model, label: freebuffLabel(req.model), ...resolveFreebuffAgent(req.model) };
    const knownModel = FREEBUFF_AGENT_ROOTS.some((m) => m.id === req.model)
      || FREEBUFF_FREE_MODELS.some((m) => m.id === req.model)
      || liveCatalogIds.has(req.model);
    if (!knownModel) {
      yield { type: 'error', error: `Unknown Freebuff model: ${req.model}. Pick one of: ${FREEBUFF_FREE_MODELS.map((m) => m.id).join(', ')}.` };
      return;
    }
    const releaseSlot = await acquireFreebuffSlot();
    try {
      yield* runFreebuffTurn(req, creds, entry);
    } finally {
      releaseSlot();
    }
  },
};
