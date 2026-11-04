// Infinite OS browser extension setup.
//
// The extension is what lets the agent drive a real, logged-in browser. Chrome
// removed `--load-extension` from branded builds and disables remote debugging
// on the default profile, so the only reliable zero-click path is:
//
//   1. keep an unpacked copy of the extension in %LOCALAPPDATA%\InfiniteOS,
//   2. launch Chrome/Edge with a dedicated Infinite OS profile and
//      `--remote-debugging-port=0` (Chrome writes `DevToolsActivePort`),
//   3. install the unpacked extension through CDP `Extensions.loadUnpacked`.
//
// That install does not survive a browser restart, so it is repeated on every
// launch. A profile that is already running without CDP cannot be retrofitted;
// the caller is told to restart it instead of silently failing.
//
// This module deliberately uses only Node built-ins. Electron-specific work
// (clipboard, shell) lives in the IPC layer so the helpers stay testable.

import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { bridgeServer, BRIDGE_DEFAULT_PORT } from './server.js';

const PROFILE_DIR_NAME = 'browser-profile';
const INSTALL_DIR_NAME = 'bridge-extension';
const CDP_READY_TIMEOUT_MS = 25_000;
const BRIDGE_READY_TIMEOUT_MS = 12_000;
const CDP_CACHE_MS = 1_500;

export type BrowserKind = 'chrome' | 'edge';

export interface BrowserExecutable {
  kind: BrowserKind;
  path: string;
}

export interface ExtensionSetupStatus {
  installed: boolean;
  extensionPath: string;
  sourcePath: string;
  extensionVersion: string;
  configPort: number;
  browser: BrowserExecutable | null;
  profilePath: string;
  cdpRunning: boolean;
  cdpPort: number | null;
  extensionLoaded: boolean;
  extensionId: string;
  bridgeConnected: boolean;
  bridgeConnections: number;
  needsRestart: boolean;
  lastError: string;
}

export interface EnsureBrowserResult {
  ok: boolean;
  launched: boolean;
  installedExtension: boolean;
  needsRestart: boolean;
  status: ExtensionSetupStatus;
  error: string;
}

interface CdpInfo {
  port: number;
  browser: string;
  webSocketDebuggerUrl: string;
}

interface CdpResponse {
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  path: string;
}

const IS_TEST = Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';

let cdpCache: { at: number; info: CdpInfo | null } = { at: 0, info: null };
let lastError = '';

function localAppData(): string {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
}

export function bridgeExtensionInstallDir(): string {
  return join(localAppData(), 'InfiniteOS', INSTALL_DIR_NAME);
}

export function infiniteOsBrowserProfileDir(): string {
  return join(localAppData(), 'InfiniteOS', PROFILE_DIR_NAME);
}

/**
 * Where the extension lives right now.
 *
 * Packaged: electron-builder copies `extensions/infinite-os-bridge` to
 * `<resources>/infinite-os-bridge` (see package.json `extraResources`).
 * Development: the repo checkout.
 */
export function bridgeExtensionSourceDir(): string {
  const resources = (process as { resourcesPath?: string }).resourcesPath;
  const candidates = [
    resources ? join(resources, 'infinite-os-bridge') : '',
    resources ? join(resources, 'app.asar.unpacked', 'infinite-os-bridge') : '',
    resolve(process.cwd(), 'extensions', 'infinite-os-bridge'),
    resolve(process.cwd(), '..', 'extensions', 'infinite-os-bridge'),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (existsSync(join(dir, 'manifest.json'))) return dir;
  }
  return candidates[0] || resolve(process.cwd(), 'extensions', 'infinite-os-bridge');
}

function readManifestVersion(dir: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { version?: string };
    return String(manifest.version || '');
  } catch {
    return '';
  }
}

