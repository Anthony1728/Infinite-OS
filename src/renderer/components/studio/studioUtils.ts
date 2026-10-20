import type { StudioSheet, StudioSlide } from '../../../shared/studio';
import { parseCsv } from '../../../shared/csv';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain text → paragraphs the editor and DOCX exporter both understand. */
export function textToHtml(value: string): string {
  const blocks = value.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((line) => escapeHtml(line)).join('<br>');
      return `<p>${lines || '<br>'}</p>`;
    })
    .join('');
}

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  // DOMParser is inert: scripts never execute, images never load.
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    doc.querySelectorAll('p,div,h1,h2,h3,li,blockquote').forEach((node) => node.append('\n'));
    return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

export function plainTextToSheet(text: string, columns = 12, rows = 30): StudioSheet {
  const parsed = parseCsv(text);
  const cells: Record<string, string> = {};
  parsed.slice(0, 500).forEach((row, rowIndex) => {
    row.slice(0, 26).forEach((value, columnIndex) => {
      if (!value) return;
      const letter = columnName(columnIndex);
      cells[`${letter}${rowIndex + 1}`] = value;
    });
  });
  return {
    columns: Math.max(6, Math.min(64, Math.max(columns, ...parsed.map((row) => row.length)))),
    rows: Math.max(12, Math.min(500, Math.max(rows, parsed.length + 4))),
    cells,
  };
}

export function columnName(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Decks come back as strict JSON, but a model can still answer with a readable
 * outline. Both are accepted so a hiccup never loses the content.
 */
export function parseDeckResult(text: string): StudioSlide[] {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(raw) as { slides?: Array<{ title?: unknown; body?: unknown; notes?: unknown }> };
    if (Array.isArray(parsed.slides)) {
      return parsed.slides
        .filter((slide) => slide && typeof slide === 'object')
        .map((slide, index) => ({
          id: `slide-${Date.now().toString(36)}-${index}`,
          title: typeof slide.title === 'string' ? slide.title : '',
          body: typeof slide.body === 'string' ? slide.body : '',
          notes: typeof slide.notes === 'string' ? slide.notes : undefined,
        }));
    }
  } catch {
    // Fall through to outline parsing.
  }
  const blocks = raw.split(/\n\s*---+\s*\n/).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const title = first.replace(/^#{1,3}\s*/, '').replace(/^\d+[.)]\s*/, '');
    return {
      id: `slide-${Date.now().toString(36)}-${index}`,
      title: title.slice(0, 300),
      body: lines.slice(1).join('\n').replace(/^[-*]\s?/gm, '• '),
    };
  });
}

export type DocumentApplyMode = 'insert' | 'replace' | 'replace-all';

export interface DocumentApplyDetail {
  itemId: string;
  text: string;
  mode: DocumentApplyMode;
}

/** Bridge from the AI panel to the live contentEditable selection. */
export function requestDocumentApply(detail: DocumentApplyDetail): void {
  window.dispatchEvent(new CustomEvent<DocumentApplyDetail>('infinite:studio-document-apply', { detail }));
}

export function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
