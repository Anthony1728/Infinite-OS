import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StudioItem } from '../../shared/studio.js';
import { exportStudioItem, htmlToDocumentBlocks, sheetToCsv } from './export.js';

const now = 1_760_000_000_000;
const base = { createdAt: now, updatedAt: now, starred: false };
let dir: string | null = null;

function tempDir(): string {
  dir = mkdtempSync(join(tmpdir(), 'infinite-studio-export-'));
  return dir;
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function expectZip(path: string): void {
  const bytes = readFileSync(path);
  expect(bytes.length).toBeGreaterThan(1_000);
  expect(bytes.subarray(0, 2).toString('utf8')).toBe('PK');
}

describe('Studio exporters', () => {
  it('splits editor HTML into Word blocks and keeps inline formatting', () => {
    const blocks = htmlToDocumentBlocks(
      '<h1>Launch</h1><p>Hello <strong>bold</strong> and <em>soft</em>.</p><ul><li>One</li><li>Two</li></ul><blockquote>Quoted &amp; true</blockquote>',
    );
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'bullet', 'bullet', 'quote']);
    expect(blocks[0].level).toBe(1);
    expect(blocks[1].runs).toEqual([
      { text: 'Hello ', bold: undefined, italic: undefined, underline: undefined },
      { text: 'bold', bold: true, italic: undefined, underline: undefined },
      { text: ' and ', bold: undefined, italic: undefined, underline: undefined },
      { text: 'soft', bold: undefined, italic: true, underline: undefined },
      { text: '.', bold: undefined, italic: undefined, underline: undefined },
    ]);
    expect(blocks[4].runs[0].text).toBe('Quoted & true');
  });

  it('exports a document to DOCX, Markdown, and HTML', async () => {
    const folder = tempDir();
    const item: StudioItem = {
      ...base,
      id: 'doc-1',
      kind: 'document',
      title: 'Launch plan',
      html: '<h1>Launch</h1><p>Hello <strong>world</strong>.</p><ul><li>Ship it</li></ul>',
    };
    const docx = join(folder, 'launch.docx');
    const md = join(folder, 'launch.md');
    const html = join(folder, 'launch.html');
    await exportStudioItem(item, docx);
    await exportStudioItem(item, md);
    await exportStudioItem(item, html);
    expectZip(docx);
    expect(readFileSync(md, 'utf8')).toContain('# Launch plan');
    expect(readFileSync(md, 'utf8')).toContain('- Ship it');
    expect(readFileSync(html, 'utf8')).toContain('<strong>world</strong>');
  });

  it('exports a sheet with formulas to XLSX and CSV', async () => {
    const folder = tempDir();
    const item: StudioItem = {
      ...base,
      id: 'sheet-1',
      kind: 'sheet',
      title: 'Budget',
      sheet: {
        columns: 4,
        rows: 5,
        cells: {
          A1: 'Revenue',
          A2: '10',
          A3: '=A2*2',
          B1: 'Note, with comma',
        },
      },
    };
    const xlsx = join(folder, 'budget.xlsx');
    const csv = join(folder, 'budget.csv');
    await exportStudioItem(item, xlsx);
    await exportStudioItem(item, csv);
    expectZip(xlsx);
    const text = readFileSync(csv, 'utf8');
    expect(text).toContain('Revenue');
    expect(text).toContain('=A2*2');
    expect(text).toContain('"Note, with comma"');
    expect(sheetToCsv(item).split('\r\n')[2]).toContain('=A2*2');
  });

  it('exports a deck to PPTX and Markdown', async () => {
    const folder = tempDir();
    const item: StudioItem = {
      ...base,
      id: 'deck-1',
      kind: 'slides',
      title: 'Board update',
      deck: {
        slides: [
          { id: 's1', title: 'Opening', body: 'Welcome', notes: 'Smile.' },
          { id: 's2', title: 'Numbers', body: '• Up\n• Focused' },
        ],
      },
    };
    const pptx = join(folder, 'board.pptx');
    const md = join(folder, 'board.md');
    await exportStudioItem(item, pptx);
    await exportStudioItem(item, md);
    expectZip(pptx);
    const text = readFileSync(md, 'utf8');
    expect(text).toContain('## Opening');
    expect(text).toContain('> Smile.');
    expect(text).toContain('## Numbers');
  });
});
