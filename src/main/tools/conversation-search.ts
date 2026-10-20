/**
 * Conversation search — find past chats by their contents.
 *
 * Claude Code, OpenCode, OpenClaw and Grok Build all shipped the same thing in
 * 2026: the agent can look up its own earlier conversations. OpenClaw calls it
 * recall and returns snippets plus the session and message ids needed to pull
 * the rest of the transcript; Grok Build indexes sessions; OpenCode filters
 * them server-side.
 *
 * Infinite OS had the storage and a search box in the sidebar, but no
 * agent-facing tool, so the AI could not answer "what did we decide about X
 * last week?" without the user pasting the transcript. This tool wraps the
 * shared session search engine (src/main/session/search.ts) and returns ranked
 * snippets with enough context to quote and the ids needed to go further.
 */
import type { Tool, ToolResult } from './base.js';
import type { Snippet } from '../session/search.js';

export { collectSnippets } from '../session/search.js';

interface SearchInput {
  query?: string;
  /** Maximum number of snippets to return across every conversation. */
  limit?: number;
  includeArchived?: boolean;
  /** Restrict matches to one speaker. */
  role?: 'user' | 'assistant' | 'any';
  contextChars?: number;
  /** Maximum number of conversations to return. */
  maxSessions?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function clamp(n: unknown, fallback: number, min: number, max: number): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(max, Math.max(min, v));
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return date.toISOString().slice(0, 10);
}

function formatSnippet(snippet: Snippet): string {
  const label =
    snippet.source === 'message'
      ? snippet.messageId
        ? `${snippet.role} (${snippet.messageId})`
        : snippet.role
      : snippet.source;
  return `${label}: ${snippet.snippet}`;
}

export const conversationSearchTool: Tool = {
  name: 'ConversationSearch',
  description:
    'Search your own earlier Infinite OS conversations by content. Returns matching conversations with snippets plus session and message ids, so you can quote them or pull the full transcript. Use it whenever the user refers to past work ("what did we decide about X", "the thing we built last week") instead of asking them to paste the transcript.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Words to look for. Every word must appear; "quoted phrase" matches exactly.',
      },
      limit: { type: 'number', description: 'Max snippets to return (default 20).' },
      includeArchived: { type: 'boolean', description: 'Also search conversations filed in the archive.' },
      role: {
        type: 'string',
        description: "Only match one speaker: 'user' or 'assistant'.",
      },
      contextChars: { type: 'number', description: 'Characters of context around each match (default 90).' },
      maxSessions: { type: 'number', description: 'Max conversations to return (default 10).' },
    },
    required: ['query'],
  },
  permission: 'none',

  async execute(args, _ctx): Promise<ToolResult> {
    const input = (args ?? {}) as SearchInput;
    const query = (input.query ?? '').trim();
    if (!query) return { content: 'query is required', is_error: true };

    const limit = clamp(input.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const role = input.role === 'user' || input.role === 'assistant' ? input.role : 'any';

    try {
      const { searchConversations } = await import('../session/search.js');
      const hits = await searchConversations({
        query,
        includeArchived: input.includeArchived === true,
        role,
        contextChars: input.contextChars,
        maxSessions: input.maxSessions,
      });

      const matches: Snippet[] = [];
      for (const hit of hits) {
        for (const snippet of hit.snippets) {
          matches.push(snippet);
          if (matches.length >= limit) break;
        }
        if (matches.length >= limit) break;
      }

      if (matches.length === 0) {
        return {
          content: `No conversations matched "${query}". Try fewer or more general words, or set includeArchived to search conversations you filed away.`,
        };
      }

      const conversationCount = new Set(matches.map((m) => m.sessionId)).size;
      const lines = [
        `=== Conversation search: "${query}" — ${conversationCount} conversation${
          conversationCount === 1 ? '' : 's'
        }, ${matches.length} match${matches.length === 1 ? '' : 'es'} ===`,
        '',
      ];

      let index = 0;
      for (const hit of hits) {
        const own = matches.filter((m) => m.sessionId === hit.session.id);
        if (own.length === 0) continue;
        index += 1;
        const archived = hit.archived ? ' · archived' : '';
        lines.push(
          `[${index}] ${hit.session.title} · ${formatDate(hit.session.updated_at)}${archived} · session ${hit.session.id}`,
        );
        for (const snippet of own) {
          lines.push(`    ${formatSnippet(snippet)}`);
        }
        lines.push('');
      }

      lines.push(
        'Use the session id with the session tools to reopen, branch or export a conversation.',
      );
      return { content: lines.join('\n').trim() };
    } catch (e) {
      return { content: `ConversationSearch failed: ${(e as Error).message}`, is_error: true };
    }
  },
};
