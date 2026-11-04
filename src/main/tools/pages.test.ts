import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PagesStore, setPagesStoreForTests } from '../pages/store.js';
import { contentToBlocks, pagesTool } from './pages.js';

const dirs: string[] = [];
function installStore(): PagesStore {
  const dir = mkdtempSync(join(tmpdir(), 'infinite-pages-tool-'));
  dirs.push(dir);
  let next = 0;
  const store = new PagesStore({ dataDir: dir, now: () => 1_000, id: () => `tool-${++next}` });
  setPagesStoreForTests(store);
  return store;
}

afterEach(() => {
  setPagesStoreForTests(null);
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function run(args: Record<string, unknown>): Promise<{ content: string; is_error?: boolean }> {
  const result = await pagesTool.execute(args, {
    cwd: process.cwd(),
    abortSignal: new AbortController().signal,
    sessionId: 'test',
    onUpdate: () => {},
  });
  return { content: String(result.content), is_error: result.is_error };
}

describe('Pages agent tool', () => {
  it('converts Markdown into usable blocks', () => {
    const blocks = contentToBlocks(`# Ignored title\n\nIntro with **bold** and \`code\`.\n\n## Plan\n\n- one\n- two\n\n- [x] done\n\n> quote\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n| A | B |\n| --- | --- |\n| 1 | 2 |`);
    expect(blocks.map((block) => block.type)).toEqual([
      'heading1', 'paragraph', 'heading1', 'bulleted', 'bulleted', 'todo', 'quote', 'code', 'table',
    ]);
    expect(blocks[1]?.html).toContain('<strong>bold</strong>');
    expect(blocks[1]?.html).toContain('<code>code</code>');
    expect(blocks.find((block) => block.type === 'todo')?.checked).toBe(true);
    expect(blocks.find((block) => block.type === 'code')?.language).toBe('ts');
    expect(blocks.find((block) => block.type === 'table')?.table?.rows).toEqual([['1', '2']]);
  });

  it('creates, searches, reads, updates, and appends pages', async () => {
    installStore();
    const created = await run({
      action: 'create',
      title: 'Launch plan',
      content: '# Goals\n\nShip the release.\n\n- [ ] Write notes',
    });
    expect(created.is_error).toBeFalsy();
    const page = JSON.parse(created.content).page;
    expect(page.title).toBe('Launch plan');
    expect(page.blocks.some((block: { type: string }) => block.type === 'todo')).toBe(true);

    const search = await run({ action: 'search', query: 'ship' });
    expect(JSON.parse(search.content).hits[0]?.title).toBe('Launch plan');

    const fetched = await run({ action: 'get', id: page.id });
    expect(JSON.parse(fetched.content).page.kind).toBe('page');

    const updated = await run({ action: 'update', id: page.id, title: 'Launch plan v2', favorite: true });
    expect(JSON.parse(updated.content).page.title).toBe('Launch plan v2');
    expect(JSON.parse(updated.content).page.favorite).toBe(true);

    const appended = await run({ action: 'append', id: page.id, content: 'A later note.' });
    const parsed = JSON.parse(appended.content).page;
    expect(parsed.blocks[parsed.blocks.length - 1].html).toContain('A later note.');
  });

  it('creates and manages database rows through their pages', async () => {
    const store = installStore();
    const created = await run({ action: 'create', kind: 'database', title: 'CRM' });
    const database = JSON.parse(created.content).page;
    const titleProperty = database.database.properties.find((property: { type: string }) => property.type === 'title');

    const rows = await run({
      action: 'row_create',
      id: database.id,
      values: { [titleProperty.id]: 'Acme', status: 'status-doing' },
    });
    const row = JSON.parse(rows.content).rows[0];
    expect(row.values[titleProperty.id]).toBe('Acme');

    const updated = await run({
      action: 'row_update',
      id: database.id,
      rowId: row.id,
      values: { [titleProperty.id]: 'Acme Global' },
    });
    expect(JSON.parse(updated.content).rows[0].values[titleProperty.id]).toBe('Acme Global');

    const opened = await run({ action: 'open_row', id: database.id, rowId: row.id });
    const rowPage = JSON.parse(opened.content).page;
    expect(rowPage.title).toBe('Acme Global');
    expect(rowPage.rowDatabaseId).toBe(database.id);
    expect(store.get(database.id)?.database?.rows[0]?.pageId).toBe(rowPage.id);

    const deleted = await run({ action: 'row_delete', id: database.id, rowId: row.id });
    expect(JSON.parse(deleted.content).rows).toEqual([]);
    expect(store.get(rowPage.id)?.trashedAt).not.toBeNull();
  });

  it('trashes and restores, saves comments, and handles versions', async () => {
    const store = installStore();
    const created = await run({ action: 'create', title: 'Notes', content: 'First version.' });
    const page = JSON.parse(created.content).page;

    const commented = await run({ action: 'comment_add', id: page.id, text: 'Review this.' });
    expect(JSON.parse(commented.content).page.comments).toHaveLength(1);

    const saved = await run({ action: 'version_save', id: page.id });
    const version = JSON.parse(saved.content).page.versions.at(-1);
    expect(version.reason).toBe('manual');

    const trashed = await run({ action: 'trash', id: page.id });
    expect(JSON.parse(trashed.content).trashed).toBe(1);
    expect(store.get(page.id)?.trashedAt).not.toBeNull();

    const restored = await run({ action: 'restore', id: page.id });
    expect(JSON.parse(restored.content).page.trashedAt).toBeNull();

    const reverted = await run({ action: 'version_restore', id: page.id, versionId: version.id });
    expect(JSON.parse(reverted.content).page.title).toBe('Notes');
  });

  it('returns actionable errors without throwing', async () => {
    installStore();
    expect((await run({ action: 'get', id: 'missing' })).is_error).toBe(true);
    expect((await run({ action: 'search', query: '   ' })).is_error).toBe(true);
    expect((await run({ action: 'update', id: 'missing' })).is_error).toBe(true);
    expect((await run({ action: 'create', title: 'x' })).is_error).toBeFalsy();
    const created = await run({ action: 'list' });
    const id = JSON.parse(created.content).pages[0].id;
    expect((await run({ action: 'update', id })).is_error).toBe(true);
    expect((await run({ action: 'comment_add', id, text: '  ' })).is_error).toBe(true);
    expect((await run({ action: 'row_update', id })).is_error).toBe(true);
    expect((await run({ action: 'bogus' })).is_error).toBe(true);
  });

  it('lists pages with stats and no full body payload', async () => {
    installStore();
    await run({ action: 'create', title: 'One', content: 'hidden body' });
    const listed = await run({ action: 'list' });
    const parsed = JSON.parse(listed.content);
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]).not.toHaveProperty('blocks');
    expect(parsed.stats.pages).toBe(1);
  });
});
