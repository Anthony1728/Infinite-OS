import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as nodeHttpRequest, type IncomingMessage } from 'node:http';
import { request as nodeHttpsRequest } from 'node:https';
import { delimiter, join } from 'node:path';
import type { Message, ModelInfo } from '../../shared/types.js';
import type { ChatRequest, ProviderAdapter, StreamChunk } from './base.js';

const DEFAULT_URL = 'http://127.0.0.1:4096';
const ZEN_API_URL = 'https://opencode.ai/zen/v1';
const GO_API_URL = 'https://opencode.ai/zen/go/v1';

// Tracks whether each model ID came from the Zen or Go subscription tier so
// streamChat can configure the correct credential on the local runtime.
const modelTiers = new Map<string, 'zen' | 'go'>();
let starting: Promise<boolean> | null = null;
const rejectedFreeProviders = new Set<string>();
const rejectedFreeModels = new Set<string>();

// A run finishes when the model finishes — there is deliberately no task cap.
// But a *silent* connection (zero bytes on the response AND zero SSE events)
// is a wedged runtime, not a working one: without a watchdog a dead socket
// would stall the turn for hours. Sustained total silence is treated as a
// transient transport failure and retried with a fresh session instead.
export let OPENCODE_STALL_TIMEOUT_MS = 10 * 60_000;

/** Override the stall window (tests use short windows). */
export function setOpenCodeStallTimeout(ms: number): void {
  OPENCODE_STALL_TIMEOUT_MS = ms;
}

function resetDiscoveredModelFailures(): void {
  rejectedFreeProviders.clear();
  rejectedFreeModels.clear();
}

interface OpenCodeModel {
  id?: string;
  name?: string;
  providerID?: string;
  status?: string;
  family?: string;
  api?: { id?: string; url?: string; npm?: string };
  capabilities?: { toolcall?: boolean; input?: { text?: boolean }; output?: { text?: boolean } };
  cost?: { input?: number; output?: number };
}

interface OpenCodeProvider {
  id?: string;
  name?: string;
  models?: Record<string, OpenCodeModel>;
}

interface ProviderResponse {
  all?: OpenCodeProvider[];
  connected?: string[];
  default?: Record<string, string>;
}

interface ZenModelsResponse {
  data?: Array<{ id?: string; object?: string; owned_by?: string }>;
}

function cleanUrl(url?: string): string {
  return (url || DEFAULT_URL).replace(/\/+$/, '');
}

