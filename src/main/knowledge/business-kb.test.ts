import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home = '';
const savedHome = process.env.INFINITE_TEST_HOME;

beforeEach(() => {
  vi.resetModules();
  home = mkdtempSync(join(tmpdir(), 'kb-'));
  process.env.INFINITE_TEST_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

describe('business knowledge base', () => {
  it('round-trips entries and ranks title hits first', async () => {
    const kb = await import('./business-kb.js');
    expect(kb.listKb()).toEqual([]);
    kb.saveKb({ title: 'Plumbing price list', content: 'Callout fee R450. Geyser install R6500.', tags: ['pricing'] });
    kb.saveKb({ title: 'Staff rota', content: 'Monday: Thabo. The plumbing team meets Friday.' });
    const hits = kb.searchKb('plumbing prices');
    expect(hits).toHaveLength(2);
    expect(hits[0].title).toBe('Plumbing price list');
    expect(kb.deleteKb('missing')).toBe(false);
    expect(kb.deleteKb(hits[1].id)).toBe(true);
    expect(kb.listKb()).toHaveLength(1);
  });

  it('caches the parsed store while still reflecting every write', async () => {
    const kb = await import('./business-kb.js');
    kb.saveKb({ title: 'Supplier list', content: 'Geyser parts ship from Durban within two days.' });
    // Repeated reads agree with the file even though they come from cache.
    expect(kb.searchKb('geyser')[0].title).toBe('Supplier list');
    expect(kb.listKb()).toHaveLength(1);

    // A write through the API invalidates the cache.
    kb.saveKb({ title: 'Roofing rates', content: 'R950 per square for tile roof replacement work.' });
    expect(kb.searchKb('roofing')).toHaveLength(1);
    expect(kb.listKb()).toHaveLength(2);

    // An edit made outside the app is picked up as well (different size).
    const kbFile = join(home, 'knowledge', 'kb.json');
    const stored = JSON.parse(readFileSync(kbFile, 'utf8')) as unknown[];
    writeFileSync(kbFile, JSON.stringify(stored.slice(0, 1)), 'utf8');
    expect(kb.listKb()).toHaveLength(1);
  });

  it('rejects unsupported files and empty titles', async () => {
    const kb = await import('./business-kb.js');
    const bad = join(home, 'photo.png');
    writeFileSync(bad, 'x');
    await expect(kb.attachKbFile(bad)).rejects.toThrow('Unsupported file type');
    expect(() => kb.saveKb({ title: '  ' })).toThrow('title is required');
  });

  it('attaches text and csv files with readable content', async () => {
    const kb = await import('./business-kb.js');
    const txt = join(home, 'hours.txt');
    writeFileSync(txt, 'Open Mon-Fri 8-5, Sat 8-1.', 'utf8');
    const e1 = await kb.attachKbFile(txt);
    expect(e1.fileName).toBe('hours.txt');
    expect(e1.content).toContain('Mon-Fri');
    const csv = join(home, 'rates.csv');
    writeFileSync(csv, 'service,price\ncallout,450\ngeyser,6500\n', 'utf8');
    const e2 = await kb.attachKbFile(csv, 'Rate card');
    expect(e2.title).toBe('Rate card');
    expect(kb.searchKb('geyser')[0].id).toBe(e2.id);
  });

  it('extracts xlsx sheets and pdf pages', async () => {
    const kb = await import('./business-kb.js');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Prices');
    ws.addRow(['service', 'price']);
    ws.addRow(['callout', 450]);
    const xlsx = join(home, 'prices.xlsx');
    await wb.xlsx.writeFile(xlsx);
    const ex = await kb.attachKbFile(xlsx);
    expect(ex.content).toContain('callout');

    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText('Acme Plumbing terms: payment within 7 days.', { x: 50, y: 700, font, size: 12 });
    const pdfPath = join(home, 'terms.pdf');
    writeFileSync(pdfPath, await pdf.save());
    const ep = await kb.attachKbFile(pdfPath);
    expect(ep.fileName).toBe('terms.pdf');
    expect(ep.content).toContain('payment within 7 days');
  }, 60_000);
});
