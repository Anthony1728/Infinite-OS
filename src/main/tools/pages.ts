/**
 * Pages agent tool.
 *
 * The Pages workspace is the user's durable notes / wiki / database layer.
 * This tool is deliberately non-core: it is attached only when the task
 * mentions pages, notes, wikis, or databases, so the default prompt stays
 * small. Writes go through PagesStore, which sanitises HTML, caps payloads,
 * and owns ids and timestamps.
 */

import { randomUUID } from 'node:crypto';
import type { Tool, ToolContext, ToolResult } from './base.js';
import type {
  DatabaseValue,
  PageBlock,
  PageBlockType,
  PageCreateInput,
  PageTemplateId,
  PageUpdateInput,
} from '../../shared/pages.js';
import { getPagesStore } from '../pages/store.js';

interface PagesArgs {
  action:
    | 'list'
    | 'get'
    | 'search'
    | 'create'
    | 'update'
    | 'append'
    | 'duplicate'
    | 'trash'
    | 'restore'
    | 'row_create'
    | 'row_update'
    | 'row_delete'
    | 'open_row'
    | 'comment_add'
    | 'version_save'
    | 'version_restore';
  id?: string;
  title?: string;
  icon?: string;
  parentId?: string | null;
  kind?: 'page' | 'database';
  templateId?: PageTemplateId;
  content?: string;
  blocks?: PageBlock[];
  query?: string;
  limit?: number;
  databaseId?: string;
  rowId?: string;
  values?: Record<string, DatabaseValue>;
  text?: string;
  blockId?: string;
  versionId?: string;
  favorite?: boolean;
  archived?: boolean;
}