function authHeaders(): Record<string, string> {
  const password = process.env['OPENCODE_SERVER_PASSWORD'];
  if (!password) return {};
  const username = process.env['OPENCODE_SERVER_USERNAME'] || 'opencode';
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` };
}

interface OpenCodeCause {
  code?: string;
  address?: string;
  port?: number;
  message?: string;
}

// Node's fetch only reports `TypeError: fetch failed` for transport errors.
// The actionable detail (connection refused, timeout, reset…) is buried in
// `error.cause`, so surface it instead of letting "fetch failed" reach the UI.
export function describeOpenCodeFailure(error: unknown, target: string): Error {
  // undici wraps the code in `error.cause`; node:http reports it directly.
  const cause = (error as { cause?: OpenCodeCause }).cause ?? (error as OpenCodeCause);
  if (cause?.code) {
    const where = cause.address && cause.port ? ` ${cause.address}:${cause.port}` : '';
    let hint = '';
    if (/^(ECONNREFUSED|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL)$/.test(cause.code)) {
      hint = ' Is the OpenCode runtime running (opencode serve --pure --port 4096)?';
    } else if (/^(ECONNRESET|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT)$/.test(cause.code)) {
      hint = ' The OpenCode runtime did not respond in time. Restart it and try again.';
    }
    return new Error(`fetch failed: ${target}${where} ${cause.code}${cause.message ? ` (${cause.message})` : ''}.${hint}`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isTransientOpenCodeFailure(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false;
  const cause = (error as { cause?: { code?: string } }).cause;
  const code = cause?.code ?? '';
  return /^(ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|EADDRNOTAVAIL|ENOTFOUND|UND_ERR)/.test(code)
    || (code === '' && /fetch failed|stopped responding|HTTP\s*5\d\d|server\s*error/i.test(error instanceof Error ? error.message : String(error)));
}

/** Exponential backoff with 30% jitter. Keeps retries from hammering a
 *  recovering runtime while still failing fast on persistent errors. */
function openCodeRetryDelay(attempt: number, baseMs = 500): number {
  const exponential = baseMs * (2 ** attempt);
  const jitter = Math.random() * exponential * 0.3;
  return Math.min(exponential + jitter, 30_000);
}

async function openCodeRequest(
  input: string | URL,
  init?: RequestInit,
  target?: string,
  retries = 0,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      // Never re-issue non-idempotent bodies that were sent on a partial
      // attempt unless the caller opted in. GETs and fresh-session POSTs are
      // safe to retry; the caller passes a retry budget for those.
      if (attempt < retries && isTransientOpenCodeFailure(error)) {
        await new Promise((resolve) => setTimeout(resolve, openCodeRetryDelay(attempt)));
        continue;
      }
      throw describeOpenCodeFailure(error, target ?? String(input));
    }
  }
  throw describeOpenCodeFailure(lastError, target ?? String(input));
}

interface RawOpenCodeInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

// The opencode runtime's /message and /event endpoints are long-lived:
// /message only sends response headers once the whole model turn has finished
// and /event streams indefinitely. undici's default 300s headers/body timeouts
// kill both on long agent tasks, so drive them over Node's raw HTTP layer,
// which imposes no such timeouts. Requests stay cancellable via `signal`.
function rawOpenCodeRequest(url: string, init: RawOpenCodeInit): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const doRequest = parsed.protocol === 'https:' ? nodeHttpsRequest : nodeHttpRequest;
    const req = doRequest(parsed, {
      method: init.method ?? 'GET',
      headers: init.headers,
      ...(init.signal ? { signal: init.signal } : {}),
    });
    req.once('response', resolve);
    req.once('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function readBody(stream: IncomingMessage, signal?: AbortSignal, onActivity?: () => void): Promise<string> {
  let body = '';
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    body += chunk.toString();
    onActivity?.();
  }
  return body;
}

async function healthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await openCodeRequest(`${baseUrl}/global/health`, {
      headers: authHeaders(), signal: AbortSignal.timeout(3000),
    }, baseUrl);
    if (!response.ok) return false;
    const body = await response.json() as { healthy?: boolean };
    return body.healthy === true;
  } catch {
    return false;
  }
}

function executable(): string {
  if (process.platform !== 'win32') return 'opencode';
  const binary = process.env['APPDATA']
    ? join(process.env['APPDATA'], 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
    : '';
  if (binary && existsSync(binary)) return binary;
  const shim = process.env['APPDATA'] ? join(process.env['APPDATA'], 'npm', 'opencode.cmd') : '';
  return shim && existsSync(shim) ? shim : 'opencode.cmd';
}

export function hasInstalledOpenCodeCli(): boolean {
  const names = process.platform === 'win32' ? ['opencode.cmd', 'opencode.exe'] : ['opencode'];
  const explicit = process.platform === 'win32' && process.env['APPDATA']
    ? [
        join(process.env['APPDATA'], 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
        join(process.env['APPDATA'], 'npm', 'opencode.cmd'),
      ]
    : [];
  if (explicit.some((candidate) => existsSync(candidate))) return true;
  return (process.env['PATH'] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .some((directory) => names.some((name) => existsSync(join(directory.replace(/^"|"$/g, ''), name))));
}

async function ensureServer(baseUrl: string, cwd = process.cwd()): Promise<boolean> {
  if (await healthy(baseUrl)) return true;
  if (baseUrl !== DEFAULT_URL) return false;
  if (starting) return starting;
  starting = (async () => {
    try {
      // Server stderr goes to a real log file (not ignored): when the runtime
      // 500s a turn, its own error text is the only thing that names the cause.
      let errFd: number | undefined;
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const os = await import('node:os');
        const logPath = path.join(os.homedir(), '.infinite-ai', 'opencode-server.log');
        try { fs.mkdirSync(path.dirname(logPath), { recursive: true }); } catch { /* exists */ }
        errFd = fs.openSync(logPath, 'a');
      } catch { /* logging is best-effort; server still starts */ }
      const child = spawn(executable(), ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '4096'], {
        cwd, detached: true, stdio: ['ignore', 'ignore', errFd ?? 'ignore'], windowsHide: true,
        env: process.env,
      });
      child.unref();
      // Cold starts on slower machines can exceed a few seconds; wait up to
      // 20 seconds so a fresh runtime is never reported as unavailable.
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (await healthy(baseUrl)) return true;
      }
    } catch { /* reported by the connection test */ }
    return false;
  })().finally(() => { starting = null; });
  return starting;
}

function decodeModel(value: string): { providerID: string; modelID: string } {
  const separator = value.indexOf('::');
  if (separator > 0) return { providerID: value.slice(0, separator), modelID: value.slice(separator + 2) };
  const slash = value.indexOf('/');
  if (slash > 0) return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
  return { providerID: 'opencode', modelID: value || 'big-pickle' };
}

function quarantineFailure(selected: { providerID: string; modelID: string }, failure: string): void {
  if (/invalid api key|token (?:expired|incorrect)|expired (?:api )?key|unauthori[sz]ed|forbidden|authorization failed|\b401\b|\b403\b/i.test(failure)) {
    rejectedFreeProviders.add(selected.providerID);
  }
  if (/requested model is not valid|not found|404 page not found|\b404\b/i.test(failure)) {
    rejectedFreeModels.add(`${selected.providerID}::${selected.modelID}`);
  }
  // A persistent 5xx usually means the model is temporarily broken/overloaded
  // in the local runtime. Exclude it from the catalog so the next plan picks
  // a different model instead of repeatedly failing on the same one.
  if (/\b5\d\d\b|server\s*error|unexpected\s*server\s*error/i.test(failure)) {
    rejectedFreeModels.add(`${selected.providerID}::${selected.modelID}`);
  }
}

function transcript(messages: Message[]): string {
  // Bounded context: the last 120 messages / 300k chars. Full turns were
  // observed shipping 44k+ input tokens to shared free-tier models, which is
  // the dominant first-token latency driver. Tool results stay verbatim.
  return messages.slice(-120).map((message) => {
    const content = message.content.map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'tool_result') {
        const value = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        return `[Tool result${block.is_error ? ' error' : ''}]: ${value}`;
      }
      if (block.type === 'tool_use') return `[Tool requested: ${block.name} ${JSON.stringify(block.input)}]`;
      return '';
    }).filter(Boolean).join('\n');
    return `${message.role.toUpperCase()}: ${content}`;
  }).join('\n\n').slice(-300_000);
}

async function providerData(baseUrl: string): Promise<ProviderResponse> {
  const response = await openCodeRequest(`${baseUrl}/provider`, {
    headers: authHeaders(), signal: AbortSignal.timeout(30000),
  }, 'provider list', 2);
  if (!response.ok) throw new Error(`OpenCode returned HTTP ${response.status}.`);
  return response.json() as Promise<ProviderResponse>;
}

export function openCodeZenModels(data: ZenModelsResponse, tier: 'zen' | 'go' = 'zen'): ModelInfo[] {
  const seen = new Set<string>();
  return (data.data ?? [])
    .filter((model): model is { id: string; object?: string; owned_by?: string } =>
      Boolean(model.id && model.object !== 'embedding' && !seen.has(model.id) && seen.add(model.id)),
    )
    .map((model) => {
      const free = model.id === 'big-pickle' || /(?:^|[-_])free$/i.test(model.id);
      const label = model.id
        .split(/[-_]/g)
        .filter(Boolean)
        .map((part) => (/^\d/.test(part) ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
        .join(' ');
      const id = `opencode::${model.id}`;
      // First scan wins (Go is scanned before Zen): a model living in both
      // catalogs keeps its Go tier instead of being misrouted to Zen, where a
      // Go-only key gets rejected and the turn pointlessly fails over.
      if (!modelTiers.has(id)) modelTiers.set(id, tier);
      return {
        id,
        label: tier === 'go' ? `OpenCode Go / ${label}` : `OpenCode Zen / ${label}`,
        provider: 'opencode',
        free,
        supports_tools: true,
      };
    })
    .sort((a, b) => Number(b.free) - Number(a.free) || a.label.localeCompare(b.label));
}

async function scanRemoteModels(apiKey: string, baseUrl: string, tier: 'zen' | 'go'): Promise<ModelInfo[]> {
  const tierLabel = tier === 'go' ? 'Go' : 'Zen';
  const response = await openCodeRequest(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(20_000),
  }, `OpenCode ${tierLabel} model scan`, 2);
  if (response.status === 401 || response.status === 403) {
    throw new Error(`OpenCode ${tierLabel} rejected this API key. Create a current key at opencode.ai/auth and try again.`);
  }
  if (!response.ok) throw new Error(`OpenCode ${tierLabel} model scan failed (HTTP ${response.status}).`);
  const models = openCodeZenModels(await response.json() as ZenModelsResponse, tier);
  if (models.length === 0) throw new Error(`This OpenCode ${tierLabel} key did not return any usable models.`);
  return models;
}

async function configureRemoteCredential(baseUrl: string, apiKey: string, tier: 'zen' | 'go' = 'zen'): Promise<void> {
  if (!apiKey) return;
  const tierLabel = tier === 'go' ? 'Go' : 'Zen';
  const authPath = tier === 'go' ? 'opencode-go' : 'opencode';
  const response = await openCodeRequest(`${baseUrl}/auth/${authPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ type: 'api', key: apiKey }),
    signal: AbortSignal.timeout(10_000),
  }, `${tierLabel} credential save`);
  if (!response.ok) {
    throw new Error(`OpenCode could not save the ${tierLabel} credential (HTTP ${response.status}).`);
  }
  const saved = await response.json().catch(() => false);
  if (saved !== true) throw new Error(`OpenCode did not accept the ${tierLabel} credential.`);

  // A replacement credential should immediately restore a provider/model that
  // was quarantined after an earlier expired key.
  rejectedFreeProviders.delete('opencode');
  for (const id of [...rejectedFreeModels]) {
    if (id.startsWith('opencode::')) rejectedFreeModels.delete(id);
  }
}

