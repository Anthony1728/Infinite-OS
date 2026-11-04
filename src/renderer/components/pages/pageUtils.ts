/**
 * Renderer-side helpers for Pages.
 *
 * Everything here is pure and testable: Markdown import, HTML/plain-text
 * conversion, image downscaling, and display formatting. The block editor
 * stays focused on interaction while these rules remain consistent.
 */

import type { PageBlock, PageBlockType } from '../../../shared/pages';

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
}

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    doc.querySelectorAll('p,div,h1,h2,h3,li,blockquote').forEach((node) => node.append('\n'));
    return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }
}

export function textToHtml(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split('\n').map(escapeHtml).join('<br>') || '<br>'}</p>`)
    .join('');
}

export function formatRelative(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (!Number.isFinite(delta)) return '';
  if (delta < 60_000) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function parseIsoDay(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) return new Date(value);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Downscale a picked image before storing it in a page body. A 12MP camera
 * JPEG becomes a few hundred KB instead of 8MB, which keeps page saves and
 * exports fast while still looking sharp on a desktop canvas.
 */
export async function readImageAsDataUrl(file: File, maxDimension = 1600): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('That image could not be read.'));
      element.src = objectUrl;
    });
    const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.fillStyle = '#111116';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    if (dataUrl.length > 2_800_000) return canvas.toDataURL('image/jpeg', 0.7);
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:|#|\/)/i;

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
    return SAFE_LINK.test(href) ? `<a href="${href.replace(/"/g, '&quot;')}">${label}</a>` : whole;
  });
  return html;
}

export interface MarkdownImport {
  title: string | null;
  blocks: PageBlock[];
}

/** A deliberately small, safe Markdown importer for pasted text and files. */
export function markdownToBlocks(markdown: string): MarkdownImport {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: PageBlock[] = [];
  let paragraph: string[] = [];
  let title: string | null = null;

  const push = (type: PageBlockType, html = '', extra: Partial<PageBlock> = {}) => {
    blocks.push({ id: newId(), type, html, depth: 0, ...extra });
  };
  const flush = () => {
    if (!paragraph.length) return;
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    const html = text.split('\n').map(inlineMarkdown).join('<br>');
    push('paragraph', html);
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const trimmed = line.trim();

    const fence = /^```([a-zA-Z0-9 +#._-]{0,30})\s*$/.exec(trimmed);
    if (fence) {
      flush();
      const language = fence[1]?.trim() || 'plain text';
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^```\s*$/.test(lines[index]!.trim())) {
        code.push(lines[index]!);
        index++;
      }
      push('code', escapeHtml(code.join('\n')), { language });
      continue;
    }

    if (!trimmed) {
      flush();
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flush();
      push('divider');
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      if (level === 1 && !title && blocks.length === 0) {
        title = heading[2]!.trim();
        continue;
      }
      push(level === 2 ? 'heading1' : level === 3 ? 'heading2' : 'heading3', inlineMarkdown(heading[2]!));
      continue;
    }

    if (/^\|.+\|$/.test(trimmed) && index + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[index + 1]!.trim())) {
      flush();
      const splitCells = (value: string) => value.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      const headers = splitCells(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|.+\|$/.test(lines[index]!.trim())) {
        rows.push(splitCells(lines[index]!.trim()));
        index++;
      }
      index--;
      push('table', '', {
        table: {
          headers: headers.map(inlineMarkdown),
          rows: rows.map((row) => headers.map((_header, cellIndex) => inlineMarkdown(row[cellIndex] ?? ''))),
        },
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

    const image = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(trimmed);
    if (image) {
      flush();
      const url = image[2]!.trim();
      if (/^https?:\/\//i.test(url)) push('image', '', { url, caption: image[1] || undefined });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return { title, blocks: blocks.length ? blocks : [{ id: newId(), type: 'paragraph', html: '', depth: 0 }] };
}

export interface SlashCommand {
  id: PageBlockType | 'child_page_link' | 'database_link';
  label: string;
  description: string;
  icon: string;
  keywords: string[];
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'paragraph', label: 'Text', description: 'Plain body text', icon: '¶', keywords: ['text', 'paragraph', 'plain'] },
  { id: 'heading1', label: 'Heading 1', description: 'Large section heading', icon: 'H1', keywords: ['h1', 'title', 'heading'] },
  { id: 'heading2', label: 'Heading 2', description: 'Medium section heading', icon: 'H2', keywords: ['h2', 'heading'] },
  { id: 'heading3', label: 'Heading 3', description: 'Small section heading', icon: 'H3', keywords: ['h3', 'heading'] },
  { id: 'bulleted', label: 'Bulleted list', description: 'Simple list with bullets', icon: '•', keywords: ['bullet', 'list', 'ul'] },
  { id: 'numbered', label: 'Numbered list', description: 'Ordered list', icon: '1.', keywords: ['number', 'list', 'ol'] },
  { id: 'todo', label: 'To-do', description: 'Track a task', icon: '☑', keywords: ['todo', 'task', 'checkbox', 'check'] },
  { id: 'toggle', label: 'Toggle', description: 'Collapsible content', icon: '▸', keywords: ['toggle', 'collapse', 'details'] },
  { id: 'quote', label: 'Quote', description: 'Capture a quotation', icon: '❝', keywords: ['quote', 'blockquote'] },
  { id: 'callout', label: 'Callout', description: 'Make a thought stand out', icon: '💡', keywords: ['callout', 'note', 'info'] },
  { id: 'divider', label: 'Divider', description: 'Visual separator', icon: '—', keywords: ['divider', 'line', 'hr'] },
  { id: 'code', label: 'Code', description: 'Code with a monospace block', icon: '</>', keywords: ['code', 'snippet'] },
  { id: 'table', label: 'Table', description: 'Simple editable table', icon: '▦', keywords: ['table', 'grid'] },
  { id: 'image', label: 'Image', description: 'Upload from this device', icon: '🖼', keywords: ['image', 'photo', 'picture', 'upload'] },
  { id: 'bookmark', label: 'Bookmark', description: 'Save a link as a card', icon: '🔗', keywords: ['bookmark', 'link', 'url'] },
  { id: 'child_page', label: 'Page', description: 'Create a nested page', icon: '📄', keywords: ['page', 'subpage', 'child'] },
  { id: 'child_database', label: 'Database', description: 'Create a nested database', icon: '🗂', keywords: ['database', 'table', 'board', 'collection'] },
];

export function blockTypeLabel(type: PageBlockType): string {
  return SLASH_COMMANDS.find((command) => command.id === type)?.label ?? 'Text';
}

export function databaseValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
