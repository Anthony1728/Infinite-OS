import type { Tool, ToolResult } from './base.js';
import * as memory from '../memory/store.js';
import * as graph from '../memory/graph.js';
import { getWorkspaceIndexer } from '../indexing/indexer.js';

export const knowledgeTool: Tool = {
  name: 'Knowledge',
  description: 'Long-term memory and semantic workspace index. Store/recall facts, remember with graph=true, traverse with graph_recall, and search code with semantic_search.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['remember', 'search', 'recall', 'list', 'update', 'forget', 'stats', 'promote', 'prune_episodic', 'index_workspace', 'semantic_search', 'graph_remember', 'graph_recall', 'graph_link', 'graph_improve', 'graph_forget', 'graph_stats', 'datasets'] },
      id: { type: 'string' },
      type: { type: 'string', enum: ['preference', 'project', 'document', 'chat', 'note'] },
      tier: { type: 'string', enum: ['episodic', 'semantic', 'procedural'], description: 'episodic decays, semantic persists, procedural holds how-tos' },
      importance: { type: 'number', description: '0-1 (default 0.5)' },
      tiers: { type: 'array', items: { type: 'string' }, description: 'Recall only these tiers' },
      olderThanDays: { type: 'number', description: 'prune_episodic cutoff (default 30)' },
      title: { type: 'string' },
      content: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      query: { type: 'string' },
      path: { type: 'string' },
      limit: { type: 'number' },
      dataset: { type: 'string', description: 'Namespace (default: default)' },
      graph: { type: 'boolean', description: 'remember: also extract graph' },
      nodeId: { type: 'string' },
      targetId: { type: 'string' },
      relation: { type: 'string' },
      depth: { type: 'number', description: 'graph_recall hops (1-3)' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; id?: string; type?: 'preference' | 'project' | 'document' | 'chat' | 'note'; tier?: 'episodic' | 'semantic' | 'procedural'; importance?: number; tiers?: Array<'episodic' | 'semantic' | 'procedural'>; olderThanDays?: number; title?: string; content?: string; tags?: string[]; query?: string; path?: string; limit?: number; dataset?: string; graph?: boolean; nodeId?: string; targetId?: string; relation?: string; depth?: number };
    try {
      if (input.action === 'remember') {
        if (!input.title || input.content == null) return bad('remember requires title and content.');
        const entry = memory.createMemory({ type: input.type ?? 'note', title: input.title, content: input.content, tags: input.tags ?? [], ...(input.dataset ? { dataset: input.dataset } : {}), ...(input.tier ? { tier: input.tier } : {}), ...(typeof input.importance === 'number' ? { importance: input.importance } : {}) });
        if (!input.graph) return json(entry);
        try {
          const extracted = graph.rememberGraph({ dataset: entry.dataset, title: entry.title, content: entry.content, tags: entry.tags });
          return json({ memory: entry, graph: extracted });
        } catch (error) {
          return json({ memory: entry, graph: null, graph_error: (error as Error).message });
        }
      }
      if (input.action === 'graph_remember') {
        if (!input.title || input.content == null) return bad('graph_remember requires title and content.');
        return json(graph.rememberGraph({ dataset: input.dataset, title: input.title, content: input.content, tags: input.tags ?? [] }));
      }
      if (input.action === 'graph_recall') return json(graph.recallGraph(input.query ?? '', { dataset: input.dataset, depth: input.depth, limit: input.limit }));
      if (input.action === 'graph_link') {
        if (!input.nodeId || !input.targetId) return bad('graph_link requires nodeId and targetId.');
        return json(graph.linkGraphNodes({ dataset: input.dataset, sourceId: input.nodeId, targetId: input.targetId, relation: input.relation }));
      }
      if (input.action === 'graph_improve') return json(graph.improveGraph(input.dataset));
      if (input.action === 'graph_forget') {
        if (!input.nodeId && !input.query) return bad('graph_forget requires nodeId or query.');
        return json(graph.forgetGraph({ dataset: input.dataset, nodeId: input.nodeId, query: input.query }));
      }
      if (input.action === 'graph_stats') return json(graph.graphStats(input.dataset));
      if (input.action === 'datasets') return json(graph.listDatasets());
      if (input.action === 'search') return json(memory.searchMemories(input.query ?? '', input.dataset).slice(0, input.limit ?? 20));
      if (input.action === 'recall') return json(memory.recallMemories(input.query ?? '', { tiers: input.tiers, limit: input.limit ?? 10, dataset: input.dataset }));
      if (input.action === 'promote') {
        if (!input.id || !input.tier) return bad('promote requires id and tier.');
        return json(memory.promoteMemory(input.id, input.tier, input.importance));
      }
      if (input.action === 'prune_episodic') return json({ deleted: memory.pruneEpisodic({ olderThanDays: input.olderThanDays }) });
      if (input.action === 'list') return json(memory.listMemories(input.type, undefined, input.dataset).slice(0, input.limit ?? 50));
      if (input.action === 'stats') return json({ memory: memory.getMemoryStats(input.dataset), graph: graph.graphStats(input.dataset) });
      if (input.action === 'update') {
        if (!input.id) return bad('update requires id.');
        return json(memory.updateMemory(input.id, { ...(input.title ? { title: input.title } : {}), ...(input.content != null ? { content: input.content } : {}), ...(input.tags ? { tags: input.tags } : {}), ...(input.tier ? { tier: input.tier } : {}), ...(typeof input.importance === 'number' ? { importance: input.importance } : {}), ...(input.dataset ? { dataset: input.dataset } : {}) }));
      }
      if (input.action === 'forget') return input.id ? json({ deleted: memory.deleteMemory(input.id) }) : bad('forget requires id.');
      if (input.action === 'index_workspace') return json(await getWorkspaceIndexer().buildIndex([input.path ?? ctx.cwd], true));
      // True semantic path: embeds the query with Ollama when available
      // (lazily upgrading restored chunks) and falls back to lexical scoring.
      if (input.action === 'semantic_search') return json(await getWorkspaceIndexer().searchSemantic(input.query ?? '', input.limit ?? 20));
      return bad(`Unknown Knowledge action: ${input.action}`);
    } catch (error) { return bad((error as Error).message); }
  },
};

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