function result(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function bad(message: string): ToolResult {
  return { content: message, is_error: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** A small, deterministic Markdown → block converter for agent writes. */
export function contentToBlocks(content: string): PageBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: PageBlock[] = [];
  const push = (type: PageBlockType, html: string, extra: Partial<PageBlock> = {}) => {
    blocks.push({ id: randomUUID(), type, html, depth: 0, ...extra });
  };
  let paragraph: string[] = [];
  const flush = () => {
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (text) push('paragraph', text.split('\n').map(inlineMarkdown).join('<br>'));
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    const fence = /^```([a-zA-Z0-9 +#._-]{0,30})\s*$/.exec(trimmed);
    if (fence) {
      flush();
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!.trim())) {
        code.push(lines[index]!);
        index++;
      }
      push('code', escapeHtml(code.join('\n')), { language: fence[1]?.trim() || 'plain text' });
      continue;
    }
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flush();
      push('divider', '');
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      push(level <= 2 ? 'heading1' : level === 3 ? 'heading2' : 'heading3', inlineMarkdown(heading[2]!));
      continue;
    }
    if (/^\|.+\|$/.test(trimmed) && index + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[index + 1]!.trim())) {
      flush();
      const cells = (value: string) => value.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => inlineMarkdown(cell.trim()));
      const headers = cells(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|.+\|$/.test(lines[index]!.trim())) {
        rows.push(cells(lines[index]!.trim()));
        index++;
      }
      index--;
      push('table', '', {
        table: { headers, rows: rows.map((row) => headers.map((_header, cellIndex) => row[cellIndex] ?? '')) },
      });
      continue;
    }
    const todo = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(trimmed);
    if (todo) {
      flush();
      push('todo', inlineMarkdown(todo[2]!), { checked: todo[1]!.toLowerCase() === 'x' });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flush();
      push('bulleted', inlineMarkdown(bullet[1]!));
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flush();
      push('numbered', inlineMarkdown(numbered[1]!));
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flush();
      push('quote', inlineMarkdown(quote[1]!));
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  if (!blocks.length) blocks.push({ id: randomUUID(), type: 'paragraph', html: '<p></p>', depth: 0 });
  return blocks;
}

function summary(page: {
  id: string;
  title: string;
  kind: string;
  parentId: string | null;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  updatedAt: number;
  rowDatabaseId?: string;
  rowId?: string;
}): Record<string, unknown> {
  return {
    id: page.id,
    title: page.title,
    kind: page.kind,
    parentId: page.parentId,
    favorite: page.favorite,
    archived: page.archived,
    trashed: page.trashedAt !== null,
    updatedAt: new Date(page.updatedAt).toISOString(),
    ...(page.rowDatabaseId ? { rowDatabaseId: page.rowDatabaseId, rowId: page.rowId } : {}),
  };
}

function blocksFrom(input: PagesArgs): PageBlock[] | undefined {
  if (input.blocks !== undefined) return input.blocks;
  if (input.content !== undefined) return contentToBlocks(input.content);
  return undefined;
}

export const pagesTool: Tool = {
  name: 'Pages',
  description:
    'Read and edit the user\'s Pages workspace: notes, wikis, nested pages, databases/tables, comments, and version history. ' +
    'Use list or search first, then get an id. create makes a page or database (optional templateId); update changes title/blocks/database metadata; append adds Markdown content without replacing existing text. ' +
    'row_create/row_update/row_delete manage database rows; open_row turns a row into a full page. Prefer this over writing loose files when the user says "my notes", "my wiki", "my page", "my database", "my CRM", or asks to organize their workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list', 'get', 'search', 'create', 'update', 'append', 'duplicate', 'trash', 'restore',
          'row_create', 'row_update', 'row_delete', 'open_row', 'comment_add', 'version_save', 'version_restore',
        ],
      },
      id: { type: 'string', description: 'Page id (or database id for row_* actions).' },
      title: { type: 'string' },
      icon: { type: 'string', description: 'A short emoji or glyph.' },
      parentId: { type: 'string', nullable: true, description: 'Parent page id; null for top level.' },
      kind: { type: 'string', enum: ['page', 'database'] },
      templateId: {
        type: 'string',
        enum: ['blank', 'meeting', 'project', 'weekly', 'wiki', 'task', 'crm', 'content', 'okr', 'reading', 'habit'],
      },
      content: { type: 'string', description: 'Markdown content. Headings, lists, todos, quotes, code fences, and tables are converted to blocks.' },
      blocks: {
        type: 'array',
        description: 'Optional precise block array; each block needs type and html.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            html: { type: 'string' },
            depth: { type: 'integer' },
            checked: { type: 'boolean' },
            collapsed: { type: 'boolean' },
            language: { type: 'string' },
            url: { type: 'string' },
            caption: { type: 'string' },
            pageId: { type: 'string' },
          },
          required: ['type'],
        },
      },
      query: { type: 'string', description: 'Search text.' },
      limit: { type: 'integer' },
      databaseId: { type: 'string' },
      rowId: { type: 'string' },
      values: { type: 'object', description: 'Database property id → value.' },
      text: { type: 'string', description: 'Comment text.' },
      blockId: { type: 'string', description: 'Optional block to attach a comment to.' },
      versionId: { type: 'string' },
      favorite: { type: 'boolean' },
      archived: { type: 'boolean' },
    },
    required: ['action'],
  },
  permission: 'none',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const input = args as PagesArgs;
    const store = getPagesStore();
    try {
      if (input.action === 'list') {
        const pages = store.list();
        return result({
          pages: pages.map(summary),
          stats: store.stats(),
        });
      }

      if (input.action === 'search') {
        const query = (input.query ?? input.title ?? '').trim();
        if (!query) return bad('search requires query.');
        return result({ hits: store.search(query, input.limit ?? 20) });
      }

      if (input.action === 'create') {
        const templateId = input.templateId;
        const createInput: PageCreateInput = {
          kind: input.kind,
          parentId: input.parentId,
          title: input.title,
          icon: input.icon,
          templateId,
        };
        const created = store.create(createInput);
        const blocks = blocksFrom(input);
        const page = blocks ? store.update(created.id, { blocks }) : created;
        return result({ page, message: `${page.kind === 'database' ? 'Database' : 'Page'} "${page.title}" created.` });
      }

      if (!input.id) return bad(`${input.action} requires id.`);
      const page = store.get(input.id);
      if (!page) return bad(`No Page with id ${input.id}.`);

      if (input.action === 'get') return result({ page });

      if (input.action === 'update') {
        const patch: PageUpdateInput = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.icon !== undefined) patch.icon = input.icon;
        if (input.favorite !== undefined) patch.favorite = input.favorite;
        if (input.archived !== undefined) patch.archived = input.archived;
        if (input.parentId !== undefined) patch.parentId = input.parentId;
        const blocks = blocksFrom(input);
        if (blocks) patch.blocks = blocks;
        if (!Object.keys(patch).length) return bad('update needs at least one field to change.');
        return result({ page: store.update(input.id, patch) });
      }

      if (input.action === 'append') {
        const blocks = blocksFrom(input);
        if (!blocks?.length) return bad('append requires content or blocks.');
        const next = page.blocks.length
          ? [...page.blocks, { id: randomUUID(), type: 'divider' as const, html: '', depth: 0 }, ...blocks]
          : blocks;
        return result({ page: store.update(input.id, { blocks: next }) });
      }

      if (input.action === 'duplicate') {
        const copy = store.duplicate(input.id);
        return copy ? result({ page: copy }) : bad('That page could not be duplicated.');
      }

      if (input.action === 'trash') {
        return result({ trashed: store.trash(input.id).length });
      }

      if (input.action === 'restore') {
        return result({ page: store.restore(input.id) });
      }

      if (input.action === 'row_create') {
        const databaseId = input.databaseId ?? input.id;
        const values = input.values ?? {};
        const database = store.createDatabaseRow(databaseId, { values });
        return result({ databaseId, rows: database.rows });
      }

      if (input.action === 'row_update') {
        if (!input.rowId) return bad('row_update requires rowId.');
        const databaseId = input.databaseId ?? input.id;
        const database = store.updateDatabaseRow(databaseId, input.rowId, { values: input.values });
        return result({ databaseId, rows: database.rows });
      }

      if (input.action === 'row_delete') {
        if (!input.rowId) return bad('row_delete requires rowId.');
        const databaseId = input.databaseId ?? input.id;
        const database = store.deleteDatabaseRow(databaseId, input.rowId);
        return result({ databaseId, rows: database.rows });
      }

      if (input.action === 'open_row') {
        if (!input.rowId) return bad('open_row requires rowId.');
        return result({ page: store.openRowPage(input.databaseId ?? input.id, input.rowId) });
      }

      if (input.action === 'comment_add') {
        if (!input.text?.trim()) return bad('comment_add requires text.');
        return result({ page: store.addComment(input.id, input.text, input.blockId) });
      }

      if (input.action === 'version_save') {
        return result({ page: store.saveVersion(input.id) });
      }

      if (input.action === 'version_restore') {
        if (!input.versionId) return bad('version_restore requires versionId.');
        return result({ page: store.restoreVersion(input.id, input.versionId) });
      }

      return bad(`Unknown Pages action: ${input.action}`);
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};
