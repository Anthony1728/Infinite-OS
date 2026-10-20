/**
 * Studio exporters — real Office files, not renamed HTML.
 *
 * Documents become .docx paragraphs with their headings, lists, bold/italic
 * runs preserved. Sheets become .xlsx with live formulas. Decks become .pptx
 * with a title/body layout per slide. The libraries are loaded lazily because
 * the app already pays for them only when the Document Generator tool is used.
 */

import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type { StudioItem } from '../../shared/studio.js';
import { columnName, parseCellAddress } from '../../shared/studio.js';

/** Decode the entities the editor can produce. */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

export interface DocumentBlock {
  kind: 'heading' | 'paragraph' | 'bullet' | 'quote' | 'code';
  level?: 1 | 2 | 3;
  runs: Array<{ text: string; bold?: boolean; italic?: boolean; underline?: boolean }>;
}

const INLINE_TOKEN = /<(\/?)(strong|b|em|i|u|code)\b[^>]*>|([^<]+)|<[^>]+>/gi;

function inlineRuns(html: string): DocumentBlock['runs'] {
  const runs: DocumentBlock['runs'] = [];
  const active = { bold: 0, italic: 0, underline: 0 };
  for (const match of html.matchAll(INLINE_TOKEN)) {
    const closing = match[1] === '/';
    const tag = match[2]?.toLowerCase();
    if (tag) {
      const delta = closing ? -1 : 1;
      if (tag === 'strong' || tag === 'b') active.bold = Math.max(0, active.bold + delta);
      else if (tag === 'em' || tag === 'i') active.italic = Math.max(0, active.italic + delta);
      else if (tag === 'u') active.underline = Math.max(0, active.underline + delta);
      continue;
    }
    const text = match[3];
    if (!text) continue;
    const decoded = decodeHtmlEntities(text);
    if (!decoded) continue;
    runs.push({
      text: decoded,
      bold: active.bold > 0 || undefined,
      italic: active.italic > 0 || undefined,
      underline: active.underline > 0 || undefined,
    });
  }
  // Merge adjacent runs with identical formatting so Word does not get one
  // run per word.
  const merged: DocumentBlock['runs'] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.underline === run.underline) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged;
}

/** Split editor HTML into block-level pieces the docx writer understands. */
export function htmlToDocumentBlocks(html: string): DocumentBlock[] {
  const blocks: DocumentBlock[] = [];
  const blockPattern = /<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const inner = match[2];
    if (tag.startsWith('h')) {
      const level = Math.min(3, Math.max(1, Number(tag.slice(1)))) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, runs: inlineRuns(inner) });
    } else if (tag === 'li') {
      blocks.push({ kind: 'bullet', runs: inlineRuns(inner) });
    } else if (tag === 'blockquote') {
      blocks.push({ kind: 'quote', runs: inlineRuns(inner) });
    } else if (tag === 'pre') {
      blocks.push({ kind: 'code', runs: [{ text: decodeHtmlEntities(inner.replace(/<[^>]+>/g, '')) }] });
    } else {
      const runs = inlineRuns(inner);
      blocks.push({ kind: 'paragraph', runs });
    }
  }
  if (!blocks.length) {
    const text = decodeHtmlEntities(html.replace(/<[^>]+>/g, '\n')).trim();
    if (text) blocks.push({ kind: 'paragraph', runs: [{ text }] });
  }
  return blocks;
}

