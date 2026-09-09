import type { Tool, ToolResult } from './base.js';
import * as memory from '../memory/store.js';
import { getWorkspaceIndexer } from '../indexing/indexer.js';

export const knowledgeTool: Tool = {
  name: 'Knowledge',
  description: 'Manage stratified long-term memory (episodic session events, semantic facts, procedural how-tos) and the semantic workspace index. Remember with a tier + importance; recall ranks by importance/recency/use; promote moves episodic events up to durable tiers; prune_episodic decays stale trivia. Use for remembering facts, saved prompts/templates, procedures, document search, RAG, and repository understanding.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['remember', 'search', 'recall', 'list', 'update', 'forget', 'stats', 'promote', 'prune_episodic', 'index_workspace', 'semantic_search'] },
      id: { type: 'string' },
      type: { type: 'string', enum: ['preference', 'project', 'document', 'chat', 'note'] },
      tier: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'Memory tier: episodic decays, semantic persists, procedural holds reusable how-tos' },
      importance: { type: 'number', description: '0-1: how worth keeping (default 0.5; session trivia ~0.3-0.4, durable facts 0.7+)' },
      tiers: { type: 'array', items: { type: 'string' }, description: 'Restrict recall to these tiers' },
      olderThanDays: { type: 'number', description: 'prune_episodic: delete low-importance episodic rows older than this (default 30)' },
      title: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      query: { type: 'string' },
      path: { type: 'string' },
      limit: { type: 'number' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; id?: string; type?: 'preference' | 'project' | 'document' | 'chat' | 'note'; tier?: 'episodic' | 'semantic' | 'procedural'; importance?: number; tiers?: Array<'episodic' | 'semantic' | 'procedural'>; olderThanDays?: number; title?: string; content?: string; tags?: string[]; query?: string; path?: string; limit?: number };
    try {
      if (input.action === 'remember') {
        if (!input.title || input.content == null) return bad('remember requires title and content.');
        return json(memory.createMemory({ type: input.type ?? 'note', title: input.title, content: input.content, tags: input.tags ?? [], ...(input.tier ? { tier: input.tier } : {}), ...(typeof input.importance === 'number' ? { importance: input.importance } : {}) }));
      }
      if (input.action === 'search') return json(memory.searchMemories(input.query ?? '').slice(0, input.limit ?? 20));
      if (input.action === 'recall') return json(memory.recallMemories(input.query ?? '', { tiers: input.tiers, limit: input.limit ?? 10 }));
      if (input.action === 'promote') {
        if (!input.id || !input.tier) return bad('promote requires id and tier.');
        return json(memory.promoteMemory(input.id, input.tier, input.importance));
      }
      if (input.action === 'prune_episodic') return json({ deleted: memory.pruneEpisodic({ olderThanDays: input.olderThanDays }) });
      if (input.action === 'list') return json(memory.listMemories(input.type).slice(0, input.limit ?? 50));
      if (input.action === 'stats') return json(memory.getMemoryStats());
      if (input.action === 'update') {
        if (!input.id) return bad('update requires id.');
        return json(memory.updateMemory(input.id, { ...(input.title ? { title: input.title } : {}), ...(input.content != null ? { content: input.content } : {}), ...(input.tags ? { tags: input.tags } : {}), ...(input.tier ? { tier: input.tier } : {}), ...(typeof input.importance === 'number' ? { importance: input.importance } : {}) }));
      }
      if (input.action === 'forget') return input.id ? json({ deleted: memory.deleteMemory(input.id) }) : bad('forget requires id.');
      if (input.action === 'index_workspace') return json(await getWorkspaceIndexer().buildIndex([input.path ?? ctx.cwd], true));
      if (input.action === 'semantic_search') return json(getWorkspaceIndexer().search(input.query ?? '', input.limit ?? 20));
      return bad(`Unknown Knowledge action: ${input.action}`);
    } catch (error) { return bad((error as Error).message); }
  },
};

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