function collectOpenCodeModels(data: ProviderResponse, includeZenSubscription: boolean, providerFilter?: Set<string>): ModelInfo[] {
  const connected = new Set(data.connected ?? []);
  const models: ModelInfo[] = [];
  for (const provider of data.all ?? []) {
    if (!provider.id || (providerFilter && !providerFilter.has(provider.id)) || !connected.has(provider.id) || rejectedFreeProviders.has(provider.id)) continue;
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const id = `${provider.id}::${modelID}`;
      if (rejectedFreeModels.has(id)) continue;
      if (model.status === 'deprecated') continue;
      if (model.capabilities?.input?.text === false || model.capabilities?.output?.text === false) continue;
      // OpenCode's catalog also contains embedding, reranking, speech, image and
      // safety endpoints. They may advertise text I/O, but cannot run a chat turn.
      const identity = `${modelID} ${model.name ?? ''} ${model.family ?? ''}`.toLowerCase();
      if (/(^|[\s/_-])(embed(ding)?|bge|rerank|whisper|transcri(be|ption)|tts|speech|moderation|esm\d*|esmfold|gliner|reward|classifier|guard|nvclip)([\s/_-]|$)/i.test(identity)) continue;
      const free = (model.cost?.input ?? 0) === 0 && (model.cost?.output ?? 0) === 0;
      if (!free && !(includeZenSubscription && provider.id === 'opencode')) continue;
      models.push({
        id,
        label: `${provider.name || provider.id} / ${model.name || modelID}`,
        provider: 'opencode', free,
        supports_tools: model.capabilities?.toolcall !== false,
      });
    }
  }
  return models.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 500);
}

interface OpenCodeBusEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

// Per-part text already emitted (part id -> full text). The runtime may
// re-publish parts, so deltas are computed against this. Bounded to avoid
// unbounded growth across long sessions.
const textSeen = new Map<string, string>();
// messageID -> role, learned from message.updated events. The runtime echoes
// the USER's own text back as parts too — those must never stream into the
// assistant bubble.
const messageRoles = new Map<string, string>();

