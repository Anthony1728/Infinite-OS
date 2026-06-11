// Build the system prompt and assemble message context.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import type { Message } from '../../shared/types.js';

export async function buildSystemPrompt(opts: { sessionId: string; cwd: string; model: string; provider: string }): Promise<string> {
  const parts: string[] = [];

  // Base persona
  parts.push(`You are Infinite AI, an agentic coding assistant working in ${opts.cwd}.`);
  parts.push(`Current model: ${opts.provider}/${opts.model}`);
  parts.push('');
  parts.push('You have access to tools. Use them to read files, run commands, search the web, and edit code. Prefer concrete actions over speculation. When you finish a task, summarize what changed.');

  // INFINITE.md files (user + project)
  const memories = await discoverMemory(opts.cwd);
  for (const m of memories) {
    parts.push('');
    parts.push(`# Project instructions (${m.path})`);
    parts.push(m.content);
  }

  // Auto memory
  const auto = await loadAutoMemory(opts.cwd);
  if (auto) {
    parts.push('');
    parts.push('# Auto memory');
    parts.push(auto);
  }

  // Available tools
  const { toolRegistry } = await import('../tools/base.js');
  const tools = toolRegistry.list();
  if (tools.length) {
    parts.push('');
    parts.push('# Available tools');
    for (const t of tools) {
      parts.push(`- \`${t.name}\` — ${t.description}`);
    }
  }

  return parts.join('\n');
}

interface DiscoveredMemory { path: string; content: string }

async function discoverMemory(cwd: string): Promise<DiscoveredMemory[]> {
  const out: DiscoveredMemory[] = [];
  const userPath = join(homedir(), '.infinite-ai', 'INFINITE.md');
  const projectPath = join(cwd, 'INFINITE.md');
  const projectHidden = join(cwd, '.infinite', 'INFINITE.md');
  const localPath = join(cwd, 'INFINITE.local.md');

  for (const p of [userPath, projectPath, projectHidden, localPath]) {
    if (existsSync(p)) {
      try {
        out.push({ path: p, content: await readFile(p, 'utf8') });
      } catch { /* skip */ }
    }
  }
  return out;
}

async function loadAutoMemory(cwd: string): Promise<string | null> {
  const hash = await hashPath(cwd);
  const dir = join(homedir(), '.infinite-ai', 'memory', hash);
  if (!existsSync(dir)) return null;
  const { readdir, readFile } = await import('node:fs/promises');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const out: string[] = [];
  for (const f of files) {
    out.push(`## ${f}`);
    out.push(await readFile(join(dir, f), 'utf8'));
  }
  return out.length ? out.join('\n\n') : null;
}

async function hashPath(p: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(resolve(p)).digest('hex').slice(0, 16);
}

/** Trim message history to fit within the model's context window (rough). */
export async function buildContext(messages: Message[], _opts: { cwd: string }): Promise<Message[]> {
  const MAX = 100;
  if (messages.length <= MAX) return messages;
  // Keep the system message + last N
  return messages.slice(-MAX);
}
