import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from './store.js';
import { sanitizeDocumentHtml } from './sanitize.js';
import { htmlToDocumentBlocks } from './export.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infinite-studio-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('StudioStore', () => {
  it('creates a document with an empty paragraph and durable defaults', () => {
    const store = new StudioStore({ dataDir: tempDir(), now: () => 1_000, id: () => 'doc-1' });
    const doc = store.create({ kind: 'document' });
    expect(doc.id).toBe('doc-1');
    expect(doc.title).toBe('Untitled document');
    expect(doc.html).toBe('<p></p>');
    expect(doc.createdAt).toBe(1_000);
    expect(doc.updatedAt).toBe(1_000);
    expect(store.list()).toHaveLength(1);
  });

  it('creates sheets and decks with usable starting content', () => {
    const store = new StudioStore({ dataDir: tempDir(), now: () => 1 });
    const sheet = store.create({ kind: 'sheet', title: 'Budget' });
    expect(sheet.sheet?.columns).toBeGreaterThan(0);
    expect(sheet.sheet?.rows).toBeGreaterThan(0);
    const deck = store.create({ kind: 'slides' });
    expect(deck.deck?.slides).toHaveLength(1);
  });

  it('sanitizes document HTML on write and on load', () => {
    const dir = tempDir();
    const store = new StudioStore({ dataDir: dir, now: () => 2 });
    const doc = store.create({ kind: 'document' });
    const updated = store.update(doc.id, {
      html: '<h1>Title</h1><script>alert(1)</script><p onclick="steal()">Body</p><a href="javascript:alert(1)">x</a>',
    });
    expect(updated?.html).toContain('<h1>Title</h1>');
    expect(updated?.html).not.toContain('<script');
    expect(updated?.html).not.toContain('onclick');
    expect(updated?.html).not.toContain('javascript:');

    const reloaded = new StudioStore({ dataDir: dir });
    const raw = reloaded.get(doc.id);
    expect(raw?.html).toContain('<p>Body</p>');
  });

  it('normalizes sheet cells: valid addresses only, length and count capped', () => {
    const store = new StudioStore({ dataDir: tempDir(), now: () => 3 });
    const sheet = store.create({ kind: 'sheet' });
    const cells: Record<string, string> = {
      A1: '10',
      b2: '=A1*2',
      __proto__: 'bad',
      'not-a-cell': 'bad',
      ZZ99: 'too far',
      A3: 'x'.repeat(10_000),
    };
    const updated = store.update(sheet.id, { sheet: { columns: 12, rows: 30, cells } });
    expect(updated?.sheet?.cells.A1).toBe('10');
    expect(updated?.sheet?.cells.B2).toBe('=A1*2');
    expect(updated?.sheet?.cells['not-a-cell']).toBeUndefined();
    expect(updated?.sheet?.cells.A3.length).toBeLessThanOrEqual(4_000);
    expect(Object.prototype.hasOwnProperty.call(updated?.sheet?.cells, '__proto__')).toBe(false);
  });

  it('persists, duplicates, and deletes', () => {
    const dir = tempDir();
    let next = 0;
    const store = new StudioStore({ dataDir: dir, now: () => 10, id: () => `id-${++next}` });
    const doc = store.create({ kind: 'document', title: 'Plan' });
    store.update(doc.id, { html: '<p>Ship it</p>', starred: true });

    const copy = store.duplicate(doc.id);
    expect(copy?.title).toBe('Plan copy');
    expect(copy?.starred).toBe(false);
    expect(copy?.html).toBe('<p>Ship it</p>');

    const reloaded = new StudioStore({ dataDir: dir, now: () => 20, id: () => `reload-${++next}` });
    expect(reloaded.list()).toHaveLength(2);
    expect(reloaded.get(doc.id)?.starred).toBe(true);
    expect(reloaded.delete(doc.id)).toBe(true);
    expect(reloaded.delete(doc.id)).toBe(false);
    expect(reloaded.list()).toHaveLength(1);
  });

  it('preserves a corrupt file instead of overwriting it', () => {
    const dir = tempDir();
    const store = new StudioStore({ dataDir: dir });
    store.create({ kind: 'document' });
    const file = join(dir, 'studio.json');
    writeFileSync(file, '{not json', 'utf8');
    const recovered = new StudioStore({ dataDir: dir });
    expect(recovered.list()).toEqual([]);
    expect(readdirSync(dir).some((name) => name.includes('.corrupt-'))).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it('rejects invalid kinds', () => {
    const store = new StudioStore({ dataDir: tempDir() });
    expect(() => store.create({ kind: 'bogus' as never })).toThrow(/Unknown Studio item kind/);
  });
});

describe('sanitizeDocumentHtml', () => {
  it('keeps the editor vocabulary', () => {
    const html = '<h2 style="text-align: center">Hi</h2><ul><li><strong>one</strong></li></ul><a href="https://example.com">link</a>';
    expect(sanitizeDocumentHtml(html)).toBe(html);
  });

  it('removes dangerous elements, attributes, and styles', () => {
    const html = [
      '<style>body{display:none}</style>',
      '<iframe src="https://evil.test"></iframe>',
      '<p style="background:url(javascript:alert(1))">x</p>',
      '<img src="javascript:alert(1)" onerror="alert(1)">',
      '<a href="data:text/html,<script>alert(1)</script>">bad</a>',
    ].join('');
    const clean = sanitizeDocumentHtml(html);
    expect(clean).not.toMatch(/style|iframe|onerror|javascript:|data:text/i);
    expect(clean).toContain('x');
    expect(clean).toContain('bad');
  });

  it('keeps safe image data and https images', () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgo=';
    expect(sanitizeDocumentHtml(`<img src="${pixel}" alt="dot">`)).toContain(pixel);
    expect(sanitizeDocumentHtml('<img src="https://example.com/a.png">')).toContain('https://example.com/a.png');
  });

  it('caps oversized documents', () => {
    expect(sanitizeDocumentHtml('a'.repeat(100), 10)).toHaveLength(10);
  });
});

describe('htmlToDocumentBlocks', () => {
  it('preserves headings, bullets, and inline formatting', () => {
    const blocks = htmlToDocumentBlocks('<h1>Title</h1><p>Hello <strong>bold</strong> and <em>italic</em></p><ul><li>One</li></ul>');
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks[0].runs.map((run) => run.text).join('')).toBe('Title');
    expect(blocks[1].runs).toEqual([
      { text: 'Hello ', bold: undefined, italic: undefined, underline: undefined },
      { text: 'bold', bold: true, italic: undefined, underline: undefined },
      { text: ' and ', bold: undefined, italic: undefined, underline: undefined },
      { text: 'italic', bold: undefined, italic: true, underline: undefined },
    ]);
    expect(blocks[2]).toMatchObject({ kind: 'bullet' });
  });

  it('decodes entities', () => {
    const blocks = htmlToDocumentBlocks('<p>Tom &amp; Jerry &lt;3</p>');
    expect(blocks[0].runs[0].text).toBe('Tom & Jerry <3');
  });
});