export function openCodeProgressChunk(event: OpenCodeBusEvent, sessionID: string): StreamChunk | null {
  if (event.type === 'message.updated') {
    const info = (event.properties ?? {}).info as Record<string, unknown> | undefined;
    if (info && typeof info.id === 'string' && typeof info.role === 'string') {
      if (messageRoles.size > 500) messageRoles.clear();
      messageRoles.set(info.id, info.role);
    }
    return null;
  }
  if (event.type !== 'message.part.updated') return null;
  const properties = event.properties ?? {};
  const part = properties.part as Record<string, unknown> | undefined;
  if (!part || part.sessionID !== sessionID) return null;

  // Live text streaming: the runtime publishes text-part updates as the model
  // generates, so we can emit text_delta chunks before the final response.
  // Shape note (verified against opencode 1.17.20): text arrives FLAT on the
  // part (part.text), not nested under part.state — only the latter was read
  // before, which silently dropped every live chunk.
  if (part.type === 'text') {
    // Never stream the user's own echoed text into the answer.
    const partMessageId = typeof part.messageID === 'string' ? part.messageID : '';
    if (partMessageId && messageRoles.get(partMessageId) === 'user') return null;
    const state = (part.state ?? {}) as Record<string, unknown>;
    const raw = typeof part.text === 'string' && part.text
      ? part.text
      : typeof state.text === 'string' ? state.text : '';
    if (!raw) return null;
    // Parts may arrive as full snapshots (emit the unseen suffix) or true
    // deltas (emit whole); identical re-publishes emit nothing.
    const key = String(part.id ?? part.messageID ?? part.sessionID ?? '');
    const seen = key ? textSeen.get(key) ?? '' : '';
    if (raw === seen) return null;
    let delta = raw;
    if (key && seen && raw.startsWith(seen)) delta = raw.slice(seen.length);
    if (key) {
      if (textSeen.size > 500) textSeen.clear();
      textSeen.set(key, raw);
    }
    if (delta) return { type: 'text_delta', text: delta };
    return null;
  }

  if (part.type !== 'tool') return null;
  const state = (part.state ?? {}) as Record<string, unknown>;
  const statusValue = String(state.status ?? 'running');
  const status = statusValue === 'completed' ? 'completed' : statusValue === 'error' ? 'error' : 'running';
  const input = state.input;
  const title = typeof state.title === 'string' ? state.title : '';
  const output = typeof state.output === 'string' ? state.output : '';
  const error = typeof state.error === 'string' ? state.error : '';
  const inputSummary = input && typeof input === 'object'
    ? String((input as Record<string, unknown>).command ?? (input as Record<string, unknown>).path ?? '')
    : '';
  const detail = (error || title || inputSummary || output).slice(0, 1_200);
  return {
    type: 'provider_progress',
    id: String(part.callID ?? part.id ?? `${part.tool ?? 'tool'}-${Date.now()}`),
    name: String(part.tool ?? 'OpenCode tool'),
    status,
    input,
    ...(detail ? { detail } : {}),
  };
}

async function consumeSessionProgress(
  baseUrl: string,
  directory: string,
  sessionID: string,
  signal: AbortSignal,
  onReady: () => void,
  onChunk: (chunk: StreamChunk) => void,
  onActivity?: () => void,
): Promise<void> {
  let ready = false;
  const markReady = () => {
    if (ready) return;
    ready = true;
    onReady();
  };
  try {
    const suffix = directory ? `?directory=${encodeURIComponent(directory)}` : '';
    const response = await rawOpenCodeRequest(`${baseUrl}/event${suffix}`, {
      headers: { Accept: 'text/event-stream', ...authHeaders() },
      signal,
    });
    if (!response.statusCode || response.statusCode >= 400) return;
    markReady();
    let buffer = '';
    let eventData: string[] = [];
    const emit = () => {
      if (!eventData.length) return;
      // Only a real data event proves the runtime is alive. SSE keepalive
      // comments (": ping") must not reset the stall watchdog.
      onActivity?.();
      try {
        const decoded = JSON.parse(eventData.join('\n')) as OpenCodeBusEvent & { payload?: OpenCodeBusEvent };
        const chunk = openCodeProgressChunk(decoded.payload ?? decoded, sessionID);
        if (chunk) onChunk(chunk);
      } catch { /* ignore malformed telemetry; the model response still runs */ }
      eventData = [];
    };
    for await (const value of response) {
      if (signal.aborted) break;
      buffer += value.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line === '') emit();
        else if (line.startsWith('data:')) eventData.push(line.slice(5).trimStart());
      }
    }
    emit();
  } catch (error) {
    if (!signal.aborted) console.warn('[opencode] Live progress stream unavailable:', (error as Error).message);
  } finally {
    markReady();
  }
}

