/**
 * Pages export — Markdown for pages/databases, CSV for database rows.
 *
 * Exports are deliberately self-contained and readable outside Infinite OS.
 * Links to local pages become ordinary Markdown links (`#page-<id>`) so a
 * multi-page export can still be navigated after conversion.
 */

import type {
  DatabaseProperty,
  DatabaseRow,
  DatabaseValue,
  PageBlock,
  PageDatabase,
  PageRecord,
} from '../../shared/pages.js';

function decode(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
}

function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|pre|figcaption)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/\n{3,}/g, '\n\n').trim();
}

function inlineMarkdown(html: string): string {
  let text = html || '';
  text = text.replace(/<br\s*\/?>/gi, '  \n');
  text = text.replace(/<(strong|b)>(.*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)>(.*?)<\/\1>/gi, '*$2*');
  text = text.replace(/<(s|strike)>(.*?)<\/\1>/gi, '~~$2~~');
  text = text.replace(/<code>(.*?)<\/code>/gi, '`$1`');
  text = text.replace(/<a\b[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_all, href: string, label: string) => `[${clean(label)}](${href})`);
  text = text.replace(/<li>(.*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decode(text).replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function clean(value: string): string {
  return decode(value.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function tableMarkdown(headers: string[], rows: string[][]): string {
  if (!headers.length) return '';
  const line = `| ${headers.map((header) => clean(header) || ' ').join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((cells) => `| ${headers.map((_header, index) => clean(cells[index] ?? '').replace(/\|/g, '\\|') || ' ').join(' | ')} |`);
  return [line, divider, ...body].join('\n');
}

function valueToText(value: DatabaseValue, property: DatabaseProperty): string {
  if (value === null || value === undefined) return '';
  if (property.type === 'checkbox') return value === true ? 'Yes' : 'No';
  if (property.type === 'select' || property.type === 'status') {
    return property.options?.find((option) => option.id === value)?.name ?? String(value);
  }
  if (property.type === 'multi_select' && Array.isArray(value)) {
    return value.map((id) => property.options?.find((option) => option.id === id)?.name ?? id).join(', ');
  }
  if (property.type === 'relation' && Array.isArray(value)) return value.join(', ');
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function databaseMarkdown(database: PageDatabase, title: string): string {
  const fields = database.properties;
  const header = `### ${title}`;
  const table = tableMarkdown(
    fields.map((property) => property.name),
    database.rows
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((row) => fields.map((property) => valueToText(row.values[property.id], property))),
  );
  return `${header}\n\n${table}`;
}

function databaseCsvText(database: PageDatabase): string {
  const escape = (value: string) => {
    const text = value.replace(/\r?\n/g, ' ');
    return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const fields = database.properties;
  const lines = [fields.map((property) => escape(property.name)).join(',')];
  for (const row of [...database.rows].sort((a, b) => a.order - b.order)) {
    lines.push(fields.map((property) => escape(valueToText(row.values[property.id], property))).join(','));
  }
  return lines.join('\r\n');
}

function blockMarkdown(block: PageBlock, titleOf: (id?: string) => string): string {
  const indent = '  '.repeat(Math.max(0, Math.min(4, block.depth)));
  switch (block.type) {
    case 'paragraph':
      return inlineMarkdown(block.html);
    case 'heading1':
      return `## ${inlineMarkdown(block.html) || 'Untitled'}`;
    case 'heading2':
      return `### ${inlineMarkdown(block.html) || 'Untitled'}`;
    case 'heading3':
      return `#### ${inlineMarkdown(block.html) || 'Untitled'}`;
    case 'bulleted':
      return `${indent}- ${inlineMarkdown(block.html)}`;
    case 'numbered':
      return `${indent}1. ${inlineMarkdown(block.html)}`;
    case 'todo':
      return `${indent}- [${block.checked ? 'x' : ' '}] ${inlineMarkdown(block.html)}`;
    case 'toggle':
      return `${indent}- ${block.collapsed ? '▸' : '▾'} ${inlineMarkdown(block.html)}`;
    case 'quote':
      return inlineMarkdown(block.html).split('\n').map((line) => `> ${line}`).join('\n');
    case 'callout':
      return `> ${block.icon ?? '💡'} ${inlineMarkdown(block.html)}`;
    case 'divider':
      return '---';
    case 'code': {
      const code = htmlToText(block.html);
      return `\`\`\`${block.language && block.language !== 'plain text' ? block.language : ''}\n${code}\n\`\`\``;
    }
    case 'image': {
      if (!block.url || block.url.startsWith('data:')) return `*[Image${block.caption ? `: ${block.caption}` : ''}]*`;
      return `![${block.caption ?? 'Image'}](${block.url})`;
    }
    case 'bookmark':
      return block.url ? `[${block.caption || block.url}](${block.url})` : '';
    case 'table':
      return block.table ? tableMarkdown(block.table.headers, block.table.rows) : '';
    case 'child_page':
    case 'child_database': {
      const label = titleOf(block.pageId);
      return block.pageId ? `- ${block.type === 'child_database' ? '🗂️' : '📄'} [${label}](#page-${block.pageId})` : '';
    }
    default:
      return '';
  }
}

export interface ExportLookup {
  get(id: string): PageRecord | null;
}

export function pageToMarkdown(page: PageRecord, lookup?: ExportLookup): string {
  const titleOf = (id?: string) => (id ? lookup?.get(id)?.title ?? 'Untitled' : 'Untitled');
  const lines: string[] = [`# ${page.icon ? `${page.icon} ` : ''}${page.title}`, ''];
  if (page.kind === 'database' && page.database) {
    lines.push(databaseMarkdown(page.database, page.title), '');
  }
  for (const block of page.blocks) {
    if (block.type === 'child_database' && block.pageId && lookup) {
      const child = lookup.get(block.pageId);
      if (child?.database) {
        lines.push(databaseMarkdown(child.database, child.title), '');
        continue;
      }
    }
    const text = blockMarkdown(block, titleOf);
    if (text) lines.push(text, '');
  }
  if (page.comments.length) {
    lines.push('### Comments', '');
    for (const comment of page.comments) {
      lines.push(`- **${comment.author}** · ${new Date(comment.createdAt).toLocaleString()} — ${comment.text}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function databaseToCsv(page: PageRecord): string {
  if (!page.database) throw new Error('That page is not a database.');
  return databaseCsvText(page.database);
}

export function databaseRowsToCsv(database: PageDatabase): string {
  return databaseCsvText(database);
}

export function rowToMarkdown(property: DatabaseProperty, row: DatabaseRow): string {
  return `**${property.name}:** ${valueToText(row.values[property.id], property)}`;
}