function readBridgeToken(): string {
  try {
    return readFileSync(join(homedir(), '.infinite-ai', 'bridge-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

function filesMatch(source: string, destination: string): boolean {
  try {
    const walk = (root: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (entry.isFile()) out.push(full.slice(root.length + 1));
      }
      return out;
    };
    const sourceFiles = walk(source).filter((f) => f !== 'config.js').sort();
    const destFiles = walk(destination).filter((f) => f !== 'config.js').sort();
    if (sourceFiles.length !== destFiles.length) return false;
    for (let i = 0; i < sourceFiles.length; i++) {
      if (sourceFiles[i] !== destFiles[i]) return false;
      const a = readFileSync(join(source, sourceFiles[i]));
      const b = readFileSync(join(destination, destFiles[i]));
      if (!a.equals(b)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function copyExtension(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyExtension(from, to);
    } else if (entry.name !== 'config.js') {
      try {
        cpSync(from, to, { force: true });
      } catch (err) {
        // Chrome may briefly hold a file open while it loads the extension.
        // One retry covers the common case; identical content is already fine.
        try {
          cpSync(from, to, { force: true });
        } catch {
          const a = readFileSync(from);
          const b = existsSync(to) ? readFileSync(to) : null;
          if (!b || !a.equals(b)) throw err;
        }
      }
    }
  }
}

/**
 * Copy the extension to its stable install location and write the live bridge
 * port/token into config.js. The stable path matters: Chrome derives an
 * unpacked extension's id from its absolute path, so moving it would look like
 * a different extension to every profile that already loaded it.
 */
export function installBridgeExtension(opts?: { port?: number; token?: string }): {
  ok: boolean;
  path: string;
  version: string;
  copied: boolean;
  error?: string;
} {
  const source = bridgeExtensionSourceDir();
  const destination = bridgeExtensionInstallDir();
  const version = readManifestVersion(source);
  if (IS_TEST) {
    return { ok: existsSync(join(source, 'manifest.json')), path: destination, version, copied: false };
  }
  try {
    const samePath = resolve(source).toLowerCase() === resolve(destination).toLowerCase();
    let copied = false;
    if (!samePath && (!existsSync(destination) || !filesMatch(source, destination))) {
      // A partial/broken copy is replaced wholesale. config.js is written below.
      if (existsSync(destination)) rmSync(destination, { recursive: true, force: true });
      copyExtension(source, destination);
      copied = true;
    }
    const port = opts?.port || bridgeServer.getStatus().port || BRIDGE_DEFAULT_PORT;
    const token = opts?.token ?? readBridgeToken();
    if (!existsSync(destination)) throw new Error(`Extension source not found at ${source}`);
    writeFileSync(
      join(destination, 'config.js'),
      `const BRIDGE_CONFIG = { port: ${port}, token: ${JSON.stringify(token)} };\n`,
      'utf8',
    );
    writeFileSync(
      join(destination, 'install.json'),
      JSON.stringify(
        {
          installedAt: new Date().toISOString(),
          source,
          version,
          port,
        },
        null,
        2,
      ),
      'utf8',
    );
    return { ok: true, path: destination, version, copied };
  } catch (err) {
    const message = String((err as Error).message || err);
    lastError = message;
    return { ok: false, path: destination, version, copied: false, error: message };
  }
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findInPaths(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsFile(candidate)) return candidate;
  }
  return null;
}

/** Resolve an installed Chrome first, then Edge. Branded Chrome is preferred. */
export function findBrowser(): BrowserExecutable | null {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = localAppData();
  const chrome = findInPaths([
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]);
  if (chrome) return { kind: 'chrome', path: chrome };
  const edge = findInPaths([
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
  if (edge) return { kind: 'edge', path: edge };
  return null;
}

function parseDevToolsActivePort(raw: string): { port: number; path: string } | null {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const port = Number(lines[0]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { port, path: lines[1] || '' };
}

async function httpJson(url: string, timeoutMs = 2_000): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read the dedicated profile's CDP endpoint and prove it is alive.
 * `--remote-debugging-port=0` makes Chrome write the chosen port to
 * `<profile>/DevToolsActivePort`, so the app can reconnect after a restart
 * without guessing a fixed port.
 */
export async function probeInfiniteOsBrowser(opts?: { force?: boolean }): Promise<CdpInfo | null> {
  const now = Date.now();
  if (!opts?.force && now - cdpCache.at < CDP_CACHE_MS) return cdpCache.info;
  const path = join(infiniteOsBrowserProfileDir(), 'DevToolsActivePort');
  let parsed: { port: number; path: string } | null = null;
  try {
    parsed = parseDevToolsActivePort(readFileSync(path, 'utf8'));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    cdpCache = { at: now, info: null };
    return null;
  }
  const version = (await httpJson(`http://127.0.0.1:${parsed.port}/json/version`)) as
    | { Browser?: string; webSocketDebuggerUrl?: string }
    | null;
  if (!version?.webSocketDebuggerUrl) {
    cdpCache = { at: now, info: null };
    return null;
  }
  const info: CdpInfo = {
    port: parsed.port,
    browser: String(version.Browser || ''),
    webSocketDebuggerUrl: String(version.webSocketDebuggerUrl),
  };
  cdpCache = { at: now, info };
  return info;
}

function cdpCall(webSocketDebuggerUrl: string, method: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<CdpResponse> {
  return new Promise((resolvePromise) => {
    let settled = false;
    const finish = (value: CdpResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      resolvePromise(value);
    };
    const timer = setTimeout(() => finish({ error: { message: `CDP ${method} timed out` } }), timeoutMs);
    let socket: WebSocket;
    try {
      socket = new WebSocket(webSocketDebuggerUrl);
    } catch (err) {
      finish({ error: { message: String((err as Error).message || err) } });
      return;
    }
    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ id: 1, method, params: params || {} }));
      } catch (err) {
        finish({ error: { message: String((err as Error).message || err) } });
      }
    };
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { id?: number } & CdpResponse;
        if (message.id === 1) finish(message);
      } catch {
        /* ignore non-JSON frames */
      }
    };
    socket.onerror = () => finish({ error: { message: 'CDP socket error' } });
    socket.onclose = () => finish({ error: { message: 'CDP socket closed' } });
  });
}

async function listExtensions(info: CdpInfo): Promise<ExtensionInfo[]> {
  const response = await cdpCall(info.webSocketDebuggerUrl, 'Extensions.getExtensions', {});
  const result = response.result as { extensions?: ExtensionInfo[] } | undefined;
  return Array.isArray(result?.extensions) ? result.extensions : [];
}

interface BrowserTarget {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

async function listTargets(info: CdpInfo): Promise<BrowserTarget[]> {
  const targets = (await httpJson(`http://127.0.0.1:${info.port}/json/list`)) as BrowserTarget[] | null;
  return Array.isArray(targets) ? targets : [];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wake the extension's MV3 service worker and make it reconnect now.
 *
 * A manifest-v3 worker is torn down after ~30s of inactivity, and its pending
 * `setTimeout` reconnect timers die with it. If the bridge server restarts
 * while the browser stays open, the extension can therefore sit disconnected
 * until its 30s alarm fires. Because we own the browser over CDP we can start
 * the worker (`ServiceWorker.startWorker`) and call its `connect()`, which makes
 * reconnection immediate instead of "eventually, if you are lucky".
 */
async function wakeBridgeWorker(info: CdpInfo, extensionId: string): Promise<boolean> {
  if (!extensionId) return false;
  const workerUrl = `chrome-extension://${extensionId}`;
  const findWorker = (targets: BrowserTarget[]): BrowserTarget | undefined =>
    targets.find(
      (target) =>
        target.type === 'service_worker' &&
        typeof target.url === 'string' &&
        target.url.startsWith(workerUrl) &&
        Boolean(target.webSocketDebuggerUrl),
    );

  let worker = findWorker(await listTargets(info));
  const wasAsleep = !worker;
  if (!worker) {
    // The worker is asleep (or never started). Ask Chrome to start it from the
    // extension scope; the freshly started worker runs its top-level code,
    // which calls connect() on its own.
    await cdpCall(info.webSocketDebuggerUrl, 'ServiceWorker.enable', {}, 4_000);
    const installDir = bridgeExtensionInstallDir();
    await cdpCall(info.webSocketDebuggerUrl, 'Extensions.loadUnpacked', { path: installDir }, 4_000);
    for (let attempt = 0; attempt < 12 && !worker; attempt += 1) {
      await sleep(250);
      worker = findWorker(await listTargets(info));
    }
  }
  if (!worker) return false;

  // A freshly started worker connects on its own; nudging it would race its
  // top-level connect(). Only force a reconnect for a worker that was already
  // running but whose socket is stale (bridge still down).
  if (wasAsleep) return true;
  if (bridgeServer.getStatus().connected) return true;
  try {
    await cdpCall(
      worker.webSocketDebuggerUrl as string,
      'Runtime.evaluate',
      { expression: "typeof forceReconnect === 'function' ? (forceReconnect('manual wake'), 'forceReconnect') : 'no-fn'", returnByValue: true },
      4_000,
    );
  } catch {
    // Worker may have restarted; ignore.
  }
  return true;
}

async function loadExtensionIntoBrowser(info: CdpInfo, extensionPath: string): Promise<{ ok: boolean; id: string; error: string }> {
  const response = await cdpCall(info.webSocketDebuggerUrl, 'Extensions.loadUnpacked', { path: extensionPath });
  if (response.error) {
    return { ok: false, id: '', error: response.error.message || 'Extensions.loadUnpacked failed' };
  }
  const result = response.result as { id?: string } | undefined;
  return { ok: true, id: String(result?.id || ''), error: '' };
}

function profileProcessIds(profile: string): number[] {
  if (process.platform !== 'win32') return [];
  const needle = profile.toLowerCase().replace(/'/g, "''");
  const script =
    `$needle = '${needle}'; ` +
    `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | ` +
    `Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($needle) } | ` +
    `ForEach-Object { $_.ProcessId }`;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    return out
      .split(/\s+/)
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
  } catch {
    return [];
  }
}

function spawnBrowser(executable: BrowserExecutable, args: string[]): number | null {
  try {
    const child = spawn(executable.path, args, {
      cwd: dirname(executable.path),
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return child.pid || null;
  } catch (err) {
    lastError = String((err as Error).message || err);
    return null;
  }
}

async function waitForCdp(timeoutMs: number): Promise<CdpInfo | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await probeInfiniteOsBrowser({ force: true });
    if (info) return info;
    await new Promise((r) => setTimeout(r, 350));
  }
  return null;
}

async function waitForBridgeConnection(
  timeoutMs: number,
  wake?: { info: CdpInfo; extensionId: string },
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastWake = 0;
  while (Date.now() < deadline) {
    if (bridgeServer.getStatus().connected) return true;
    if (wake && (lastWake === 0 || Date.now() - lastWake > 8_000)) {
      lastWake = Date.now();
      await wakeBridgeWorker(wake.info, wake.extensionId);
      // no log
    }
    await sleep(250);
  }
  return bridgeServer.getStatus().connected;
}

function browserArgs(profile: string): string[] {
  return [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session',
    '--window-size=1440,900',
    'about:blank',
  ];
}

/**
 * Launch the dedicated Infinite OS browser, attach CDP, install the extension,
 * and wait for it to say hello to the bridge.
 */
export async function launchInfiniteOsBrowser(): Promise<EnsureBrowserResult> {
  const installed = installBridgeExtension();
  const base = await buildStatus();
  if (!installed.ok) {
    return { ok: false, launched: false, installedExtension: false, needsRestart: false, status: base, error: installed.error || 'Extension install failed' };
  }
  const browser = base.browser;
  if (!browser) {
    return { ok: false, launched: false, installedExtension: false, needsRestart: false, status: base, error: 'Chrome or Edge is not installed.' };
  }

  // Already running with CDP? Reuse it and make sure the extension is loaded.
  const existing = await probeInfiniteOsBrowser({ force: true });
  if (existing) {
    const loaded = await ensureExtensionInBrowser(existing, installed.path);
    const bridgeConnected = loaded.ok ? await waitForBridgeConnection(bridgeServer.getStatus().connected ? 1_000 : BRIDGE_READY_TIMEOUT_MS, { info: existing, extensionId: loaded.id }) : false;
    const status = await buildStatus();
    return {
      ok: loaded.ok && bridgeConnected,
      launched: false,
      installedExtension: loaded.ok && !loaded.alreadyLoaded,
      needsRestart: false,
      status,
      error: loaded.ok ? (bridgeConnected ? '' : 'Browser is running, but the extension has not connected to the bridge yet.') : loaded.error,
    };
  }

  const profile = infiniteOsBrowserProfileDir();
  if (profileProcessIds(profile).length > 0) {
    const status = await buildStatus();
    return {
      ok: false,
      launched: false,
      installedExtension: false,
      needsRestart: true,
      status: { ...status, needsRestart: true },
      error:
        'The Infinite OS browser is already open without automation. Restart it from the Browser Control panel, or close that browser window and try again.',
    };
  }

  mkdirSync(profile, { recursive: true });
  // A stale port file from a crash must not send the loader to a dead port.
  try {
    rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  } catch {
    /* ignore */
  }
  const pid = spawnBrowser(browser, browserArgs(profile));
  if (!pid) {
    const status = await buildStatus();
    return { ok: false, launched: false, installedExtension: false, needsRestart: false, status, error: lastError || 'Could not start the browser.' };
  }
  const info = await waitForCdp(CDP_READY_TIMEOUT_MS);
  if (!info) {
    const status = await buildStatus();
    return {
      ok: false,
      launched: true,
      installedExtension: false,
      needsRestart: false,
      status,
      error: `The browser started, but its debugging endpoint did not answer within ${Math.round(CDP_READY_TIMEOUT_MS / 1000)}s.`,
    };
  }

  const loaded = await ensureExtensionInBrowser(info, installed.path);
  const bridgeConnected = loaded.ok ? await waitForBridgeConnection(BRIDGE_READY_TIMEOUT_MS, { info, extensionId: loaded.id }) : false;
  const status = await buildStatus();
  return {
    ok: loaded.ok && bridgeConnected,
    launched: true,
    installedExtension: loaded.ok && !loaded.alreadyLoaded,
    needsRestart: false,
    status,
    error: loaded.ok
      ? bridgeConnected
        ? ''
        : 'The extension was installed, but it has not connected to the bridge yet. It retries automatically; press Test connection in a moment.'
      : loaded.error,
  };
}

async function ensureExtensionInBrowser(
  info: CdpInfo,
  extensionPath: string,
): Promise<{ ok: boolean; alreadyLoaded: boolean; id: string; error: string }> {
  try {
    const before = await listExtensions(info);
    const match = before.find(
      (ext) => ext.name === 'Infinite AI Bridge' || resolve(ext.path || '').toLowerCase() === resolve(extensionPath).toLowerCase(),
    );
    if (match) return { ok: true, alreadyLoaded: true, id: match.id, error: '' };
    const loaded = await loadExtensionIntoBrowser(info, extensionPath);
    if (!loaded.ok) return { ok: false, alreadyLoaded: false, id: '', error: loaded.error };
    return { ok: true, alreadyLoaded: false, id: loaded.id, error: '' };
  } catch (err) {
    return { ok: false, alreadyLoaded: false, id: '', error: String((err as Error).message || err) };
  }
}

/**
 * Make the browser usable right now: attach to the dedicated profile if it is
 * already running, otherwise launch it. This is what the browser tool calls
 * before giving up, so the user never has to open Chrome or reload anything.
 */
export async function ensureBrowserReady(opts?: { launch?: boolean }): Promise<EnsureBrowserResult> {
  const launch = opts?.launch !== false;
  const installed = installBridgeExtension();
  if (!installed.ok) {
    const status = await buildStatus();
    return { ok: false, launched: false, installedExtension: false, needsRestart: false, status, error: installed.error || 'Extension install failed' };
  }
  const info = await probeInfiniteOsBrowser({ force: true });
  if (info) {
    const loaded = await ensureExtensionInBrowser(info, installed.path);
    const connected = loaded.ok ? await waitForBridgeConnection(bridgeServer.getStatus().connected ? 1_000 : BRIDGE_READY_TIMEOUT_MS, { info, extensionId: loaded.id }) : false;
    const status = await buildStatus();
    return {
      ok: loaded.ok && (connected || bridgeServer.getStatus().connected),
      launched: false,
      installedExtension: loaded.ok && !loaded.alreadyLoaded,
      needsRestart: false,
      status,
      error: loaded.ok ? (connected ? '' : 'The browser is running but the bridge is not connected yet.') : loaded.error,
    };
  }
  if (!launch) {
    const status = await buildStatus();
    return {
      ok: false,
      launched: false,
      installedExtension: false,
      needsRestart: false,
      status,
      error: 'The Infinite OS browser is not running.',
    };
  }
  return launchInfiniteOsBrowser();
}

export async function buildStatus(): Promise<ExtensionSetupStatus> {
  const extensionPath = bridgeExtensionInstallDir();
  const sourcePath = bridgeExtensionSourceDir();
  const browser = findBrowser();
  const profilePath = infiniteOsBrowserProfileDir();
  const cdpInfo = await probeInfiniteOsBrowser();
  let extensionLoaded = false;
  let extensionId = '';
  if (cdpInfo) {
    try {
      const extensions = await listExtensions(cdpInfo);
      const match = extensions.find(
        (ext) => ext.name === 'Infinite AI Bridge' || resolve(ext.path || '').toLowerCase() === resolve(extensionPath).toLowerCase(),
      );
      if (match) {
        extensionLoaded = true;
        extensionId = match.id;
      }
    } catch {
      /* CDP raced with a browser shutdown; status simply reports not loaded */
    }
  }
  const bridge = bridgeServer.getStatus();
  let configPort = BRIDGE_DEFAULT_PORT;
  try {
    const config = readFileSync(join(extensionPath, 'config.js'), 'utf8');
    const match = config.match(/port\s*:\s*(\d+)/);
    if (match) configPort = Number(match[1]) || BRIDGE_DEFAULT_PORT;
  } catch {
    /* not installed yet */
  }
  return {
    installed: existsSync(join(extensionPath, 'manifest.json')),
    extensionPath,
    sourcePath,
    extensionVersion: readManifestVersion(extensionPath) || readManifestVersion(sourcePath),
    configPort,
    browser,
    profilePath,
    cdpRunning: Boolean(cdpInfo),
    cdpPort: cdpInfo?.port ?? null,
    extensionLoaded,
    extensionId,
    bridgeConnected: bridge.connected,
    bridgeConnections: Array.isArray(bridge.connections) ? bridge.connections.length : 0,
    needsRestart: !cdpInfo && profileProcessIds(profilePath).length > 0,
    lastError,
  };
}

/** Open chrome://extensions in the dedicated browser (or the normal default). */
export function openExtensionInstallPage(): { ok: boolean; error?: string } {
  const browser = findBrowser();
  if (!browser) return { ok: false, error: 'Chrome or Edge is not installed.' };
  const profile = infiniteOsBrowserProfileDir();
  const args = existsSync(profile)
    ? [`--user-data-dir=${profile}`, '--no-first-run', 'chrome://extensions']
    : ['chrome://extensions'];
  try {
    spawn(browser.path, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message || err) };
  }
}

/** Reveal the installed extension folder in Explorer. */
export function openExtensionFolder(): { ok: boolean; error?: string } {
  const dir = bridgeExtensionInstallDir();
  installBridgeExtension();
  try {
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err as Error).message || err) };
  }
}

/** Restart only the dedicated profile's browser processes. */
export async function restartInfiniteOsBrowser(): Promise<EnsureBrowserResult> {
  const profile = infiniteOsBrowserProfileDir();
  const pids = profileProcessIds(profile);
  for (const pid of pids) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
    } catch {
      /* already gone */
    }
  }
  cdpCache = { at: 0, info: null };
  await new Promise((r) => setTimeout(r, 900));
  return launchInfiniteOsBrowser();
}

/** Exposed for tests: the DevToolsActivePort parser is pure. */
export function parseDevToolsActivePortForTest(raw: string): { port: number; path: string } | null {
  return parseDevToolsActivePort(raw);
}

/** Forget the cached CDP probe (used after a restart or an explicit refresh). */
export function invalidateBrowserProbe(): void {
  cdpCache = { at: 0, info: null };
}

/** Read the current token for the renderer's "copy setup info" action. */
export function currentBridgeConfig(): { port: number; token: string } {
  return {
    port: bridgeServer.getStatus().port || BRIDGE_DEFAULT_PORT,
    token: readBridgeToken(),
  };
}
