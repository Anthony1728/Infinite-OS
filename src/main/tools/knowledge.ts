import type { Tool, ToolResult } from './base.js';
import * as memory from '../memory/store.js';
import { getWorkspaceIndexer } from '../indexing/indexer.js';

export const knowledgeTool: Tool = {
  name: 'Knowledge',
  description: 'Manage long-term user/project/document/prompt memory and the semantic workspace index. Use for remembering facts, saved prompts/templates, document search, RAG, and repository understanding.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['remember', 'search', 'list', 'update', 'forget', 'stats', 'index_workspace', 'semantic_search'] },
      id: { type: 'string' },
      type: { type: 'string', enum: ['preference', 'project', 'document', 'chat', 'note'] },
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
    const input = args as { action: string; id?: string; type?: 'preference' | 'project' | 'document' | 'chat' | 'note'; title?: string; content?: string; tags?: string[]; query?: string; path?: string; limit?: number };
    try {
      if (input.action === 'remember') {
        if (!input.title || input.content == null) return bad('remember requires title and content.');
        return json(memory.createMemory({ type: input.type ?? 'note', title: input.title, content: input.content, tags: input.tags ?? [] }));
      }
      if (input.action === 'search') return json(memory.searchMemories(input.query ?? '').slice(0, input.limit ?? 20));
      if (input.action === 'list') return json(memory.listMemories(input.type).slice(0, input.limit ?? 50));
      if (input.action === 'stats') return json(memory.getMemoryStats());
      if (input.action === 'update') {
        if (!input.id) return bad('update requires id.');
        return json(memory.updateMemory(input.id, { ...(input.title ? { title: input.title } : {}), ...(input.content != null ? { content: input.content } : {}), ...(input.tags ? { tags: input.tags } : {}) }));
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
