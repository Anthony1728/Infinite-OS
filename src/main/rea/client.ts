/**
 * REA — Reverse Engineer Anything (https://github.com/morluto/rea).
 *
 * REA is an MCP server with 207 tools and roughly 760k characters of tool
 * schemas. Handing that catalogue to a model would cost more context than the
 * conversation itself, so it is never attached wholesale. One small `Rea` tool
 * opens a persistent connection on first use, then lets the agent discover and
 * call REA tools by name.
 *
 * Three properties matter for reliability:
 *
 * - Lazy. Nothing starts during app boot. A cold REA start is ~13 s on this
 *   machine, which is fine once and unacceptable on every launch.
 * - Persistent. REA is stateful: `open_binary` selects a target that later
 *   calls inspect. Reconnecting between steps would lose the session.
 * - Honest. A missing Node, a missing package or a killed server produces a
 *   specific, actionable message instead of a generic tool failure.
 *
 * The package is installed once into the user's profile with npm and pinned to
 * a tested version, so a new upstream release cannot change behaviour halfway
 * through an investigation.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

/** Tested against this release. Override only to try a newer one deliberately. */
const DEFAULT_REA_VERSION = '6.7.0';
const requestedReaVersion = process.env.INFINITE_REA_VERSION?.trim() ?? '';
// The value reaches a shell command line, so only a plain semver is allowed.
export const REA_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
  requestedReaVersion,
)
  ? requestedReaVersion
  : DEFAULT_REA_VERSION;
export const REA_REPO = 'https://github.com/morluto/rea';

const CONNECT_TIMEOUT_MS = 90_000;
const DEFAULT_CALL_TIMEOUT_MS = 120_000;
const MAX_CALL_TIMEOUT_MS = 600_000;
const MAX_OUTPUT_CHARS = 60_000;
const MAX_SCHEMA_CHARS = 12_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

export interface ReaToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ReaCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ReaCallResult {
  text: string;
  isError: boolean;
  truncated: boolean;
}

/** The surface the tool uses. A fake implements this in tests. */
export interface ReaBackend {
  statusReport(): string;
  install(onProgress?: (line: string) => void): Promise<string>;
  listTools(): Promise<ReaToolInfo[]>;
  call(name: string, args: Record<string, unknown>, opts?: ReaCallOptions): Promise<ReaCallResult>;
  close(): Promise<void>;
}

/** Where REA lives. Profiles get their own copy; tests can point elsewhere. */
export function reaRoot(): string {
  return process.env.INFINITE_REA_DIR?.trim() || join(infiniteHome(), 'rea');
}

export function reaScriptPath(root = reaRoot()): string {
  return join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');
}

