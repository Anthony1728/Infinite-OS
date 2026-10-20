/**
 * Studio agent tool — lets Infinite AI read and edit the same documents,
 * spreadsheets, and decks the user sees.
 *
 * This is intentionally not a core tool: the schemas are attached only when a
 * task mentions documents, sheets, or slides, so the default prompt stays
 * lean. All writes go through StudioStore, which enforces limits and sanitizes
 * document HTML before it can ever reach a renderer.
 */

import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './base.js';
import { outputDirectoryDenial } from './write-guard.js';
import {
  STUDIO_KIND_LABEL,
  columnName,
  type StudioDeck,
  type StudioItem,
  type StudioKind,
} from '../../shared/studio.js';
import { parseCsv } from '../../shared/csv.js';
import { getStudioStore } from '../studio/store.js';
import { exportStudioItem } from '../studio/export.js';

interface StudioArgs {
  action:
    | 'list'
    | 'get'
    | 'create'
    | 'rename'
    | 'star'
    | 'delete'
    | 'write_document'
    | 'append_document'
    | 'update_sheet'
    | 'update_deck'
    | 'export';
  id?: string;
  kind?: StudioKind;
  title?: string;
  content?: string;
  /** Treat `content` as already-formed editor HTML. */
  html?: boolean;
  cells?: Record<string, string>;
  csv?: string;
  columns?: number;
  rows?: number;
  slides?: Array<{ title?: string; body?: string; notes?: string }>;
  path?: string;
  format?: string;
  starred?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text → the same paragraph shape the editor produces. */
function textToHtml(value: string): string {
  const paragraphs = value.replace(/\r\n/g, '\n').split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map((line) => escapeHtml(line)).join('<br>');
    return `<p>${lines || '<br>'}</p>`;
  });
  return paragraphs.join('');
}

function result(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function bad(message: string): ToolResult {
  return { content: message, is_error: true };
}

function summary(item: StudioItem): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    updatedAt: new Date(item.updatedAt).toISOString(),
    starred: item.starred,
  };
}

function detail(item: StudioItem): Record<string, unknown> {
  if (item.kind === 'sheet') {
    return { ...summary(item), sheet: item.sheet };
  }
  if (item.kind === 'slides') {
    return { ...summary(item), slides: item.deck?.slides ?? [] };
  }
  return { ...summary(item), html: item.html ?? '' };
}

function importCsv(cells: Record<string, string>, csv: string): number {
  const rows = parseCsv(csv);
  let written = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (columnIndex >= 26 || rowIndex >= 500) return;
      const address = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (value === '') delete cells[address];
      else cells[address] = value.slice(0, 4_000);
      written++;
    });
  });
  return written;
}

