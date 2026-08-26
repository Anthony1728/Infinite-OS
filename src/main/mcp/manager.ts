// MCP client manager — spawns stdio MCP servers, exposes their tools and resources.
// Supports stdio, SSE, and Streamable HTTP transports.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { toolRegistry } from '../tools/base.js';

type TransportType = 'stdio' | 'sse' | 'streamable-http';

interface McpServerConfig {
  transport?: TransportType;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // SSE / Streamable HTTP
  url?: string;
  headers?: Record<string, string>;
  authToken?: string;
}

interface ConnectedServer {
  name: string;
  client: Client;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

const servers = new Map<string, ConnectedServer>();

export async function loadMcpConfig(cwd: string): Promise<Record<string, McpServerConfig>> {
  const out: Record<string, McpServerConfig> = {};

  // User scope
  const userPath = join(homedir(), '.infinite-ai.json');
  if (existsSync(userPath)) {
    try {
      const data = JSON.parse(await readFile(userPath, 'utf8'));
      Object.assign(out, data.mcpServers ?? {});
    } catch { /* skip */ }
  }

  // Project scope
  const projectPath = join(cwd, '.mcp.json');
  if (existsSync(projectPath)) {
    try {
      const data = JSON.parse(await readFile(projectPath, 'utf8'));
      Object.assign(out, data.mcpServers ?? {});
    } catch { /* skip */ }
  }

  return out;
}

export async function connectAll(cwd: string): Promise<void> {
  const config = await loadMcpConfig(cwd);
  for (const [name, cfg] of Object.entries(config)) {
    try {
      // A slow or broken optional MCP server must never hold the desktop
      // window hostage during startup. The connection may still finish in
      // the background; startup proceeds after the bounded wait.
      await Promise.race([
        connect(name, cfg),
        new Promise<never>((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('connection timed out')), 8_000);
          timer.unref?.();
        }),
      ]);
    } catch (e) {
      console.error(`[mcp] failed to connect ${name}:`, (e as Error).message);
    }
  }
}

function createTransport(cfg: McpServerConfig) {
  const transportType = cfg.transport ?? 'stdio';

  if (transportType === 'stdio') {
    if (!cfg.command) {
      throw new Error('stdio transport requires "command"');
    }
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
    });
  }

  if (transportType === 'sse') {
    if (!cfg.url) {
      throw new Error('SSE transport requires "url"');
    }
    const url = new URL(cfg.url);
    const options: ConstructorParameters<typeof SSEClientTransport>[1] = {};
    const headers = {
      ...(cfg.headers ?? {}),
      ...(cfg.authToken ? { Authorization: `Bearer ${cfg.authToken}` } : {}),
    };
    if (Object.keys(headers).length > 0) {
      // The eventsource package's EventSourceInit has no `headers` field, so
      // custom headers for the initial SSE stream are injected via its
      // documented custom-fetch hook instead.
      const baseFetch = globalThis.fetch.bind(globalThis);
      options.eventSourceInit = {
        fetch: async (input, init) => baseFetch(input, { ...init, headers: { ...init.headers, ...headers } }),
      };
    }
    if (cfg.authToken) {
      options.requestInit = { headers: { Authorization: `Bearer ${cfg.authToken}` } };
    }
    return new SSEClientTransport(url, options);
  }

  if (transportType === 'streamable-http') {
    if (!cfg.url) {
      throw new Error('Streamable HTTP transport requires "url"');
    }
    const url = new URL(cfg.url);
    const options: ConstructorParameters<typeof StreamableHTTPClientTransport>[1] = {};
    if (cfg.headers) {
      options.requestInit = { headers: cfg.headers };
    }
    if (cfg.authToken) {
      options.requestInit = {
        ...options.requestInit,
        headers: { ...options.requestInit?.headers, Authorization: `Bearer ${cfg.authToken}` },
      };
    }
    return new StreamableHTTPClientTransport(url, options);
  }

  throw new Error(`Unknown transport type: ${transportType}`);
}

export async function connect(name: string, cfg: McpServerConfig): Promise<void> {
  if (servers.has(name)) return;
  const transport = createTransport(cfg);
  const client = new Client({ name: 'infinite-ai', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const server: ConnectedServer = { name, client, tools: tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })) };
  servers.set(name, server);

  // Register MCP tools in the global tool registry, namespaced as `mcp_<server>_<tool>`
  for (const t of server.tools) {
    const namespaced = `mcp__${name}__${t.name}`;
    toolRegistry.register({
      name: namespaced,
      description: `[MCP:${name}] ${t.description}`,
      inputSchema: t.inputSchema,
      permission: 'ask',
      async execute(args, _ctx) {
        const result = await server.client.callTool({ name: t.name, arguments: args as Record<string, unknown> });
        const text = (result.content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!)
          .join('\n');
        return { content: text || '(no output)' };
      },
    });
  }
}

export async function disconnect(name: string): Promise<void> {
  const s = servers.get(name);
  if (!s) return;
  await s.client.close();
  for (const t of s.tools) {
    toolRegistry.unregister(`mcp__${name}__${t.name}`);
  }
  servers.delete(name);
}

export function listServers(): { name: string; toolCount: number; connected: boolean }[] {
  return Array.from(servers.entries()).map(([name, s]) => ({ name, toolCount: s.tools.length, connected: true }));
}

export function getStatus(): { active: boolean; servers: { name: string; toolCount: number; connected: boolean }[]; totalTools: number } {
  const list = listServers();
  return {
    active: list.length > 0,
    servers: list,
    totalTools: list.reduce((sum, s) => sum + s.toolCount, 0),
  };
}

export function listTools(name?: string): { server: string; tools: { name: string; description: string }[] }[] {
  if (name) {
    const server = servers.get(name);
    if (!server) return [];
    return [{ server: name, tools: server.tools.map((t) => ({ name: t.name, description: t.description })) }];
  }
  return Array.from(servers.entries()).map(([key, s]) => ({
    server: key,
    tools: s.tools.map((t) => ({ name: t.name, description: t.description })),
  }));
}