async function* streamSessionMessage(args: {
  baseUrl: string;
  directory?: string;
  sessionID: string;
  selected: { providerID: string; modelID: string };
  request: ChatRequest;
}): AsyncIterable<StreamChunk> {
  const controller = new AbortController();
  const signal = args.request.signal
    ? AbortSignal.any([args.request.signal, controller.signal])
    : controller.signal;
  const queue: StreamChunk[] = [];
  let wake: (() => void) | null = null;
  const notify = () => {
    const current = wake;
    wake = null;
    current?.();
  };
  let ready!: () => void;
  const readyPromise = new Promise<void>((resolve) => { ready = resolve; });
  let settled = false;
  // When the progress stream already delivered the model's text live, do not
  // re-emit the full text from the final response (avoids duplicate bubbles).
  let liveTextStreamed = false;

  // Liveness watchdog: any byte from the message response or any SSE event
  // proves the runtime is alive. Total silence for the stall window means the
  // runtime is wedged, so break the connection and let the caller retry with
  // a fresh session (the work is re-sent, nothing is lost).
  const stall = { lastActivity: Date.now(), triggered: false };
  const touch = () => { stall.lastActivity = Date.now(); };
  const watchdogTick = Math.max(50, Math.min(30_000, OPENCODE_STALL_TIMEOUT_MS / 10));
  const watchdog = setInterval(() => {
    if (stall.triggered || settled) return;
    if (Date.now() - stall.lastActivity >= OPENCODE_STALL_TIMEOUT_MS) {
      stall.triggered = true;
      controller.abort();
    }
  }, watchdogTick);

  const subscription = consumeSessionProgress(
    args.baseUrl,
    args.directory ?? '',
    args.sessionID,
    signal,
    ready,
    (chunk) => {
      if (chunk.type === 'text_delta') liveTextStreamed = true;
      queue.push(chunk);
      notify();
    },
    touch,
  );

  try {
    // Give the SSE subscription a chance to attach before dispatching work so
    // the first command is not lost. Telemetry is best-effort and never blocks
    // the actual model request for more than one second.
    await Promise.race([readyPromise, new Promise((resolve) => setTimeout(resolve, 50))]);
    const directory = args.directory ? `?directory=${encodeURIComponent(args.directory)}` : '';
    try {
      const dbgParts = JSON.stringify({ model: args.selected, agent: 'build', systemLen: (args.request.system ?? '').length, msgsLen: JSON.stringify(args.request.messages).length, tools: args.request.tools?.length ?? 0 });
      console.info(`[opencode] message ${dbgParts}`);
    } catch { /* debug only */ }
    type MessageResult = {
      info?: { error?: { data?: { message?: string }; name?: string }; tokens?: { input?: number; output?: number } };
      parts?: Array<{ type?: string; text?: string }>;
    };
    const requestPromise = (async (): Promise<{ result: MessageResult } | { failure: Error }> => {
      try {
        // The runtime only sends headers after the model turn completes, so use
        // Node's raw HTTP layer (no undici 300s header timeout) instead of
        // fetch(). There is deliberately no task timeout: a run finishes when
        // the model finishes, when the caller aborts, or when the stall
        // watchdog proves the connection is dead.
        const response = await rawOpenCodeRequest(`${args.baseUrl}/session/${encodeURIComponent(args.sessionID)}/message${directory}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            model: args.selected,
            agent: 'build',
            system: args.request.system,
            parts: [{ type: 'text', text: transcript(args.request.messages) }],
          }),
          signal,
        });
        const body = await readBody(response, signal, touch);
        if (!response.statusCode || response.statusCode >= 400) {
          throw new Error(`OpenCode message failed (HTTP ${response.statusCode}): ${body.slice(0, 240)}`);
        }
        return { result: JSON.parse(body || '{}') as MessageResult };
      } catch (error) {
        if (stall.triggered) {
          return {
            failure: new Error(
              `OpenCode runtime stopped responding (no activity for ${Math.round(OPENCODE_STALL_TIMEOUT_MS / 60_000)} minutes). Infinite OS will retry the run with a fresh session; if the runtime is hung, restart it.`,
            ),
          };
        }
        return { failure: describeOpenCodeFailure(error, 'model request') };
      }
    })().finally(() => {
      settled = true;
      notify();
    });

    while (true) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (settled) break;
      // Set the waiter first, then re-check: a chunk pushed between the shift
      // and the await would otherwise be missed until the next notification.
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (settled || queue.length > 0) resolve();
      });
    }
    controller.abort();
    const outcome = await requestPromise;
    await subscription.catch(() => undefined);
    if ('failure' in outcome) throw outcome.failure;
    const result = outcome.result;
    if (result.info?.error) {
      throw new Error(result.info.error.data?.message || result.info.error.name || 'OpenCode model request failed.');
    }
    const text = (result.parts ?? [])
      .filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text)
      .join('\n');
    if (text && !liveTextStreamed) yield { type: 'text_delta', text };
    yield {
      type: 'message_end',
      stop_reason: 'end_turn',
      usage: { input: result.info?.tokens?.input ?? 0, output: result.info?.tokens?.output ?? 0 },
    };
  } finally {
    clearInterval(watchdog);
  }
}

/** The other subscription tier — a key rejected by one is retried on the other. */
export function otherTier(tier: 'zen' | 'go'): 'zen' | 'go' {
  return tier === 'zen' ? 'go' : 'zen';
}

/** Test seam: which tier would a model id route to. */
export function tierFor(modelId: string): 'zen' | 'go' {
  return modelTiers.get(modelId) ?? 'zen';
}

/**
 * Whether a remote failure is worth retrying on the other tier: auth and
 * entitlement rejections (wrong tier, revoked key, unknown model) plus
 * server-side outages. Never user aborts.
 */
export function isTierRetryable(error: string): boolean {
  if (/abort|cancel/i.test(error)) return false;
  return /401|403|404|unauthori|forbidden|invalid.*key|expired|entitl|free.?tier|model.*not|not.*model|5\d\d|server error|bad gateway|service unavailable|gateway timeout/i.test(error);
}
/** One attempt against a single tier endpoint (Zen or Go). */
async function* attemptRemoteTier(req: ChatRequest, apiKey: string, tier: 'zen' | 'go'): AsyncGenerator<StreamChunk> {
  const endpoint = `${tier === 'go' ? GO_API_URL : ZEN_API_URL}/chat/completions`;
  const messages = toRemoteMessages(req.messages, req.system);
  const tools = req.tools?.length
    ? req.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }))
    : undefined;
  const maxAttempts = 3;
  let lastError = 'OpenCode remote request failed.';

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, openCodeRetryDelay(attempt)));
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: req.model.replace(/^opencode::/, ''),
          messages,
          tools,
          stream: true,
          max_tokens: req.max_tokens ?? 8192,
          temperature: req.temperature ?? 0.2,
        }),
        signal: req.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => '');
        lastError = `OpenCode ${tier} API returned HTTP ${response.status}: ${body.slice(0, 300)}`;
        if (response.status >= 500 && attempt < maxAttempts - 1) continue;
        yield { type: 'error', error: lastError };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const calls = new Map<string, { name: string; json: string }>();
      // OpenAI-compatible streams send the tool-call `id` only in the first
      // delta chunk of each call; every later chunk carries just `index`.
      // Keying by `id` alone splits one call into two records (name + empty
      // args, then args + empty name), producing exactly the malformed tool
      // calls seen as `Bash {}` and "empty tool name" errors. Key by the
      // stable `index` and remember the id it belongs to.
      const callIdByIndex = new Map<number, string>();
      let fallbackCallIndex = 0;
      const callKeyFor = (toolCall: { id?: string; index?: number }): string => {
        if (typeof toolCall.index === 'number') {
          if (toolCall.id) {
            callIdByIndex.set(toolCall.index, toolCall.id);
            return toolCall.id;
          }
          const known = callIdByIndex.get(toolCall.index);
          if (known) return known;
          const id = `call-${toolCall.index}`;
          callIdByIndex.set(toolCall.index, id);
          return id;
        }
        if (toolCall.id) return toolCall.id;
        return `call-${fallbackCallIndex++}`;
      };
      let ended = false;
      const flushCalls = function* (): Generator<StreamChunk> {
        for (const [id, call] of calls) {
          let input: unknown = {};
          try { input = JSON.parse(call.json || '{}'); } catch { /* malformed args become an explicit empty input */ }
          yield { type: 'tool_use_end', id, name: call.name, input };
        }
        calls.clear();
      };
      const emitLine = function* (line: string): Generator<StreamChunk> {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          yield* flushCalls();
          if (!ended) yield { type: 'message_end', stop_reason: 'end_turn', usage: { input: 0, output: 0 } };
          ended = true;
          return;
        }
        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ id?: string; index?: number; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const choice = parsed.choices?.[0];
          const delta = choice?.delta;
          if (delta?.content) yield { type: 'text_delta', text: delta.content };
          for (const toolCall of delta?.tool_calls ?? []) {
            const id = callKeyFor(toolCall);
            const existing = calls.get(id);
            if (!existing) {
              calls.set(id, { name: toolCall.function?.name ?? '', json: '' });
              yield { type: 'tool_use_start', id, name: toolCall.function?.name ?? '' };
            } else if (toolCall.function?.name) {
              existing.name = toolCall.function.name;
            }
            if (toolCall.function?.arguments) {
              calls.get(id)!.json += toolCall.function.arguments;
              yield { type: 'tool_use_delta', id, partial_json: toolCall.function.arguments };
            }
          }
          if (choice?.finish_reason) {
            yield* flushCalls();
            ended = true;
            yield {
              type: 'message_end',
              stop_reason: choice.finish_reason,
              usage: { input: parsed.usage?.prompt_tokens ?? 0, output: parsed.usage?.completion_tokens ?? 0 },
            };
          }
        } catch {
          // Ignore malformed SSE lines; a later finish/error event remains authoritative.
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) yield* emitLine(line);
      }
      if (buffer) yield* emitLine(buffer);
      if (!ended) {
        yield* flushCalls();
        yield { type: 'message_end', stop_reason: 'end_turn', usage: { input: 0, output: 0 } };
      }
      return;
    } catch (error) {
      if (req.signal?.aborted) {
        yield { type: 'error', error: 'Request cancelled.' };
        return;
      }
      lastError = (error as Error).message;
      if (attempt === maxAttempts - 1) {
        yield { type: 'error', error: `OpenCode ${tier} API error: ${lastError}` };
        return;
      }
    }
  }
}

type RemoteAttempt =
  | { ok: true; stream: AsyncGenerator<StreamChunk> }
  | { ok: false; error: string };

async function* prependBuffered(buffered: StreamChunk[], rest: AsyncGenerator<StreamChunk>): AsyncGenerator<StreamChunk> {
  try {
    yield* buffered;
    yield* rest;
  } finally {
    try {
      await rest.return(undefined);
    } catch { /* already closed */ }
  }
}

/**
 * Pull a remote attempt only up to the commit point (first text or terminal
 * chunk). Pre-text errors stay recoverable: the caller can retry another tier
 * or fall back to the local runtime without the user ever seeing a glitch.
 * Exported for tests.
 */
export async function tryRemote(req: ChatRequest, apiKey: string, tier: 'zen' | 'go'): Promise<RemoteAttempt> {
  const gen = attemptRemoteTier(req, apiKey, tier);
  const buffered: StreamChunk[] = [];
  // Manual next() loop (NOT for-await): exiting a for-await would close the
  // generator and the buffered-then-stream handoff would lose everything.
  try {
    while (true) {
      const { value, done } = await gen.next();
      if (done) break;
      if (value.type === 'error') {
        try {
          await gen.return(undefined);
        } catch { /* already closed */ }
        return { ok: false, error: value.error };
      }
      buffered.push(value);
      if (value.type === 'text_delta' || value.type === 'message_end') break;
    }
    return { ok: true, stream: prependBuffered(buffered, gen) };
  } catch (error) {
    try {
      await gen.return(undefined);
    } catch { /* already closed */ }
    return { ok: false, error: (error as Error).message };
  }
}

function noteTier(model: string, tier: 'zen' | 'go'): void {
  const selected = decodeModel(model);
  modelTiers.set(`${selected.providerID}::${selected.modelID}`, tier);
}

/**
 * Remote with cross-tier fallback: try the mapped tier, and on auth /
 * entitlement / outage rejections retry the other tier before giving up.
 * Records the winning tier so the next turn goes straight there.
 */
async function remoteWithFallback(req: ChatRequest, apiKey: string, tier: 'zen' | 'go'): Promise<RemoteAttempt> {
  const first = await tryRemote(req, apiKey, tier);
  if (first.ok) {
    noteTier(req.model, tier);
    return first;
  }
  if (!isTierRetryable(first.error)) return first;
  const other = otherTier(tier);
  const second = await tryRemote(req, apiKey, other);
  if (second.ok) {
    noteTier(req.model, other);
    return second;
  }
  return { ok: false, error: `${first.error} | ${other} retry: ${second.error}`.slice(0, 500) };
}

/** Use the authenticated OpenCode subscription API directly so Infinite OS's
 * own tools (Computer, Bash, files, bridge, etc.) remain the executable tool
 * surface. The local OpenCode runtime has a separate tool loop and only emits
 * telemetry for those calls, which makes API-key chat unable to act locally. */
export async function* streamRemoteOpenCode(req: ChatRequest, apiKey: string, tier: 'zen' | 'go'): AsyncIterable<StreamChunk> {
  const attempt = await remoteWithFallback(req, apiKey, tier);
  if (attempt.ok) yield* attempt.stream;
  else yield { type: 'error', error: attempt.error };
}

function toRemoteMessages(messages: Message[], system?: string): Array<Record<string, unknown>> {
  const output: Array<Record<string, unknown>> = [];
  if (system) output.push({ role: 'system', content: system });
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = message.content.filter((block) => block.type === 'text').map((block) => block.type === 'text' ? block.text : '').join('\n');
      const toolCalls = message.content.filter((block) => block.type === 'tool_use').map((block) => block.type === 'tool_use' ? {
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}) },
      } : null).filter(Boolean);
      output.push({ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    for (const block of message.content) {
      if (block.type === 'text') output.push({ role: 'user', content: block.text });
      if (block.type === 'tool_result') output.push({ role: 'tool', tool_call_id: block.tool_use_id, content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) });
      if (block.type === 'image') output.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${block.source.mediaType};base64,${block.source.data}` } }] });
    }
  }
  return output;
}