export function sheetToCsv(item: StudioItem): string {
  const sheet = item.sheet;
  if (!sheet) return '';
  const lines: string[] = [];
  for (let row = 0; row < sheet.rows; row++) {
    const cells: string[] = [];
    for (let column = 0; column < sheet.columns; column++) {
      cells.push(sheet.cells[`${columnName(column)}${row + 1}`] ?? '');
    }
    if (cells.some((cell) => cell !== '')) lines.push(cells.map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function exportStudioItem(item: StudioItem, destination: string): Promise<void> {
  const extension = extname(destination).toLowerCase();
  if (item.kind === 'document') {
    await exportDocument(item, destination, extension);
  } else if (item.kind === 'sheet') {
    await exportSheet(item, destination, extension);
  } else {
    await exportDeck(item, destination, extension);
  }
}

async function exportDocument(item: StudioItem, destination: string, extension: string): Promise<void> {
  const blocks = htmlToDocumentBlocks(item.html ?? '');
  if (extension === '.html' || extension === '.htm') {
    await writeFile(destination, item.html ?? '', 'utf8');
    return;
  }
  if (extension === '.md') {
    const markdown = blocks.map((block) => {
      const text = block.runs.map((run) => run.text).join('');
      if (block.kind === 'heading') return `${'#'.repeat(block.level ?? 1)} ${text}`;
      if (block.kind === 'bullet') return `- ${text}`;
      if (block.kind === 'quote') return `> ${text}`;
      if (block.kind === 'code') return `\`\`\`\n${text}\n\`\`\``;
      return text;
    }).join('\n\n');
    await writeFile(destination, `# ${item.title}\n\n${markdown}\n`, 'utf8');
    return;
  }

  const docx = await import('docx');
  const children = blocks.map((block) => {
    const runs = block.runs.map((run) => new docx.TextRun({
      text: run.text,
      bold: run.bold,
      italics: run.italic,
      underline: run.underline ? {} : undefined,
      font: block.kind === 'code' ? 'Consolas' : undefined,
    }));
    if (block.kind === 'heading') {
      const heading = block.level === 1 ? docx.HeadingLevel.HEADING_1 : block.level === 2 ? docx.HeadingLevel.HEADING_2 : docx.HeadingLevel.HEADING_3;
      return new docx.Paragraph({ heading, children: runs, spacing: { before: 240, after: 120 } });
    }
    if (block.kind === 'bullet') {
      return new docx.Paragraph({ bullet: { level: 0 }, children: runs });
    }
    if (block.kind === 'quote') {
      return new docx.Paragraph({
        children: block.runs.map((run) => new docx.TextRun({
          text: run.text,
          bold: run.bold,
          italics: true,
          underline: run.underline ? {} : undefined,
        })),
        indent: { left: 480 },
      });
    }
    return new docx.Paragraph({ children: runs.length ? runs : [new docx.TextRun('')], spacing: { after: 120 } });
  });

  const document = new docx.Document({
    creator: 'Infinite OS Studio',
    title: item.title,
    sections: [{ properties: {}, children: children.length ? children : [new docx.Paragraph('')] }],
  });
  const buffer = await docx.Packer.toBuffer(document);
  await writeFile(destination, buffer);
}

const lastColumn = (sheet: NonNullable<StudioItem['sheet']>): number => {
  let max = sheet.columns - 1;
  for (const address of Object.keys(sheet.cells)) {
    const parsed = parseCellAddress(address);
    if (parsed) max = Math.max(max, parsed.column);
  }
  return Math.min(max, 63);
};

const lastRow = (sheet: NonNullable<StudioItem['sheet']>): number => {
  let max = sheet.rows - 1;
  for (const address of Object.keys(sheet.cells)) {
    const parsed = parseCellAddress(address);
    if (parsed) max = Math.max(max, parsed.row);
  }
  return Math.min(max, 499);
};

async function exportSheet(item: StudioItem, destination: string, extension: string): Promise<void> {
  const sheet = item.sheet;
  if (!sheet) return;
  if (extension === '.csv') {
    await writeFile(destination, sheetToCsv(item), 'utf8');
    return;
  }
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Infinite OS Studio';
  workbook.created = new Date(item.createdAt);
  const worksheet = workbook.addWorksheet(item.title.slice(0, 31) || 'Sheet');

  const columns = lastColumn(sheet);
  const rows = lastRow(sheet);
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const raw = sheet.cells[`${columnName(column)}${row + 1}`];
      if (!raw) continue;
      const cell = worksheet.getCell(row + 1, column + 1);
      if (raw.startsWith('=') && raw.length > 1) {
        cell.value = { formula: raw.slice(1) };
      } else if (raw.trim() !== '' && Number.isFinite(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
        cell.value = Number(raw);
      } else {
        cell.value = raw;
      }
    }
  }

  // Header styling when the first row looks like labels.
  const firstRow = Array.from({ length: columns + 1 }, (_v, column) => worksheet.getCell(1, column + 1).value);
  const hasHeader = firstRow.filter((value) => value !== null && value !== undefined && value !== '').length >= 2;
  if (hasHeader) {
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4C1D95' } };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  for (let column = 0; column <= columns; column++) {
    let width = 10;
    for (let row = 0; row <= Math.min(rows, 200); row++) {
      const value = worksheet.getCell(row + 1, column + 1).value;
      const text = value && typeof value === 'object' && 'formula' in value ? String(value.formula) : String(value ?? '');
      width = Math.max(width, Math.min(46, text.length + 3));
    }
    worksheet.getColumn(column + 1).width = width;
  }

  await workbook.xlsx.writeFile(destination);
}

async function exportDeck(item: StudioItem, destination: string, extension: string): Promise<void> {
  const slides = item.deck?.slides ?? [];
  if (extension === '.md') {
    const markdown = slides.map((slide) => `## ${slide.title}\n\n${slide.body}${slide.notes ? `\n\n> ${slide.notes}` : ''}`).join('\n\n---\n\n');
    await writeFile(destination, `# ${item.title}\n\n${markdown}\n`, 'utf8');
    return;
  }
  const PptxGenJS = (await import('pptxgenjs')).default;
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.author = 'Infinite OS Studio';
  deck.title = item.title;
  for (const slide of slides) {
    const page = deck.addSlide();
    page.background = { color: '0B0F19' };
    page.addText(slide.title || 'Untitled slide', {
      x: 0.7, y: 0.55, w: 11.9, h: 1.1,
      fontSize: 30, bold: true, color: 'F8FAFC', fontFace: 'Segoe UI',
    });
    page.addShape('rect', { x: 0.7, y: 1.62, w: 1.1, h: 0.05, fill: { color: '8B5CF6' }, line: { color: '8B5CF6' } });
    if (slide.body.trim()) {
      page.addText(slide.body.split('\n').filter(Boolean).map((line) => ({
        text: line.replace(/^[-•]\s*/, ''),
        options: { bullet: /^[-•]\s*/.test(line) || slide.body.includes('\n'), fontSize: 16, color: 'CBD5E1', breakLine: true },
      })), { x: 0.75, y: 1.95, w: 11.8, h: 4.6, fontFace: 'Segoe UI', lineSpacingMultiple: 1.15 });
    }
    if (slide.notes?.trim()) page.addNotes(slide.notes);
  }
  await deck.writeFile({ fileName: destination });
}
