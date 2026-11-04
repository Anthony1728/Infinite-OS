import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { request as nodeHttpRequest, type IncomingMessage } from 'node:http';
import { request as nodeHttpsRequest } from 'node:https';
import { delimiter, join } from 'node:path';
import type { ContentBlock, Message, ModelInfo } from '../../shared/types.js';
import type { ChatRequest, ProviderAdapter, StreamChunk } from './base.js';
import { clearProviderAuthFailure, isProviderAuthKnownBad, noteProviderAuthFailure } from './health.js';

const DEFAULT_URL = 'http://127.0.0.1:4096';
const ZEN_API_URL = 'https://opencode.ai/zen/v1';
const GO_API_URL = 'https://opencode.ai/zen/go/v1';

// Tracks whether each model ID came from the Zen or Go subscription tier so
// streamChat can configure the correct credential on the local runtime.
const modelTiers = new Map<string, 'zen' | 'go'>();
let starting: Promise<boolean> | null = null;
const rejectedFreeProviders = new Set<string>();
const rejectedFreeModels = new Set<string>();
// Last free model that completed a turn. Quotas gate per model per hour, so
// after a 429 the fastest recovery is the model that most recently answered
// — not the next name alphabetically (which may itself be retired or gated).
let lastGoodFreeModel: string | null = null;

/** Test seam: remember (or forget, with null) the model that last answered. */
export function setLastGoodFreeModel(id: string | null): void {
  lastGoodFreeModel = id;
}

/** Test seam: most-recently-answering candidate first, stable otherwise. */
export function orderFreeRotation(selectedId: string, candidateIds: string[]): string[] {
  if (lastGoodFreeModel && lastGoodFreeModel !== selectedId) {
    const idx = candidateIds.indexOf(lastGoodFreeModel);
    if (idx > 0) return [candidateIds[idx]!, ...candidateIds.slice(0, idx), ...candidateIds.slice(idx + 1)];
  }
  return [...candidateIds];
}
// Cache credential configuration to avoid PUT /auth on every turn.
const configuredCredentials = new Set<string>();

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

let OPENCODE_FIRST_BYTE_TIMEOUT_MS = 120_000;

/** First-byte budget before a quiet free-tier turn rotates models. */
export function openCodeFirstByteTimeoutMs(): number {
  return OPENCODE_FIRST_BYTE_TIMEOUT_MS;
}

/** Override the first-byte budget (tests use short budgets). */
export function setOpenCodeFirstByteTimeout(ms: number): void {
  OPENCODE_FIRST_BYTE_TIMEOUT_MS = ms;
}

/**
 * How often a live-but-quiet turn reminds the caller it is still working.
 * Scales with the stall window so tests with short windows never emit one,
 * while production turns heartbeat well inside the 60s agent watchdog.
 */
export function openCodeHeartbeatIntervalMs(): number {
  return Math.max(5_000, Math.min(30_000, Math.floor(OPENCODE_STALL_TIMEOUT_MS / 3)));
}

/** True when a waiting turn owes the caller a still-working notice. */
export function heartbeatDue(lastNoticeAt: number, nowMs: number, intervalMs: number): boolean {
  return nowMs - lastNoticeAt >= intervalMs;
}

// The CLI's stored login can die (expired/revoked) while the runtime stays
// healthy and keeps listing models. Every turn then burns a minute-plus of
// upstream retries before failing — and the agent watchdog aborts at 60s with
// "stalled", hiding the true cause. Remember the failure briefly (persisted
// across restarts by provider-health, so each launch doesn't re-burn a
// minute) so repeat turns fail fast with the login hint instead of stalling
// again. TTL is short on purpose: a repaired login must unblock quickly.
let cliCredentialBadAt = 0;
const CLI_CREDENTIAL_BAD_TTL_MS = 5 * 60_000;

/** Test seam: mark the CLI credential as rejected upstream. */
export function noteInvalidCliCredential(): void {
  cliCredentialBadAt = Date.now();
  noteProviderAuthFailure('opencode');
}

/** Test seam: forget a recorded credential failure. */
export function clearInvalidCliCredential(): void {
  cliCredentialBadAt = 0;
  clearProviderAuthFailure('opencode');
}

export function isCliCredentialKnownBad(nowMs = Date.now()): boolean {
  if (cliCredentialBadAt > 0 && nowMs - cliCredentialBadAt < CLI_CREDENTIAL_BAD_TTL_MS) return true;
  return isProviderAuthKnownBad('opencode', nowMs);
}

function noteCliCredentialOutcome(failure: string): void {
  if (/invalid credential|unauthori[sz]ed|forbidden|\b401\b|\b403\b/i.test(failure)) {
    noteInvalidCliCredential();
  }
}

/**
 * Minimum installed CLI for the free tier. Older runtimes proxy free-tier
 * turns to opencode.ai/zen, which rejects them with HTTP 426
 * ("OpenCode 1.18.0 or newer is required to use the free tier").
 */
export const OPENCODE_MIN_FREE_VERSION = '1.18.0';