export function freeOpenCodeModels(data: ProviderResponse): ModelInfo[] {
  return collectOpenCodeModels(data, false);
}

export function availableOpenCodeModels(data: ProviderResponse, includeZenSubscription = false): ModelInfo[] {
  return collectOpenCodeModels(data, includeZenSubscription);
}

/**
 * OpenCode's own catalog (built-in `opencode` provider only) from the local
 * runtime. Used when no Infinite OS Zen/Go key is configured: the pane must
 * show the free models OpenCode offers with the installed CLI alone, never the
 * unrelated providers (NVIDIA, Ollama Cloud, GitHub Copilot, ...) that happen
 * to hold credentials inside the installed OpenCode CLI.
 */
export function openCodeOwnModels(data: ProviderResponse, includeZenSubscription = false): ModelInfo[] {
  return collectOpenCodeModels(data, includeZenSubscription, new Set(['opencode']));
}

export const opencode: ProviderAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  requiresApiKey: false,
  acceptsApiKey: true,
  defaultBaseUrl: DEFAULT_URL,
  defaultModel: '',
  homepage: 'https://opencode.ai',
  freeModels: [],

  async testConnection(apiKey, baseUrl) {
    const url = cleanUrl(baseUrl);
    try {
      if (apiKey) {
        let models: ModelInfo[] = [];
        let goError: Error | undefined;
        let zenError: Error | undefined;
        try {
          models = await scanRemoteModels(apiKey, GO_API_URL, 'go');
        } catch (error) {
          goError = error as Error;
        }
        if (models.length === 0) {
          try {
            models = await scanRemoteModels(apiKey, ZEN_API_URL, 'zen');
          } catch (error) {
            zenError = error as Error;
          }
        }
        if (models.length === 0) {
          const isCredentialError = (error?: Error) =>
            /unauthorized|forbidden|rejected this API key|invalid api key/i.test(error?.message ?? '');
          const isUnavailable = (error?: Error) => /not available|404/i.test(error?.message ?? '');
          let error: Error | undefined;
          if (isCredentialError(zenError)) error = zenError;
          else if (isCredentialError(goError)) error = goError;
          else if (zenError && !isUnavailable(zenError)) error = zenError;
          else error = goError ?? zenError;
          return { ok: false, error: error?.message ?? 'This API key did not expose any OpenCode models.' };
        }
        // Subscription validation is remote and does not require the optional
        // local OpenCode CLI. Authenticated chat uses the direct Go/Zen API.
        return { ok: true };
      }
      if (!await ensureServer(url)) {
        return { ok: false, error: 'OpenCode is not reachable. Install the OpenCode CLI or run `opencode serve --pure --port 4096`.' };
      }
      // Testing without an Infinite OS key is the explicit recovery path back
      // to credentials managed by the installed OpenCode CLI. Forget failures
      // from the previous credential/model so a repaired CLI login can be used
      // immediately instead of remaining quarantined until app restart.
      resetDiscoveredModelFailures();
      const data = await providerData(url);
      const models = openCodeOwnModels(data, (data.connected ?? []).includes('opencode'));
      return models.length > 0
        ? { ok: true }
        : { ok: false, error: 'OpenCode is running, but it did not report any usable OpenCode models. Sign in to OpenCode (`opencode auth login`) and try again.' };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  },

  async listModels(apiKey, baseUrl) {
    const url = cleanUrl(baseUrl);
    let models: ModelInfo[] = [];
    if (apiKey) {
      // OpenCode has two subscription tiers: Go and Zen. The same API key may
      // work for one or both. Try Go first, then Zen, and merge the catalogs.
      const goModels: ModelInfo[] = [];
      const zenModels: ModelInfo[] = [];
      try { goModels.push(...await scanRemoteModels(apiKey, GO_API_URL, 'go')); } catch { /* empty */ }
      try { zenModels.push(...await scanRemoteModels(apiKey, ZEN_API_URL, 'zen')); } catch { /* empty */ }
      const seen = new Set<string>();
      models = [...goModels, ...zenModels].filter((m) => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      // A Zen/Go key selects the OpenCode catalog. Do not merge unrelated
      // providers (NVIDIA, Ollama Cloud, GitHub Copilot, etc.) that happen to
      // be connected in the installed CLI; those have their own credentials
      // and were the reason the OpenCode settings pane showed the wrong list.
      // Do not start or require a local CLI server for remote subscription catalogs.
    } else {
      if (!await ensureServer(url)) return [];
      try {
        const data = await providerData(url);
        models = openCodeOwnModels(data, (data.connected ?? []).includes('opencode'));
      } catch {
        try { models = openCodeOwnModels(await providerData(url)); } catch { /* empty */ }
      }
    }
    // Cache the latest model list on the adapter so failover planning can fall
    // back to another OpenCode model when the currently selected one fails.
    this.freeModels = models;
    return models;
  },

  async *streamChat(req: ChatRequest, apiKey: string, baseUrl?: string): AsyncIterable<StreamChunk> {
    const url = cleanUrl(baseUrl);
    const selected = decodeModel(req.model);
    const modelId = `${selected.providerID}::${selected.modelID}`;
    const tier = modelTiers.get(modelId) ?? 'zen';
    const freeTier = selected.modelID === 'big-pickle' || /(?:^|[-_])free$/i.test(selected.modelID);
    if (apiKey && selected.providerID === 'opencode') {
      // Remote-first for EVERY keyed model, free-tier included: a valid key is
      // the fastest path and never touches the local runtime's failure modes.
      // Only when the remote API rejects the turn before producing text do we
      // fall through to the local server (free-tier entitlement lives there).
      const remote = await remoteWithFallback(req, apiKey, tier);
      if (remote.ok) {
        yield* remote.stream;
        return;
      }
      if (!freeTier) {
        yield { type: 'error', error: remote.error };
        return;
      }
      console.info(`[opencode] remote attempt rejected (${remote.error.slice(0, 140)}); using local runtime for free-tier model`);
    }
    if (!await ensureServer(url, req.cwd)) {
      yield { type: 'error', error: 'OpenCode server is unavailable.' };
      return;
    }
    // Credential rule: the CLI's own stored auth (oauth/subscription) always
    // wins. PUTting a pasted key over it breaks working free-tier auth with
    // server 500s — so only configure the pasted key when the local server
    // has NO opencode credential of its own.
    if (apiKey && selected.providerID === 'opencode') {
      let cliHasAuth = false;
      try {
        const data = await providerData(url);
        cliHasAuth = (data.connected ?? []).includes('opencode');
      } catch { /* unknown — fall through to configuring the pasted key */ }
      console.info(`[opencode] turn model=${req.model} freeTier=${freeTier} keySaved=true cliHasAuth=${cliHasAuth}`);
      if (!cliHasAuth) {
        try {
          await configureRemoteCredential(url, apiKey, tier);
        } catch (error) {
          const tierLabel = tier === 'go' ? 'Go' : 'Zen';
          yield { type: 'error', error: `OpenCode: could not configure ${tierLabel} credential: ${(error as Error).message}` };
          return;
        }
      }
    }
    // A Zen key selects the OpenCode Zen catalog. Models shown in the
    // UI were already validated against the Zen API, so when apiKey is
    // present we don't re-check against the local provider catalog.
    // The local catalog may not include subscription-only models.
    if (!apiKey) {
      try {
        const data = await providerData(url);
        const allowed = openCodeOwnModels(
          data,
          selected.providerID === 'opencode' && (data.connected ?? []).includes('opencode'),
        );
        if (!allowed.some((model) => model.id === `${selected.providerID}::${selected.modelID}`)) {
          throw new Error(`The selected OpenCode model is not currently available: ${req.model}`);
        }
      } catch (error) {
        yield { type: 'error', error: `OpenCode: ${(error as Error).message}` };
        return;
      }
    }
    const directoryPath = req.cwd ?? '';
    const directory = directoryPath ? `?directory=${encodeURIComponent(directoryPath)}` : '';

    // A momentary blip against the local runtime (cold start, restart, busy
    // stream) must not kill the whole agent turn. Re-create a fresh session
    // and re-send the message on transient transport failures only.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let sessionID = '';
      try {
        const sessionResponse = await openCodeRequest(`${url}/session${directory}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ title: 'Infinite OS provider run' }), signal: req.signal,
        }, 'session create', 1);
        if (!sessionResponse.ok) throw new Error(`Could not create OpenCode session (HTTP ${sessionResponse.status}).`);
        const session = await sessionResponse.json() as { id?: string };
        sessionID = session.id ?? '';
        if (!sessionID) throw new Error('OpenCode did not return a session ID.');

        try {
          for await (const chunk of streamSessionMessage({
            baseUrl: url,
            directory: directoryPath,
            sessionID,
            selected,
            request: req,
          })) {
            yield chunk;
          }
        } catch (error) {
          quarantineFailure(selected, (error as Error).message);
          if (attempt < MAX_ATTEMPTS - 1 && isTransientOpenCodeFailure(error) && !req.signal?.aborted) {
            yield { type: 'provider_status', status: 'cold_start', provider: 'opencode', model: req.model,
              reason: 'The OpenCode runtime connection dropped; retrying with a fresh session.' };
            await new Promise((resolve) => setTimeout(resolve, openCodeRetryDelay(attempt)));
            if (await ensureServer(url, req.cwd)) continue;
          }
          throw error;
        }
        return;
      } catch (error) {
        if (attempt < MAX_ATTEMPTS - 1 && isTransientOpenCodeFailure(error) && !req.signal?.aborted) {
          yield { type: 'provider_status', status: 'cold_start', provider: 'opencode', model: req.model,
            reason: 'The OpenCode runtime was not ready; retrying.' };
          await new Promise((resolve) => setTimeout(resolve, openCodeRetryDelay(attempt)));
          if (await ensureServer(url, req.cwd)) continue;
        }
        yield { type: 'error', error: `OpenCode: ${(error as Error).message}` };
        return;
      } finally {
        if (sessionID) {
          openCodeRequest(`${url}/session/${encodeURIComponent(sessionID)}`, {
            method: 'DELETE', headers: authHeaders(), signal: AbortSignal.timeout(5000),
          }, 'session cleanup').catch(() => undefined);
        }
      }
    }
  },
};