export function readInstalledReaVersion(root = reaRoot()): string | null {
  try {
    const raw = readFileSync(join(root, 'node_modules', 'rea-agents', 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * REA's engines field: ^22.19.0 || ^24.11.0 || >=26.0.0.
 *
 * npm only warns about this, and the package runs on slightly older releases
 * too, so a mismatch is reported rather than turned into a hard refusal.
 */
export function isNodeSupported(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 22) return minor >= 19;
  if (major === 24) return minor >= 11;
  return major >= 26;
}

interface NodeInfo {
  command: string;
  version: string;
  supported: boolean;
}

let nodeCache: NodeInfo | null = null;

function nodeInfo(): NodeInfo | null {
  if (nodeCache) return nodeCache;
  const explicit = process.env.INFINITE_REA_NODE?.trim();
  const candidates = [explicit, process.platform === 'win32' ? 'node.exe' : 'node', 'node'].filter(
    (c, i, all): c is string => Boolean(c) && all.indexOf(c) === i,
  );
  for (const command of candidates) {
    const probe = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    const version = (probe.stdout ?? '').trim();
    if (!probe.error && probe.status === 0 && version) {
      nodeCache = { command, version, supported: isNodeSupported(version) };
      return nodeCache;
    }
  }
  return null;
}

function comspec(): string {
  return process.env.ComSpec || 'cmd.exe';
}

function npmVersion(): string | null {
  const probe =
    process.platform === 'win32'
      ? spawnSync(comspec(), ['/d', '/s', '/c', 'npm --version'], {
          encoding: 'utf8',
          timeout: 15_000,
          windowsHide: true,
        })
      : spawnSync('npm', ['--version'], { encoding: 'utf8', timeout: 15_000 });
  if (probe.error || probe.status !== 0) return null;
  return (probe.stdout ?? '').trim() || null;
}

/** First sentence, clipped. Used for the compact catalogue. */
export function firstSentence(text: string, max = 150): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const stop = cleaned.search(/(?<=[.!?])\s/);
  const sentence = (stop > 0 ? cleaned.slice(0, stop + 1) : cleaned).trimEnd();
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

export function requiredParams(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  return Array.isArray(required) ? required.filter((v): v is string => typeof v === 'string') : [];
}

/** One line the model can scan without paying for the full description. */
export function summariseTool(tool: ReaToolInfo, max = 150): string {
  const required = requiredParams(tool.inputSchema);
  const suffix = required.length ? ` (requires: ${required.join(', ')})` : '';
  return `- ${tool.name} — ${firstSentence(tool.description, max)}${suffix}`;
}

/**
 * Rank tools for a plain-language query. Name matches beat description
 * matches, because a model searching "decompile" wants
 * `procedure_pseudo_code`, not a tool that merely mentions decompiling.
 */
export function selectTools(tools: ReaToolInfo[], query: string, limit = 20): ReaToolInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const ranked = tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const description = tool.description.toLowerCase();
      let score = 0;
      if (name === q) score += 200;
      if (name.includes(q)) score += 80;
      for (const word of words) {
        if (name.includes(word)) score += 25;
        if (description.includes(word)) score += 5;
      }
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return ranked.slice(0, Math.max(1, Math.min(limit, 60))).map((entry) => entry.tool);
}

const CLOSE_MATCHES = ['open_binary', 'binary_overview', 'list_procedures', 'search_procedures', 'procedure_pseudo_code', 'search_strings', 'xrefs'];

/** The entry points worth showing when the model has not searched yet. */
export const REA_START_HERE = [
  'open_binary',
  'binary_overview',
  'list_procedures',
  'search_procedures',
  'procedure_pseudo_code',
  'search_strings',
  'xrefs',
  'inspect_artifact',
  'analyze_javascript_application',
  'inspect_electron_page',
  'inspect_android_package',
  'inspect_managed_artifact',
  'inspect_firmware_regions',
  'inspect_packet_capture',
  'inspect_web_page',
  'export_evidence_bundle',
];

export function truncateText(text: string, cap = MAX_OUTPUT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= cap) return { text, truncated: false };
  const omitted = text.length - cap;
  return {
    text:
      `${text.slice(0, cap)}\n\n… [truncated ${omitted.toLocaleString()} characters. ` +
      'REA returns Evidence JSON: request detail=summary, use limit/offset, or select fewer fields.]',
    truncated: true,
  };
}

function flattenResult(result: unknown): ReaCallResult {
  const payload = result as {
    content?: Array<{ type?: string; text?: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const parts = blocks.map((block) => {
    if (block?.type === 'text') return block.text ?? '';
    if (block?.type === 'image') return '[image omitted]';
    return block?.type ? `[${block.type}]` : '';
  });
  let text = parts.filter(Boolean).join('\n').trim();
  if (!text && payload.structuredContent !== undefined) {
    text = JSON.stringify(payload.structuredContent, null, 2);
  }
  const clipped = truncateText(text || '(no output)');
  return { text: clipped.text, isError: payload.isError === true, truncated: clipped.truncated };
}

function lastLines(text: string, count = 12): string {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(-count).join('\n');
}

/**
 * Last-resort cleanup. `window-all-closed` asks the client to close, but quit
 * does not wait for async work; a synchronous kill on process exit is what
 * guarantees no orphaned analyzer is left holding a target file open.
 */
const liveChildren = new Set<number>();
let exitHookInstalled = false;

function trackChild(pid: number | null): void {
  if (!pid) return;
  liveChildren.add(pid);
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', () => {
    for (const child of liveChildren) {
      try {
        process.kill(child);
      } catch {
        /* already gone */
      }
    }
  });
}

export class ReaClient implements ReaBackend {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: ReaToolInfo[] | null = null;
  private connecting: Promise<void> | null = null;
  private installing: Promise<string> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastError = '';
  private stderrTail = '';

  constructor(private readonly root: string = reaRoot()) {}

  private script(): string {
    return reaScriptPath(this.root);
  }

  private assertInstalled(): void {
    if (existsSync(this.script())) return;
    throw new Error(
      `REA is not installed yet (looked for ${this.script()}). ` +
        'Run action=install once. It needs Node.js and npm on PATH and downloads about 260 MB.',
    );
  }

  private async connect(): Promise<void> {
    this.assertInstalled();
    const node = nodeInfo();
    if (!node) {
      throw new Error(
        'REA needs Node.js on PATH and none was found. Install Node 22.19+ (or 24.11+), reopen Infinite OS, then run action=install.',
      );
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[key] = value;
    }
    env.REA_PACKAGE_VERSION = REA_VERSION;

    const transport = new StdioClientTransport({
      command: node.command,
      args: [this.script(), 'mcp'],
      env,
      stderr: 'pipe',
      // Run inside the writable profile, not the app install directory. REA
      // only needs absolute target paths, but a read-only Program Files cwd
      // must never make an analysis fail on its first temp write.
      cwd: this.root,
    });
    this.stderrTail = '';
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString()}`.slice(-8_000);
    });

    const client = new Client({ name: 'infinite-os', version: '0.1.0' }, { capabilities: {} });
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`REA did not start within ${Math.round(CONNECT_TIMEOUT_MS / 1000)} s.`)),
            CONNECT_TIMEOUT_MS,
          );
          timer.unref?.();
        }),
      ]);
    } catch (error) {
      await transport.close().catch(() => {});
      const detail = lastLines(this.stderrTail);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not start REA: ${message}${detail ? `\n${detail}` : ''}`);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const childPid = transport.pid;
    trackChild(childPid);

    transport.onclose = () => {
      // Only clear state that still belongs to this connection. A deliberate
      // reset nulls the fields first, so this is a no-op for our own closes.
      if (childPid) liveChildren.delete(childPid);
      if (this.transport !== transport) return;
      this.client = null;
      this.transport = null;
    };

    // Fetch the catalogue once per process. It is static for a pinned version
    // and is what makes discovery possible without shipping 760k of schema.
    try {
      const listed = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS });
      this.tools = listed.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
      }));
    } catch (error) {
      // The server answered the handshake but not the catalogue request. Close
      // it now; otherwise every retry leaves another analyzer process behind.
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      if (childPid) liveChildren.delete(childPid);
      const detail = lastLines(this.stderrTail);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`REA started but did not return its catalogue: ${message}${detail ? `\n${detail}` : ''}`);
    }
    this.client = client;
    this.transport = transport;
    this.lastError = '';
  }

  async ensure(onProgress?: (line: string) => void): Promise<void> {
    if (this.client) return;
    if (this.connecting) return this.connecting;
    onProgress?.('Starting REA (first start can take ~15 s)…');
    this.connecting = this.connect().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  async listTools(): Promise<ReaToolInfo[]> {
    await this.ensure();
    return (this.tools ?? []).slice();
  }

  private async reset(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    if (client) await client.close().catch(() => {});
    if (transport) await transport.close().catch(() => {});
  }

  async call(name: string, args: Record<string, unknown>, opts: ReaCallOptions = {}): Promise<ReaCallResult> {
    const run = this.queue.then(async () => {
      await this.ensure();
      const client = this.client;
      if (!client) throw new Error('REA stopped before the call was sent.');
      const timeout = Math.max(
        5_000,
        Math.min(opts.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, MAX_CALL_TIMEOUT_MS),
      );
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, {
          timeout,
          signal: opts.signal,
        });
        return flattenResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        // Invalid arguments are answered by the protocol and do not mean the
        // server is unhealthy; keep the selected binary and its analysis state.
        const code = (error as { code?: number }).code;
        if (code !== -32602 && code !== -32601) {
          await this.reset();
          throw new Error(
            `REA call "${name}" failed: ${message}. ` +
              `The REA session was restarted, so call open_binary again before inspecting. ` +
              `If this was a timeout, narrow the request (detail=summary) or raise timeout_ms.`,
          );
        }
        throw new Error(`REA rejected "${name}": ${message}`);
      }
    });
    // A failed call must not poison the queue for the next one.
    this.queue = run.catch(() => {});
    return run;
  }

  async install(onProgress?: (line: string) => void): Promise<string> {
    if (existsSync(this.script())) {
      const version = readInstalledReaVersion(this.root) ?? REA_VERSION;
      return `REA ${version} is already installed at ${this.root}.`;
    }
    if (this.installing) return this.installing;

    this.installing = this.runInstall(onProgress).finally(() => {
      this.installing = null;
    });
    return this.installing;
  }

  private async runInstall(onProgress?: (line: string) => void): Promise<string> {
    const node = nodeInfo();
    if (!node) {
      throw new Error(
        'REA needs Node.js and npm, and no Node.js was found on PATH. Install Node 22.19+ (or 24.11+) first, then run action=install again.',
      );
    }
    const npm = npmVersion();
    if (!npm) {
      throw new Error(
        `Node.js ${node.version} was found, but npm is not on PATH. Install npm, then run action=install again.`,
      );
    }

    mkdirSync(this.root, { recursive: true });
    const args = [
      'install',
      '--prefix',
      this.root,
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      '--no-save',
      `rea-agents@${REA_VERSION}`,
    ];
    const started = Date.now();
    let tail = '';
    let lastReport = 0;

    const child =
      process.platform === 'win32'
        ? spawn(comspec(), ['/d', '/s', '/c', `npm ${args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`], {
            windowsHide: true,
            env: process.env,
          })
        : spawn('npm', args, { windowsHide: true, env: process.env });

    const collect = (chunk: Buffer | string) => {
      tail = `${tail}${chunk.toString()}`.slice(-16_000);
      const now = Date.now();
      if (onProgress && now - lastReport > 1_000) {
        lastReport = now;
        const line = chunk.toString().split(/\r?\n/).filter(Boolean).pop();
        if (line) onProgress(line.trim().slice(0, 200));
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);

    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('The REA install took longer than 15 minutes and was stopped.'));
      }, INSTALL_TIMEOUT_MS);
      timer.unref?.();
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    }).catch((error: unknown) => {
      throw new Error(`REA install failed: ${error instanceof Error ? error.message : String(error)}`);
    });

    if (code !== 0) {
      throw new Error(
        `REA install failed (npm exit ${code ?? 'unknown'}).\n` +
          `${lastLines(tail) || 'No output.'}\n` +
          'Check the network connection and that npm can write to the profile folder, then retry.',
      );
    }
    if (!existsSync(this.script())) {
      throw new Error(
        `npm finished but ${this.script()} is missing. The package may have installed somewhere else; ` +
          'delete the folder and retry action=install.',
      );
    }

    const seconds = Math.round((Date.now() - started) / 1000);
    const version = readInstalledReaVersion(this.root) ?? REA_VERSION;
    return `Installed REA ${version} in ${seconds}s at ${this.root}. Run action=tools to start it and see the catalogue.`;
  }

  statusReport(): string {
    const node = nodeInfo();
    const installed = existsSync(this.script());
    const version = installed ? readInstalledReaVersion(this.root) : null;
    const tools = this.tools?.length ?? 0;
    const lines = [
      `REA ${version ?? REA_VERSION} — ${installed ? 'installed' : 'not installed'}${this.client ? `, connected (${tools} tools)` : ''}`,
      `Node: ${node ? `${node.version}${node.supported ? '' : ' (works, but upstream asks for 22.19+, 24.11+ or 26+)'}` : 'not found on PATH'}`,
      `npm: ${npmVersion() ? 'available' : 'not found'}`,
      `Install folder: ${this.root}`,
      `Source: ${REA_REPO}`,
    ];
    if (!installed) lines.push('Next: action=install (one time, about 260 MB).');
    if (this.lastError) lines.push(`Last error: ${this.lastError}`);
    return lines.join('\n');
  }

  async close(): Promise<void> {
    this.tools = null;
    await this.reset();
  }
}

/** One process-wide client, so an investigation keeps its selected binary. */
export const reaClient = new ReaClient();

/** Suggested names for a mistyped tool. */
export function suggestReaTools(tools: ReaToolInfo[], name: string): string[] {
  const lower = name.toLowerCase();
  const available = new Set(tools.map((tool) => tool.name));
  const contains = tools
    .filter((tool) => tool.name.toLowerCase().includes(lower) || lower.includes(tool.name.toLowerCase()))
    .map((tool) => tool.name);
  // Never suggest a name this pinned catalogue does not actually have.
  return [...new Set([...contains, ...CLOSE_MATCHES.filter((candidate) => available.has(candidate))])].slice(0, 6);
}

export const REA_OUTPUT_LIMIT = MAX_OUTPUT_CHARS;
export const REA_SCHEMA_LIMIT = MAX_SCHEMA_CHARS;
