// MCP client manager — spawns stdio MCP servers, exposes their tools and resources.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { toolRegistry } from '../tools/base.js';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
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
      await connect(name, cfg);
    } catch (e) {
      console.error(`[mcp] failed to connect ${name}:`, (e as Error).message);
    }
  }
}

export async function connect(name: string, cfg: McpServerConfig): Promise<void> {
  if (servers.has(name)) return;
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args ?? [],
    env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
  });
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