/** Numeric semver compare: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isOpenCodeVersionAtLeast(version: string | null | undefined, min = OPENCODE_MIN_FREE_VERSION): boolean {
  if (!version) return false;
  return compareVersions(version, min) >= 0;
}

/** Installed CLI version (`opencode --version`), or null when not installed. */
export async function getInstalledOpenCodeVersion(): Promise<string | null> {
  try {
    const { spawnSync } = await import('node:child_process');
    const exe = executable();
    const result = spawnSync(exe, ['--version'], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
      // .cmd shims only run through the shell on Windows.
      shell: process.platform === 'win32' && exe.toLowerCase().endsWith('.cmd'),
    });
    if (result.error || result.status !== 0) return null;
    const match = /(\d+\.\d+\.\d+)/.exec(String(result.stdout ?? ''));
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Actionable hint when a turn fails because the runtime predates the free
 * tier gate. Returns null for unrelated errors.
 */
export function openCodeUpgradeHint(error: string): string | null {
  if (/\b426\b|upgrade.?required|newer is required/i.test(error)) {
    return `The OpenCode runtime is too old for the free tier (needs v${OPENCODE_MIN_FREE_VERSION}+). Upgrade the CLI (\`npm i -g opencode-ai@latest\`) and restart the runtime server (Settings → AI Provider → OpenCode → Restart runtime).`;
  }
  return null;
}

/** Prefix a raw OpenCode error, appending the CLI-upgrade hint when it applies. */
export function withUpgradeHint(message: string): string {
  const hint = openCodeUpgradeHint(message);
  return hint ? `OpenCode: ${message} ${hint}` : `OpenCode: ${message}`;
}

/**
 * Hint when the runtime's stored login is rejected upstream (expired or
 * revoked `opencode auth login` session). Returns null for other errors.
 */
export function openCodeAuthLoginHint(error: string): string | null {
  if (/invalid credential|invalid.*api.?key|unauthori[sz]ed|forbidden/i.test(error)
    && /upstream|credential|auth/i.test(error)) {
    return 'The installed CLI signed in before, but its login is expired or revoked. Refresh it with `opencode auth login`, then retry.';
  }
  return null;
}

/**
 * Hint when a paid turn fails for lack of funds. Returns null for other errors.
 */
export function openCodeFundsHint(error: string): string | null {
  if (/insufficient account funds|insufficient.*funds|\b402\b/i.test(error)) {
    return 'The OpenCode account has no funds for paid models. Top up at opencode.ai, wait for the free-tier reset, or switch to a free provider (nvidia / groq / apinex) in Settings → AI Provider.';
  }
  return null;
}

/** Prefix a raw OpenCode error, appending upgrade, auth, and funds hints when they apply. */
export function withOpenCodeHints(message: string): string {
  const hints = [openCodeUpgradeHint(message), openCodeAuthLoginHint(message), openCodeFundsHint(message)].filter(Boolean);  return hints.length ? `OpenCode: ${message} ${hints.join(' ')}` : `OpenCode: ${message}`;
}

function resetDiscoveredModelFailures(): void {
  rejectedFreeProviders.clear();
  rejectedFreeModels.clear();
  configuredCredentials.clear();
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
    || (code === '' && /fetch failed|stopped responding|timed out|timeout|HTTP\s*5\d\d|server\s*error/i.test(error instanceof Error ? error.message : String(error)));
}

/** Exponential backoff with 30% jitter. Keeps retries from hammering a
 *  recovering runtime while still failing fast on persistent errors. */
function openCodeRetryDelay(attempt: number, baseMs = 500): number {
  const exponential = baseMs * (2 ** attempt);
  const jitter = Math.random() * exponential * 0.3;
  return Math.min(exponential + jitter, 30_000);
}

/**
 * Combine the caller's signal with a hard timeout so a wedged runtime can't
 * hold a turn silently forever: the outer agent watchdog would otherwise fire
 * first and the turn would die as a bare "operation was aborted". The caller's
 * own abort reason still wins (AbortSignal.any keeps the first reason), so a
 * user stop is never misreported as a timeout.
 */
export function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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

/** Running runtime version from /global/health, or null when unreachable. */
export async function openCodeServerVersion(baseUrl: string = DEFAULT_URL): Promise<string | null> {
  try {
    const response = await openCodeRequest(`${cleanUrl(baseUrl)}/global/health`, {
      headers: authHeaders(), signal: AbortSignal.timeout(3000),
    }, baseUrl);
    if (!response.ok) return null;
    const body = await response.json() as { healthy?: boolean; version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

function isStaleForFreeTier(version: string | null): boolean {
  return Boolean(version) && /^\d+\.\d+\.\d+/.test(version as string) && !isOpenCodeVersionAtLeast(version);
}

/** PID listening on 127.0.0.1:port (our managed runtime port), or null. */
async function pidListeningOnPort(port: number): Promise<number | null> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)('netstat', ['-ano'], {
        encoding: 'utf8', timeout: 10_000, windowsHide: true,
      });
      for (const line of String(stdout).split('\n')) {
        const m = /^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(line);
        if (m && Number(m[2]) === port && (m[1] === '127.0.0.1' || m[1] === '0.0.0.0')) return Number(m[3]);
      }
      return null;
    }
    const { stdout } = await promisify(execFile)('lsof', ['-ti', `:${port}`], {
      encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    const pid = Number(String(stdout).trim().split('\n')[0]);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function killPortOwner(port: number): Promise<boolean> {
  const pid = await pidListeningOnPort(port);
  if (pid === null) return true;
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    if (process.platform === 'win32') {
      await promisify(execFile)('taskkill', ['/PID', String(pid), '/F'], { timeout: 15_000, windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if ((await pidListeningOnPort(port)) === null) return true;
    }
    return (await pidListeningOnPort(port)) === null;
  } catch {
    return (await pidListeningOnPort(port)) === null;
  }
}

/**
 * Restart our managed runtime (DEFAULT_URL only) when the running server
 * predates the free-tier gate. Returns the server version afterwards, or
 * null when no healthy server could be established.
 */
export async function restartStaleOpenCodeServer(baseUrl: string = DEFAULT_URL, cwd = process.cwd()): Promise<string | null> {
  const url = cleanUrl(baseUrl);
  if (url !== DEFAULT_URL) return openCodeServerVersion(url);
  const current = await openCodeServerVersion(url);
  // Unknown version (health without a version field): nothing to heal.
  if (current === null) return null;
  // A runtime that lists no keyless models lost its upstream access (expired
  // CLI login, cleared auth) — restarting with the CLI re-syncs the catalog.
  if (!isStaleForFreeTier(current)) {
    try {
      const data = await providerData(url);
      if (openCodeKeylessModels(data).length > 0) return current;
      console.info('[opencode] runtime lists no keyless models — restarting with the installed CLI.');
    } catch { /* fall through to restart */ }
  } else {
    console.info(`[opencode] runtime v${current} predates free-tier gate v${OPENCODE_MIN_FREE_VERSION}.`);
  }
  console.info(`[opencode] runtime v${current} needs a restart (free-tier gate v${OPENCODE_MIN_FREE_VERSION} or a lost catalog) — restarting with the installed CLI.`);  await killPortOwner(4096);
  if (!await ensureServer(url, cwd)) return null;
  return openCodeServerVersion(url);
}

/**
 * Best-effort self-heal before an installed-CLI (keyless) turn: when the
 * running server is too old for the free tier, restart it so the turn can
 * proceed. Returns true when a usable server is in place.
 */
async function ensureFreeTierServer(baseUrl: string, cwd?: string): Promise<boolean> {
  const version = await restartStaleOpenCodeServer(baseUrl, cwd ?? process.cwd());
  if (version !== null) return true;
  return ensureServer(cleanUrl(baseUrl), cwd);
}

/**
 * Resolve the installed OpenCode CLI to a concrete binary when possible.
 * Returns null when no CLI is installed. Prefers .exe on Windows because a
 * bare 'opencode.cmd' fallback cannot be spawned without shell:true
 * (ENOENT) — the old fallback broke every non-npm install layout on Windows
 * (native installer, scoop, pnpm, manual PATH) even though the CLI was there.
 */
function resolveOpenCodeExecutable(): string | null {
  if (process.platform !== 'win32') return 'opencode';
  const explicit = process.env['APPDATA']
    ? [
        join(process.env['APPDATA'], 'npm', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
        join(process.env['APPDATA'], 'npm', 'opencode.cmd'),
      ]
    : [];
  for (const candidate of explicit) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  // Any other install layout: accept opencode.exe first (spawns directly),
  // then opencode.cmd (spawned through the shell — see ensureServer).
  for (const directory of (process.env['PATH'] ?? '').split(delimiter).filter(Boolean)) {
    const clean = directory.replace(/^"|"$/g, '');
    for (const name of ['opencode.exe', 'opencode.cmd']) {
      try {
        const full = join(clean, name);
        if (existsSync(full)) return full;
      } catch { /* unreadable PATH entry */ }
    }
  }
  return null;
}

export function hasInstalledOpenCodeCli(): boolean {
  if (process.platform !== 'win32') {
    return (process.env['PATH'] ?? '')
      .split(delimiter)
      .filter(Boolean)
      .some((directory) => {
        try {
          return existsSync(join(directory.replace(/^"|"$/g, ''), 'opencode'));
        } catch {
          return false;
        }
      });
  }
  return resolveOpenCodeExecutable() !== null;
}

function executable(): string {
  if (process.platform !== 'win32') return 'opencode';
  // Bare 'opencode' lets Windows resolve opencode.exe via PATH (a bare
  // 'opencode.cmd' fallback would ENOENT without shell:true).
  return resolveOpenCodeExecutable() ?? 'opencode';
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
      const exe = executable();
      const child = spawn(exe, ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '4096'], {
        cwd, detached: true, stdio: ['ignore', 'ignore', errFd ?? 'ignore'], windowsHide: true,
        env: process.env,
        // .cmd shims cannot be spawned directly on Windows (ENOENT) — run
        // them through the shell. .exe binaries spawn directly.
        shell: process.platform === 'win32' && exe.toLowerCase().endsWith('.cmd'),
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
  // A free-tier version gate (426) is a client problem, not a model problem:
  // never blame or exclude the model for it.
  if (/\b426\b|upgrade.?required|newer is required/i.test(failure)) return;
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

/** Extract text from a structured tool result, omitting images/files (their
 * base64 would otherwise be dumped inline and explode the request size). */
function toolResultText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content.map((block) => {
    if (block.type === 'text') return block.text;
    if (block.type === 'image' || block.type === 'file') return '[image omitted]';
    if (block.type === 'tool_use') return `[Tool requested: ${block.name}]`;
    if (block.type === 'tool_result') return toolResultText(block.content);
    return '';
  }).filter(Boolean).join('\n');
}

/** Strip embedded blobs (data URIs, long base64 runs) that bloat requests
 * past what small free-tier models accept. */
function stripBlobs(text: string): string {
  return text
    .replace(/data:[^,\s;]*;base64,[A-Za-z0-9+/=]+/g, '[embedded data omitted]')
    .replace(/[A-Za-z0-9+/]{500,}={0,2}/g, '[long blob omitted]');
}

/** Test seam: flatten history into the lean text the local runtime receives. */
export function transcript(messages: Message[]): string {
  // Match the official TUI's lean request shape: small and text-only. The
  // local runtime injects ~40k tokens of its own project context, and every
  // turn here uses a FRESH session (no server-side history), so pasting our
  // full history as one giant text part tips small free-tier models into
  // HTTP 400 (payload/context too large) or burns the hourly token quota
  // into 429s — while the TUI's tiny same-session requests sail through
  // with 200s. Keep the recent task context, drop the weight.
  const MAX_MESSAGES = 15;
  const MAX_TOTAL = 12_000;
  const MAX_TOOL_RESULT = 2_000;
  const MAX_TEXT_BLOCK = 4_000;
  const out: string[] = [];
  for (const message of messages.slice(-MAX_MESSAGES)) {
    const blocks: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') {
        const clean = stripBlobs(block.text).slice(0, MAX_TEXT_BLOCK);
        if (clean.trim()) blocks.push(clean);
      } else if (block.type === 'tool_result') {
        const raw = stripBlobs(toolResultText(block.content));
        const clean = raw.length > MAX_TOOL_RESULT
          ? `${raw.slice(0, MAX_TOOL_RESULT)}\n...[tool output truncated]...`
          : raw;
        blocks.push(`[Tool result${block.is_error ? ' error' : ''}]: ${clean}`);
      } else if (block.type === 'tool_use') {
        // The input JSON (file contents, commands) can be huge; the result
        // above already carries what matters. Keep just the invocation.
        let input = '';
        try {
          input = JSON.stringify(block.input ?? {}).slice(0, 300);
        } catch { /* unstringifiable input */ }
        blocks.push(`[Tool requested: ${block.name}${input && input !== '{}' ? ` ${input}` : ''}]`);
      }
      // image/file/question/pair blocks never travel: images are base64
      // weight, the rest is UI-only.
    }
    if (blocks.length) out.push(`${message.role.toUpperCase()}: ${blocks.join('\n')}`);
  }
  return out.join('\n\n').slice(-MAX_TOTAL);
}

/** The local runtime brings its own agent, tools, and ~40k tokens of project
 * context — it needs the task, not our 18k-char operating bible (which 500s
 * small free-tier models). Keep identity + autonomy + the sharp edges. */
function localRuntimeSystem(fullSystem: string | undefined): string {
  const head = (fullSystem ?? '').split('\n').filter((l) => /uncensored|permission|profile/i.test(l)).slice(0, 4).join('\n');
  return [
    'You are Infinite AI inside Infinite OS, acting on the user\'s own PC with their full permission. Follow the user request; be concise; act with your tools and verify results.',
    head,
  ].filter(Boolean).join('\n');
}

/** Plain-language error for a CLI model that isn't offered right now —
 * names what the installed CLI actually serves so the user can pick it. */
export function openCodeUnavailableError(reqModel: string, allowed: Array<{ id: string }>): string {
  const options = allowed.slice(0, 20).map((m) => m.id).join(', ') || 'none';
  return `The selected OpenCode model is not currently available: ${reqModel}. Installed-CLI models right now: ${options}. Model fallback is OFF.`;
}

/** Test seam: resolve a requested OpenCode model against the live catalog.
 * Server-side retirements (e.g. big-pickle) fall back to a live model instead
 * of bricking the installed-CLI path; returns switched=false when exact. */
export function resolveLiveOpenCodeModel(reqModel: string, allowed: Array<{ id: string; free?: boolean }>): { providerID: string; modelID: string; switched: boolean; fallbackId: string | null } {
  const selected = decodeModel(reqModel);
  if (allowed.some((model) => model.id === `${selected.providerID}::${selected.modelID}`)) {
    return { ...selected, switched: false, fallbackId: null };
  }
  const fallback = allowed.find((model) => model.id.startsWith('opencode::'))
    ?? allowed.find((model) => model.id.startsWith('opencode-go::'))
    ?? allowed.find((model) => model.free ?? true);
  if (!fallback) return { ...selected, switched: false, fallbackId: null };
  const sep = fallback.id.indexOf('::');
  const fallbackProvider = sep > 0 ? fallback.id.slice(0, sep) : 'opencode';
  const fallbackModelID = sep > 0 ? fallback.id.slice(sep + 2) : fallback.id;
  return { providerID: fallbackProvider, modelID: fallbackModelID, switched: true, fallbackId: fallback.id };
}

/**
 * The runtime's message POST can hang past the caller's patience while it
 * retries upstream (rate-limited free turns and model-not-found both
 * misreport as hangs — the real reason only arrives on the event bus).
 * Bus events (openCodeProgressChunk) prove liveness, so a turn with zero
 * output for this long is treated as dead and the bus reason surfaces.
 * Generous by design: long *working* turns keep streaming through the bus.
 */
export let OPENCODE_QUIET_TURN_TIMEOUT_MS = 3 * 60_000;

/** Override the quiet-turn window (tests use short windows). */
export function setOpenCodeQuietTurnTimeout(ms: number): void {
  OPENCODE_QUIET_TURN_TIMEOUT_MS = ms;
}

/**
 * Identify a wedged free-tier turn from a `session.status` bus event:
 * the runtime retries upstream with type "retry" and never returns the
 * HTTP response, so "reason" here comes from the session status payload.
 */
export function openCodeQuietTurnTimeoutReasons(event: unknown): { timedOut: boolean; reason: string | null } {
  const status = (event as { type?: string; properties?: { status?: { type?: string; action?: { reason?: string }; message?: string; next?: number } } })
    .properties?.status;
  if (!status || status.type !== 'retry') return { timedOut: false, reason: null };
  const actionReason = status.action?.reason ?? '';
  const message = status.message ?? '';
  const next = typeof status.next === 'number' ? status.next : null;
  const waitMin = next ? Math.max(1, Math.round((next - Date.now()) / 60_000)) : null;
  if (/free_tier_limit|rate.?limit|usage/i.test(`${actionReason} ${message}`)) {
    return {
      timedOut: true,
      reason: `OpenCode free tier limit reached${waitMin ? ` — resets in ~${waitMin} min` : ''}. ${message} Pick another free model, wait for the reset, use a free provider (nvidia / groq / apinex), or subscribe at opencode.ai/go.`,
    };
  }
  return { timedOut: true, reason: `OpenCode runtime is retrying upstream: ${message || actionReason || 'unknown reason'}.` };
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
  // Skip if this exact key+tier was already configured successfully.
  const cacheKey = `${tier}:${apiKey.slice(0, 16)}`;
  if (configuredCredentials.has(cacheKey)) return;
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
  configuredCredentials.add(cacheKey);

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
      // Keyless local runtime serves the CLI's own logins: free `opencode`
      // models plus the subscription catalogs (`opencode` paid, `opencode-go`)
      // that the installed CLI is signed into — no pasted key needed.
      if (!free && !(includeZenSubscription && (provider.id === 'opencode' || provider.id === 'opencode-go'))) continue;
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

/** Local-runtime providers served keyless through the installed CLI. */
const OPENCODE_KEYLESS_IDS = new Set(['opencode', 'opencode-go']);

/**
 * Keyless catalog: everything the installed CLI can serve without a pasted
 * key — free `opencode` models plus the CLI's subscription logins
 * (`opencode` paid, `opencode-go`). Paid entries carry free=false so the UI
 * and rotation can tell them apart.
 */
export function openCodeKeylessModels(data: ProviderResponse): ModelInfo[] {
  return collectOpenCodeModels(data, true, OPENCODE_KEYLESS_IDS);
}

/** Counts behind the keyless catalog (Settings status, diagnostics). */
export async function openCodeKeylessStatus(baseUrl: string = DEFAULT_URL): Promise<{
  connected: string[];
  opencodeCount: number;
  goCount: number;
  freeCount: number;
} | null> {
  try {
    const data = await providerData(cleanUrl(baseUrl));
    const connected = data.connected ?? [];
    const models = openCodeKeylessModels(data);
    return {
      connected,
      opencodeCount: models.filter((m) => m.id.startsWith('opencode::')).length,
      goCount: models.filter((m) => m.id.startsWith('opencode-go::')).length,
      freeCount: models.filter((m) => m.free).length,
    };
  } catch {
    return null;
  }
}

interface OpenCodeBusEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

// Per-part text already emitted (part id -> full text). The runtime may
// re-publish parts, so deltas are computed against this. Bounded to avoid
// unbounded growth across long sessions.
const textSeen = new Map<string, string>();
const reasoningSeen = new Map<string, string>();
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
    // Assistant failures (model not found, upstream rejections) publish an
    // error on the message info instead of failing the HTTP POST, which
    // would otherwise hang the turn until the stall watchdog fires.
    const infoError = info?.error as { data?: { message?: string }; name?: string } | undefined;
    if (info?.role === 'assistant' && infoError) {
      return {
        type: 'provider_status',
        status: 'error',
        provider: 'opencode',
        reason: String(infoError.data?.message ?? infoError.name ?? 'The model request failed.'),
      } as unknown as StreamChunk;
    }
    return null;
  }
  if (event.type === 'session.status') {
    // "retry" statuses (free-tier limit, upstream outage) surface as plain
    // status lines instead of an indefinite silent hang.
    const quiet = openCodeQuietTurnTimeoutReasons(event);
    if (quiet.reason) {
      return { type: 'provider_status', status: 'rate_limited', provider: 'opencode', reason: quiet.reason };
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

  // Reasoning parts stream separately from the answer so the chat can show a
  // live "thinking" panel. Snapshot/delta handling mirrors text parts above.
  if (part.type === 'reasoning' || part.type === 'thinking') {
    const state = (part.state ?? {}) as Record<string, unknown>;
    const raw = typeof part.text === 'string' && part.text
      ? part.text
      : typeof state.text === 'string' ? state.text : '';
    if (!raw) return null;
    const key = String(part.id ?? part.messageID ?? part.sessionID ?? '');
    const seen = key ? reasoningSeen.get(key) ?? '' : '';
    if (raw === seen) return null;
    let delta = raw;
    if (key && seen && raw.startsWith(seen)) delta = raw.slice(seen.length);
    if (key) {
      if (reasoningSeen.size > 500) reasoningSeen.clear();
      reasoningSeen.set(key, raw);
    }
    if (delta) return { type: 'thinking_delta', text: delta };
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
  // Reasoning may arrive live (SSE parts) or only in the final message parts.
  // Track which so the answer is never preceded by a duplicate thinking block.
  let liveReasoningStreamed = false;
  // Fails-fast state: when the turn produced zero output (no bus chunks at
  // all) the runtime is retrying upstream — rate limits and model-not-found
  // both look like hangs. Abort with a sentinel the first-byte wrapper
  // translates into a plain-language, rotation-worthy failure. Any real bus
  // activity re-arms the timer, so long *working* turns keep streaming.
  let quietTurnTimer: ReturnType<typeof setTimeout> | null = null;
  const armQuietTurnTimer = () => {
    if (quietTurnTimer) clearTimeout(quietTurnTimer);
    quietTurnTimer = setTimeout(() => {
      if (settled) return;
      controller.abort(new Error('__quiet_turn_timeout__'));
    }, OPENCODE_QUIET_TURN_TIMEOUT_MS);
    quietTurnTimer.unref?.();
  };
  const disarmQuietTurnTimer = () => {
    if (quietTurnTimer) {
      clearTimeout(quietTurnTimer);
      quietTurnTimer = null;
    }
  };
  let busFailure: string | null = null;

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
      if (chunk.type === 'thinking_delta') liveReasoningStreamed = true;
      // A provider_status error chunk carries the real failure (model not
      // found, upstream rejection). Capture it and break the wedged POST —
      // its response never arrives on these errors.
      if (chunk.type === 'provider_status' && (chunk as { status?: string }).status === 'error') {
        const reason = String((chunk as { reason?: string }).reason ?? 'The model request failed.');
        // Terminal only when nothing streamed yet and the error is the kind
        // that never recovers on this model (model not found, upstream
        // rejection, quota). Mid-run step errors after real output do NOT
        // end the turn — the runtime keeps working.
        if (!liveTextStreamed && /not.?found|not.?valid|rate.?limit|insufficient|unauthori[sz]ed|forbidden|free.?tier|quota|entitl/i.test(reason)) {
          busFailure = reason;
          settled = true;
          controller.abort();
          notify();
          return;
        }
      }
      // Free-tier exhaustion arrives as rate_limited (session.status retry
      // with free_tier_limit) while the message POST hangs indefinitely.
      // Fail fast with the reset time instead of burning the 3-minute quiet
      // window per model — the quota is account-wide, so rotating cannot help.
      if (chunk.type === 'provider_status' && (chunk as { status?: string }).status === 'rate_limited') {
        const reason = String((chunk as { reason?: string }).reason ?? '');
        if (!liveTextStreamed && /free.?tier|free usage exceeded|subscribe to go|rate.?limit|quota|429/i.test(reason)) {
          busFailure = reason;
          settled = true;
          controller.abort();
          notify();
          return;
        }
      }
      // Any bus activity proves the turn is alive; only total silence for
      // the quiet window means the runtime is stuck retrying upstream.
      armQuietTurnTimer();
      queue.push(chunk);
      notify();
    },
    touch,
  );
  armQuietTurnTimer();

  try {
    // Give the SSE subscription a chance to attach before dispatching work so
    // the first command is not lost. Telemetry is best-effort and never blocks
    // the actual model request for more than one second.
    await Promise.race([readyPromise, new Promise((resolve) => setTimeout(resolve, 50))]);
    const directory = args.directory ? `?directory=${encodeURIComponent(args.directory)}` : '';
    // Built once so the debug line reports the exact payload that ships.
    const messageText = transcript(args.request.messages);
    try {
      const dbgParts = JSON.stringify({ model: args.selected, agent: 'build', systemLen: (args.request.system ?? '').length, msgsLen: JSON.stringify(args.request.messages).length, tools: args.request.tools?.length ?? 0, textLen: messageText.length });
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
            system: localRuntimeSystem(args.request.system),
            parts: [{ type: 'text', text: messageText }],
          }),
          signal,
        });
        const body = await readBody(response, signal, touch);
        if (!response.statusCode || response.statusCode >= 400) {
          throw new Error(`OpenCode message failed (HTTP ${response.statusCode}): ${body.slice(0, 500)}`);
        }
        return { result: JSON.parse(body || '{}') as MessageResult };
      } catch (error) {
        // The quiet-turn sentinel (zero output while the runtime retries
        // upstream) becomes a plain-language, rotation-worthy failure here.
        if (signal.reason instanceof Error && signal.reason.message === '__quiet_turn_timeout__') {
          return {
            failure: new Error(
              'OpenCode runtime returned no output — it is retrying upstream (free-tier rate limit or an unavailable model). Rotating to another free model.',
            ),
          };
        }
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

    let lastBeat = Date.now();
    while (true) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (settled) break;
      // Wake periodically so a live-but-quiet runtime can say it is still
      // working: those notices keep agent watchdogs from mistaking a long
      // upstream wait for a wedged connection. They deliberately do NOT touch
      // the true-silence watchdog above.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, openCodeHeartbeatIntervalMs());
        timer.unref?.();
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
        if (settled || queue.length > 0) wake();
      });
      if (!settled && queue.length === 0 && heartbeatDue(lastBeat, Date.now(), openCodeHeartbeatIntervalMs())) {
        lastBeat = Date.now();
        yield {
          type: 'provider_status',
          status: 'streaming',
          provider: 'opencode',
          model: `${args.selected.providerID}::${args.selected.modelID}`,
          reason: 'OpenCode runtime is still working — no output yet.',
        };
      }
    }
    controller.abort();
    const outcome = await requestPromise;
    await subscription.catch(() => undefined);
    disarmQuietTurnTimer();
    if (busFailure) {
      // The bus named the failure (rate limit, model not found). A hung POST
      // may still reject with the same text later — prefer the bus reason.
      throw new Error(busFailure);
    }
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
    const reasoning = (result.parts ?? [])
      .filter((part) => (part.type === 'reasoning' || part.type === 'thinking') && part.text)
      .map((part) => part.text)
      .join('\n');
    if (reasoning && !liveReasoningStreamed) yield { type: 'thinking_delta', text: reasoning };
    yield {
      type: 'message_end',
      stop_reason: 'end_turn',
      usage: { input: result.info?.tokens?.input ?? 0, output: result.info?.tokens?.output ?? 0 },
    };
  } finally {
    clearInterval(watchdog);
    disarmQuietTurnTimer();
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
    // eslint-disable-next-line no-constant-condition
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

/**
 * Wrap a session stream with a first-byte budget. Free-tier turns that get
 * rate-limited server-side otherwise hang indefinitely with zero bytes;
 * this aborts the attempt so the caller can rotate to another free model
 * instead of burning minutes on a wedged turn.
 */
async function* streamWithFirstByteTimeout(
  args: Parameters<typeof streamSessionMessage>[0],
  ms: number,
): AsyncIterable<StreamChunk> {
  const attempt = new AbortController();
  const parent = args.request.signal;
  const onParentAbort = () => attempt.abort(parent?.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });
  let firstByte = false;
  const timer = setTimeout(() => {
    if (!firstByte) attempt.abort(new Error('__first_byte_timeout__'));
  }, ms);
  timer.unref?.();
  try {
    for await (const chunk of streamSessionMessage({
      ...args,
      request: { ...args.request, signal: attempt.signal },
    })) {
      if (!firstByte) {
        firstByte = true;
        clearTimeout(timer);
      }
      yield chunk;
    }
  } catch (e) {
    const reason = (attempt.signal.reason as Error | undefined)?.message;
    if (!firstByte && reason === '__first_byte_timeout__') {
      throw new Error(
        `OpenCode free tier gave no response in ${Math.round(ms / 1000)}s — likely rate-limited, trying another free model.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  }
}

export const opencode: ProviderAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  requiresApiKey: false,
  acceptsApiKey: true,
  defaultBaseUrl: DEFAULT_URL,
  defaultModel: '',
  homepage: 'https://opencode.ai',
  freeModels: [
    { id: 'opencode::big-pickle', label: 'OpenCode / Big Pickle', provider: 'opencode', free: true, supports_tools: true },
  ],

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
      // KEYLESS: free-tier turns via the installed CLI.
      if (!await ensureServer(url)) {
        if (!hasInstalledOpenCodeCli()) {
          return { ok: false, error: 'OpenCode CLI is not installed. Install it (`npm i -g opencode-ai`), then sign in (`opencode auth login`) to use the free models with no API key.' };
        }
        return { ok: false, error: 'OpenCode is not reachable. Run `opencode serve --pure --port 4096`, or sign in (`opencode auth login`) and try again.' };
      }
      // A stale runtime (predating the free-tier gate) lists models fine but
      // fails every turn with 426 — restart it now so setup ends usable.
      await ensureFreeTierServer(url);
      resetDiscoveredModelFailures();
      const data = await providerData(url);
      const models = openCodeKeylessModels(data);
      if (models.length === 0) {
        const connected = (data.connected ?? []).join(', ') || 'none';
        return { ok: false, error: `OpenCode is running, but no signed-in catalog is available (connected: ${connected}). Sign in to OpenCode (\`opencode auth login\`) and try again.` };      }
      // A repaired login must unblock immediately, not after the TTL.
      clearInvalidCliCredential();
      return { ok: true };
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
        // Free-tier ids are OpenCode-client-only upstream (403 for any other
        // client) — they can only be served by the local CLI runtime, never
        // the remote Zen/Go API. List only paid models the pasted key can serve.
        if (m.free) return false;
        return true;
      });
      // A Zen/Go key selects the OpenCode catalog. Do not merge unrelated
      // providers (NVIDIA, Ollama Cloud, GitHub Copilot, etc.) that happen to
      // be connected in the installed CLI; those have their own credentials
      // and were the reason the OpenCode settings pane showed the wrong list.
      // Do not start or require a local CLI server for remote subscription catalogs.
    } else {
      // KEYLESS: free-tier turns via the installed CLI.
      if (!await ensureServer(url)) return this.freeModels;
      try {
        const data = await providerData(url);
        models = openCodeKeylessModels(data);
      } catch {
        try { models = openCodeKeylessModels(await providerData(url)); } catch { /* keep fallback */ }
      }
      if (models.length === 0) return this.freeModels;
    }
    // Cache the latest model list on the adapter so failover planning can fall
    // back to another OpenCode model when the currently selected one fails.
    this.freeModels = models;
    return models;
  },

  async *streamChat(req: ChatRequest, apiKey: string, baseUrl?: string): AsyncIterable<StreamChunk> {
    const url = cleanUrl(baseUrl);
    let selected = decodeModel(req.model);
    let modelId = `${selected.providerID}::${selected.modelID}`;
    const tier = modelTiers.get(modelId) ?? 'zen';
    const freeTier = selected.modelID === 'big-pickle' || /(?:^|[-_])free$/i.test(selected.modelID);
    if (apiKey && selected.providerID === 'opencode' && !freeTier) {
      // Subscription models run remotely: the local runtime's free-tier CLI
      // login cannot serve paid Zen models (402 without funds).
      yield { type: 'provider_status', status: 'connecting', provider: 'opencode', model: modelId,
        reason: 'Contacting the OpenCode API…' };
      const remote = await remoteWithFallback(req, apiKey, tier);
      if (remote.ok) {
        yield* remote.stream;
        return;
      }
      yield { type: 'error', error: remote.error };
      return;
    }
    if (apiKey && freeTier) {
      // Free models are OpenCode-client-only upstream (403 FreeTierError for
      // every other client) — they run on the local runtime with the CLI's
      // own login. Skip the doomed remote attempt entirely.
      console.info('[opencode] free-tier model: running on the local runtime (remote API serves free turns only to the OpenCode client).');
    }
    // A recently rejected CLI login fails every turn the same way after a
    // minute of upstream retries — fail fast with the fix instead of
    // stalling into the agent watchdog again.
    if (!apiKey && selected.providerID === 'opencode' && isCliCredentialKnownBad()) {
      yield { type: 'error', error: `OpenCode: the installed CLI login was just rejected upstream. ${openCodeAuthLoginHint('Invalid credential') ?? 'Refresh it with `opencode auth login`, then retry.'}` };
      return;
    }
    if (!await ensureServer(url, req.cwd)) {
      yield { type: 'error', error: hasInstalledOpenCodeCli()
        ? 'OpenCode server is unavailable. Run `opencode serve --pure --port 4096` and try again.'
        : 'OpenCode CLI is not installed. Install it (`npm i -g opencode-ai`), then sign in (`opencode auth login`) to use the free models with no API key.' };
      return;
    }
    // Installed-CLI turns die with 426 on a stale runtime — heal it before
    // the turn instead of failing into failover.
    if (!apiKey && !await ensureFreeTierServer(url, req.cwd)) {
      yield { type: 'error', error: 'OpenCode server is unavailable. Run `opencode serve --pure --port 4096` and try again.' };
      return;
    }
    // Credential rule: free models always run on the CLI's own stored auth —
    // never PUT a pasted key over a working CLI login (it caused server 500s).
    // A pasted key is only configured when the runtime has no opencode
    // credential at all, so a fresh install with a pasted subscription key
    // can still reach paid models through the runtime.
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
    // Validate the selection against the LOCAL runtime catalog for keyed
    // free models too: keyed lists come from the remote Zen scan, which
    // carries free models the local runtime cannot resolve (the turn then
    // hangs as ProviderModelNotFoundError). Subscription (non-free) models
    // were validated remotely in listModels and never touch the runtime.
    if (apiKey && freeTier) {
      try {
        yield { type: 'provider_status', status: 'connecting', provider: 'opencode', model: modelId,
          reason: 'Checking the installed CLI model catalog…' };
        const data = await providerData(url);
        const connected = openCodeKeylessModels(data);
        // A free selection must fall back to a FREE model — the first catalog
        // hit may be a paid model the runtime would reject with a funds error.
        const allowed = connected.filter((model) => model.free);
        if (!allowed.some((model) => model.id === `${selected.providerID}::${selected.modelID}`)) {
          const resolved = resolveLiveOpenCodeModel(req.model, allowed.length ? allowed : connected);
          if (!resolved.switched || !resolved.fallbackId) {
            yield { type: 'error', error: openCodeUnavailableError(req.model, allowed) };
            return;
          }
          console.info(`[opencode] ${req.model} (keyed) not in local catalog; running ${resolved.fallbackId} instead`);
          yield { type: 'provider_status', status: 'failover', provider: 'opencode', model: resolved.fallbackId, from: req.model, to: resolved.fallbackId, reason: `${req.model} is served by the local runtime as ${resolved.fallbackId}.` };
          selected = { providerID: resolved.providerID, modelID: resolved.modelID };
          modelId = `${selected.providerID}::${selected.modelID}`;
        }
      } catch (error) {
        if (req.signal?.aborted) {
          yield { type: 'error', error: 'Request cancelled.' };
          return;
        }
        yield { type: 'error', error: `OpenCode: ${(error as Error).message}` };
        return;
      }
    }
    if (!apiKey) {
      try {
        // The catalog read can stall against a wedged runtime with zero
        // output; announce liveness first so the outer agent watchdog keeps
        // waiting instead of aborting the turn as "operation was aborted".
        yield { type: 'provider_status', status: 'connecting', provider: 'opencode', model: modelId,
          reason: 'Checking the installed CLI model catalog…' };
        const data = await providerData(url);
        const allowed = openCodeKeylessModels(data);
        if (!allowed.some((model) => model.id === `${selected.providerID}::${selected.modelID}`)) {
          // Server-side retirements (e.g. big-pickle) must not brick the
          // installed-CLI path: fall back to a live catalog model instead of
          // failing the turn. The user sees which model actually answered.
          // With the fallback kill-switch OFF, never substitute — fail
          // plainly and name what the CLI actually offers.
          const resolved = resolveLiveOpenCodeModel(req.model, allowed);
          if (!resolved.switched || !resolved.fallbackId) throw new Error(`The selected OpenCode model is not currently available: ${req.model}`);
          const { settings } = await import('../settings/store.js');
          if (settings.get('failoverEnabled') === false) {
            throw new Error(openCodeUnavailableError(req.model, allowed));
          }
          console.info(`[opencode] ${req.model} not in live catalog; falling back to ${resolved.fallbackId}`);
          yield { type: 'provider_status', status: 'failover', provider: 'opencode', model: resolved.fallbackId, from: req.model, to: resolved.fallbackId, reason: `${req.model} is no longer offered — using ${resolved.fallbackId} instead.` };
          selected = { providerID: resolved.providerID, modelID: resolved.modelID };
          modelId = `${selected.providerID}::${selected.modelID}`;
        }
      } catch (error) {
        // A caller abort (user stop, agent watchdog) is a cancellation, not a
        // provider failure — report it plainly.
        if (req.signal?.aborted) {
          yield { type: 'error', error: 'Request cancelled.' };
          return;
        }
        // A fallback switch already yielded a status above — only hard-fail
        // when there is genuinely nothing to fall back to.
        if (modelId === `${decodeModel(req.model).providerID}::${decodeModel(req.model).modelID}`) {
          yield { type: 'error', error: `OpenCode: ${(error as Error).message}` };
          return;
        }
      }
    }
    const directoryPath = req.cwd ?? '';
    const directory = directoryPath ? `?directory=${encodeURIComponent(directoryPath)}` : '';

    // Free-tier rotation: individual free models get rate-limited per hour
    // (429 FreeUsageLimitError) while others answer fine. Instead of hanging
    // on the selected model, rotate through live free models until one
    // answers — using the tier the way OpenCode itself does.
    const { settings: rotationSettings } = await import('../settings/store.js');
    const rotationAllowed = rotationSettings.get('failoverEnabled') !== false;
    let rotation: Array<{ providerID: string; modelID: string }> = [{ ...selected }];
    const isKeylessSelection = selected.providerID === 'opencode' || selected.providerID === 'opencode-go';
    if (rotationAllowed && isKeylessSelection) {      try {
        // Same silent-read hazard as the catalog check above: announce
        // liveness before the fetch.
        yield { type: 'provider_status', status: 'connecting', provider: 'opencode', model: modelId,
          reason: 'Checking which free models are answering…' };
        const rotationCatalog = await providerData(url);
        const selfId = `${selected.providerID}::${selected.modelID}`;
        const liveFreeIds = orderFreeRotation(
          selfId,
          openCodeKeylessModels(rotationCatalog)
            .filter((m) => m.free && m.id !== selfId)
            .slice(0, 2)            .map((m) => m.id),
        );
        const liveFree = liveFreeIds.map((id) => {
          const sep = id.indexOf('::');
          return sep > 0
            ? { providerID: id.slice(0, sep), modelID: id.slice(sep + 2) }
            : { providerID: 'opencode', modelID: id };
        });
        if (liveFree.length) rotation = [{ ...selected }, ...liveFree];
      } catch { /* rotation falls back to the selected model only */ }
    }

    // One model attempt: fresh session, stream with a first-byte budget,
    // retrying transient transport blips. Throws on final failure so the
    // rotation loop can move to the next free model.
    const runOneModel = async function* (sel: { providerID: string; modelID: string }): AsyncGenerator<StreamChunk> {
      // A momentary blip against the local runtime (cold start, restart, busy
      // stream) must not kill the whole agent turn. Re-create a fresh session
      // and re-send the message on transient transport failures only.
      const MAX_ATTEMPTS = 5;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let sessionID = '';
        try {
          // A wedged runtime can accept the connection and then never answer.
          // Bound the wait so the attempt fails with a timeout (retryable and
          // rotation-worthy) instead of hanging until the outer agent watchdog
          // aborts the whole turn. Retries stay at the runOneModel level so
          // each one announces itself with a cold_start status chunk.
          const sessionResponse = await openCodeRequest(`${url}/session${directory}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ title: 'Infinite OS provider run' }), signal: timeoutSignal(req.signal, 30_000),
          }, 'session create', 0);
          if (!sessionResponse.ok) throw new Error(`Could not create OpenCode session (HTTP ${sessionResponse.status}).`);
          const session = await sessionResponse.json() as { id?: string };
          sessionID = session.id ?? '';
          if (!sessionID) throw new Error('OpenCode did not return a session ID.');

          try {
            for await (const chunk of streamWithFirstByteTimeout({
              baseUrl: url,
              directory: directoryPath,
              sessionID,
              selected: sel,
              request: req,
            }, FIRST_BYTE_TIMEOUT_MS)) {
              yield chunk;
            }
          } catch (error) {
            quarantineFailure(sel, (error as Error).message);
            if (attempt < MAX_ATTEMPTS - 1 && isTransientOpenCodeFailure(error) && !req.signal?.aborted) {
              yield { type: 'provider_status', status: 'cold_start', provider: 'opencode', model: req.model,
                reason: 'The OpenCode runtime connection dropped; retrying with a fresh session.' };
              await new Promise((resolve) => setTimeout(resolve, openCodeRetryDelay(attempt)));
              if (await ensureServer(url, req.cwd)) continue;
            }
            throw error;
          }
          clearInvalidCliCredential();
          if (!apiKey && sel.providerID === 'opencode') {
            setLastGoodFreeModel(`${sel.providerID}::${sel.modelID}`);
          }          return;
        } catch (error) {
          if (attempt < MAX_ATTEMPTS - 1 && isTransientOpenCodeFailure(error) && !req.signal?.aborted) {
            yield { type: 'provider_status', status: 'cold_start', provider: 'opencode', model: req.model,
              reason: 'The OpenCode runtime was not ready; retrying.' };
            await new Promise((resolve) => setTimeout(resolve, openCodeRetryDelay(attempt)));
            if (await ensureServer(url, req.cwd)) continue;
          }
          noteCliCredentialOutcome((error as Error).message);
          throw error;
        } finally {
          if (sessionID) {
            openCodeRequest(`${url}/session/${encodeURIComponent(sessionID)}`, {
              method: 'DELETE', headers: authHeaders(), signal: AbortSignal.timeout(5000),
            }, 'session cleanup').catch(() => undefined);
          }
        }
      }
    };

    // How long to wait for the first byte before concluding the model is
    // rate-limited/queued. Working free turns answer well inside this;
    // hung turns previously burned 9+ minutes with zero bytes.
    const FIRST_BYTE_TIMEOUT_MS = openCodeFirstByteTimeoutMs();
    const MAX_ROTATION = Math.min(rotation.length, 3);    let lastRotationError: unknown = null;

    for (let r = 0; r < MAX_ROTATION; r++) {
      const current = rotation[r]!;
      if (r > 0) {
        selected = { ...current };
        modelId = `${selected.providerID}::${selected.modelID}`;
        yield { type: 'provider_status', status: 'failover', provider: 'opencode', model: modelId, from: req.model, to: modelId, reason: `Free tier busy on the previous model — trying ${modelId} instead.` };
      }
      try {
        yield* runOneModel(current);
        return;
      } catch (error) {
        lastRotationError = error;
        // A caller abort (user stop, agent watchdog) is a cancellation, not a
        // provider failure: report it plainly so it never burns the failover
        // plan under a bare "The operation was aborted".
        if (req.signal?.aborted) {
          yield { type: 'error', error: 'Request cancelled.' };
          return;
        }
        const msg = (error as Error).message;
        // Account-wide free-tier exhaustion (every free model refuses until
        // the reset) — rotating cannot help. Distinct from per-model rate
        // limits and first-byte timeouts, which stay rotation-worthy.
        if (/free usage exceeded|subscribe to go|opencode\.ai\/go|insufficient account funds/i.test(msg)) {
          noteCliCredentialOutcome(msg);
          yield { type: 'error', error: withOpenCodeHints(msg) };
          return;
        }
        const worthRotating = /timed out waiting for first response|timed out|timeout|429|rate.?limit|quota|capacity|overloaded|FreeUsageLimit|404|not.?found|not valid|no longer offered|retired|returned no output/i.test(msg);        if (r < MAX_ROTATION - 1 && worthRotating) continue;
        yield { type: 'error', error: withOpenCodeHints(msg) };
        noteCliCredentialOutcome(msg);
        return;
      }
    }
    if (req.signal?.aborted) {
      yield { type: 'error', error: 'Request cancelled.' };
      return;
    }
    yield { type: 'error', error: withOpenCodeHints((lastRotationError as Error)?.message ?? 'OpenCode free tier is busy.') };
    if (lastRotationError) noteCliCredentialOutcome((lastRotationError as Error).message);
    return;
  },
};
