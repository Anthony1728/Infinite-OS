/**
 * BusinessKnowledge — the agent's handle on the business knowledge base
 * (Knowledge tab). Search company facts and uploaded file contents (PDF,
 * Excel, CSV, text) before answering business questions; add lasting business
 * facts so they persist outside chat. Separate from the Memory tab, which
 * holds the agent's own episodic/semantic/procedural memory.
 */
import type { Tool, ToolResult } from './base.js';
import { listKb, getKb, saveKb, deleteKb, searchKb } from '../knowledge/business-kb.js';

export const businessKnowledgeTool: Tool = {
  name: 'BusinessKnowledge',
  description: 'Search and manage the business knowledge base (Knowledge tab): company facts plus uploaded PDF/Excel/CSV/text contents. Use search before answering business questions so replies fit the actual business; use add to record lasting business facts. File uploads themselves happen in the Knowledge tab UI.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['search', 'get', 'list', 'add', 'remove'] },
      query: { type: 'string', description: 'search: what to look up' },
      id: { type: 'string', description: 'get/remove: the entry id' },
      title: { type: 'string', description: 'add: entry title' },
      content: { type: 'string', description: 'add: entry content' },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as { action: string; query?: string; id?: string; title?: string; content?: string; tags?: string[]; limit?: number };
    try {
      if (input.action === 'search') return json(searchKb(input.query ?? '', input.limit ?? 5).map(brief));
      if (input.action === 'list') return json(listKb().slice(0, input.limit ?? 30).map(brief));
      if (input.action === 'get') {
        if (!input.id) return bad('get requires id.');
        const entry = getKb(input.id);
        return entry ? json(entry) : bad('Entry not found.');
      }
      if (input.action === 'add') {
        if (!input.title?.trim()) return bad('add requires title.');
        return json(brief(saveKb({ title: input.title, content: input.content ?? '', tags: input.tags })));
      }
      if (input.action === 'remove') {
        if (!input.id) return bad('remove requires id.');
        return json({ deleted: deleteKb(input.id) });
      }
      return bad(`Unknown BusinessKnowledge action: ${input.action}`);
    } catch (error) { return bad((error as Error).message); }
  },
};

function brief(e: { id: string; title: string; content: string; tags: string[]; fileName: string | null; updatedAt: number }): object {
  const snippet = e.content.length > 800 ? `${e.content.slice(0, 800)}…` : e.content;
  return { id: e.id, title: e.title, tags: e.tags, fileName: e.fileName, updatedAt: e.updatedAt, snippet };
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