export const studioTool: Tool = {
  name: 'Studio',
  description:
    'Read and edit the user\'s Studio documents, spreadsheets, and slide decks. ' +
    'List or get items first; create returns the new id. write_document replaces a document (plain text by default, set html:true only for editor HTML). ' +
    'append_document adds paragraphs. update_sheet merges A1 cells and/or imports CSV. update_deck replaces all slides. ' +
    'export writes a real .docx/.xlsx/.pptx/.csv/.md/.html file to a path under the user\'s home folder. ' +
    'Use this whenever the user says "my document", "the sheet", "the deck", "add this to my notes document", or asks you to write/format/export an office file they should keep editing.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'list', 'get', 'create', 'rename', 'star', 'delete',
          'write_document', 'append_document', 'update_sheet', 'update_deck', 'export',
        ],
      },
      id: { type: 'string', description: 'Studio item id.' },
      kind: { type: 'string', enum: ['document', 'sheet', 'slides'] },
      title: { type: 'string' },
      content: { type: 'string', description: 'Document text (or HTML when html:true).' },
      html: { type: 'boolean' },
      cells: { type: 'object', description: 'A1 address → raw cell input, formulas allowed.' },
      csv: { type: 'string', description: 'CSV to import; first row becomes row 1.' },
      columns: { type: 'integer' },
      rows: { type: 'integer' },
      slides: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string' }, body: { type: 'string' }, notes: { type: 'string' } },
        },
      },
      path: { type: 'string', description: 'Absolute export path, including extension.' },
      format: { type: 'string', description: 'docx | xlsx | pptx | csv | md | html' },
      starred: { type: 'boolean' },
    },
    required: ['action'],
  },
  permission: 'ask',
  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const input = args as StudioArgs;
    const store = getStudioStore();
    try {
      if (input.action === 'list') {
        const items = store.list().filter((item) => !input.kind || item.kind === input.kind);
        return result({ items: items.map(summary), stats: {
          documents: items.filter((item) => item.kind === 'document').length,
          sheets: items.filter((item) => item.kind === 'sheet').length,
          decks: items.filter((item) => item.kind === 'slides').length,
        } });
      }

      if (input.action === 'create') {
        if (!input.kind) return bad('create requires kind: document, sheet, or slides.');
        const item = store.create({ kind: input.kind, title: input.title });
        return result({ created: detail(item), message: `${STUDIO_KIND_LABEL[item.kind]} “${item.title}” created.` });
      }

      if (input.action === 'get') {
        if (!input.id) return bad('get requires id.');
        const item = store.get(input.id);
        return item ? result(detail(item)) : bad(`No Studio item with id ${input.id}.`);
      }

      if (input.action === 'delete') {
        if (!input.id) return bad('delete requires id.');
        return result({ deleted: store.delete(input.id) });
      }

      if (!input.id) return bad(`${input.action} requires id.`);
      const existing = store.get(input.id);
      if (!existing) return bad(`No Studio item with id ${input.id}.`);

      if (input.action === 'rename') {
        if (!input.title) return bad('rename requires title.');
        const updated = store.update(input.id, { title: input.title });
        return result({ updated: updated ? summary(updated) : null });
      }

      if (input.action === 'star') {
        const updated = store.update(input.id, { starred: input.starred === true });
        return result({ updated: updated ? summary(updated) : null });
      }

      if (input.action === 'write_document' || input.action === 'append_document') {
        if (!input.content) return bad(`${input.action} requires content.`);
        const addition = input.html ? input.content : textToHtml(input.content);
        const html = input.action === 'write_document'
          ? addition
          : `${existing.html ?? ''}${existing.html && !existing.html.endsWith('</p>') ? '<p></p>' : ''}${addition}`;
        const updated = store.update(input.id, { html });
        return result({ updated: updated ? summary(updated) : null, characters: input.content.length });
      }

      if (input.action === 'update_sheet') {
        const sheet = { ...(existing.sheet ?? { columns: 12, rows: 30, cells: {} }) };
        sheet.cells = { ...sheet.cells };
        if (input.columns !== undefined) sheet.columns = input.columns;
        if (input.rows !== undefined) sheet.rows = input.rows;
        if (input.cells) {
          for (const [address, value] of Object.entries(input.cells)) {
            const key = address.toUpperCase();
            if (typeof value === 'string' && key) sheet.cells[key] = value;
          }
        }
        if (input.csv) importCsv(sheet.cells, input.csv);
        const updated = store.update(input.id, { sheet });
        return result({ updated: updated ? summary(updated) : null, cells: Object.keys(sheet.cells).length });
      }

      if (input.action === 'update_deck') {
        if (!Array.isArray(input.slides)) return bad('update_deck requires slides[].');
        const deck: StudioDeck = {
          slides: input.slides.slice(0, 120).map((slide, index) => ({
            id: `slide-${Date.now().toString(36)}-${index}`,
            title: slide.title ?? '',
            body: slide.body ?? '',
            notes: slide.notes,
          })),
        };
        const updated = store.update(input.id, { deck });
        return result({ updated: updated ? summary(updated) : null, slides: deck.slides.length });
      }

      if (input.action === 'export') {
        const destination = input.path
          ? input.path
          : join(homedir(), 'Documents', `${existing.title.replace(/[<>:"/\\|?*]/g, ' ').trim() || 'Untitled'}.${defaultExtension(existing.kind, input.format)}`);
        const denial = outputDirectoryDenial(dirname(destination), ctx.cwd);
        if (denial) return bad(denial);
        await exportStudioItem(existing, destination);
        return result({ exported: destination, kind: existing.kind, extension: extname(destination) });
      }

      return bad(`Unknown Studio action: ${input.action}`);
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};

function defaultExtension(kind: StudioKind, format?: string): string {
  if (format) return format.replace(/^\./, '');
  return kind === 'document' ? 'docx' : kind === 'sheet' ? 'xlsx' : 'pptx';
}
