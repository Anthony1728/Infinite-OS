import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PageDatabase, PageUpdateInput } from '../../shared/pages.js';
import { databaseToCsv, pageToMarkdown } from './export.js';
import { PagesStore } from './store.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'infinite-pages-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function makeStore(options: { dataDir?: string; now?: () => number; id?: () => string } = {}): PagesStore {
  let next = 0;
  return new PagesStore({
    dataDir: options.dataDir ?? tempDir(),
    now: options.now ?? (() => 1_000),
    id: options.id ?? (() => `id-${++next}`),
  });
}

describe('PagesStore', () => {
  it('creates a page and a database with usable defaults', () => {
    const store = makeStore();
    const page = store.create({ title: 'Roadmap' });
    expect(page.title).toBe('Roadmap');
    expect(page.kind).toBe('page');
    expect(page.blocks).toHaveLength(1);
    expect(page.blocks[0]?.type).toBe('paragraph');
    expect(page.comments).toEqual([]);

    const database = store.create({ kind: 'database', title: 'CRM' });
    expect(database.kind).toBe('database');
    expect(database.database?.properties[0]?.type).toBe('title');
    expect(database.database?.views.map((view) => view.type)).toEqual(['table', 'board', 'calendar']);
    expect(store.list()).toHaveLength(2);
    expect(store.stats()).toMatchObject({ pages: 2, databases: 1 });
  });

  it('keeps metadata in the index and bodies in separate files', () => {
    const dir = tempDir();
    const store = makeStore({ dataDir: dir });
    const page = store.create({ title: 'Private notes' });
    store.update(page.id, { blocks: [{ id: 'b', type: 'paragraph', html: '<p>Only in the body</p>', depth: 0 }] });

    const index = readFileSync(join(dir, 'index.json'), 'utf8');
    expect(index).toContain('Private notes');
    // The index intentionally caches flattened search text, but it must not
    // carry the block tree itself. Bodies stay in data/<id>.json.
    expect(index).not.toContain('"blocks"');
    expect(existsSync(join(dir, 'data', `${page.id}.json`))).toBe(true);
    expect(store.list()[0]).not.toHaveProperty('blocks');
  });

  it('sanitises blocks, urls, code, and tables on write and reload', () => {
    const dir = tempDir();
    const store = makeStore({ dataDir: dir });
    const page = store.create();
    const blocks: PageUpdateInput['blocks'] = [
      {
        id: 'paragraph',
        type: 'paragraph',
        depth: 99,
        html: '<p onclick="steal()">Safe<script>alert(1)</script><a href="javascript:alert(2)">link</a></p>',
      },
      { id: 'code', type: 'code', html: '<b>hello</b>', depth: -3, language: 'ts' },
      { id: 'image', type: 'image', html: '', depth: 0, url: 'javascript:alert(3)', caption: 'bad' },
      {
        id: 'table',
        type: 'table',
        html: '',
        depth: 0,
        table: {
          headers: ['A', 'B'],
          rows: [['1', '2'], ['3']],
        },
      },
    ];
    store.update(page.id, { blocks });

    const reloaded = new PagesStore({ dataDir: dir });
    const saved = reloaded.get(page.id)!;
    const paragraph = saved.blocks.find((block) => block.id === 'paragraph')!;
    expect(paragraph.depth).toBe(4);
    expect(paragraph.html).toContain('Safe');
    expect(paragraph.html).not.toContain('<script');
    expect(paragraph.html).not.toContain('onclick');
    expect(paragraph.html).not.toContain('javascript:');
    expect(saved.blocks.find((block) => block.id === 'code')?.html).not.toContain('<b>');
    expect(saved.blocks.find((block) => block.id === 'image')?.url).toBeUndefined();
    expect(saved.blocks.find((block) => block.id === 'table')?.table?.headers).toEqual(['A', 'B']);
    expect(saved.blocks.find((block) => block.id === 'table')?.table?.rows).toEqual([['1', '2'], ['3', '']]);
  });

  it('searches titles and body text, and resolves wiki backlinks', () => {
    const store = makeStore();
    const target = store.create({ title: 'GTM Plan' });
    const source = store.create({ title: 'Roadmap' });
    store.update(source.id, {
      blocks: [{ id: 'b', type: 'paragraph', html: '<p>Launch work depends on [[GTM Plan]].</p>', depth: 0 }],
    });
    store.create({ title: 'Unrelated' });

    expect(store.search('gtm').map((hit) => hit.id)).toContain(target.id);
    expect(store.search('launch work').map((hit) => hit.id)).toContain(source.id);
    expect(store.search('roadmap')[0]?.id).toBe(source.id);
    expect(store.backlinksTo(target.id).map((page) => page.id)).toEqual([source.id]);
    expect(store.search('   ').every((hit) => !hit.trashed)).toBe(true);
  });

  it('creates nested pages from templates', () => {
    const store = makeStore();
    const root = store.create({ title: 'Team' });
    const project = store.createFromTemplate('project', root.id);
    expect(project.parentId).toBe(root.id);
    expect(project.blocks.some((block) => block.type === 'child_database')).toBe(true);
    expect(store.list().some((page) => page.parentId === project.id)).toBe(true);

    const meeting = store.create({ templateId: 'meeting', parentId: root.id });
    expect(meeting.title.toLowerCase()).toContain('meeting');
  });

  it('validates, updates, and syncs database rows with their pages', () => {
    const store = makeStore();
    const database = store.create({ kind: 'database', title: 'Pipeline' });
    const titleProperty = database.database!.properties.find((property) => property.type === 'title')!;

    const withRow = store.createDatabaseRow(database.id, {
      values: {
        [titleProperty.id]: 'Acme',
        status: 'status-doing',
        assignee: 'Ada',
        date: '2026-10-30',
      },
    });
    const row = withRow.rows[0]!;
    expect(row.values[titleProperty.id]).toBe('Acme');
    expect(row.values.status).toBe('status-doing');
    expect(row.values.date).toBe('2026-10-30');

    const rowPage = store.openRowPage(database.id, row.id);
    expect(rowPage.parentId).toBe(database.id);
    expect(rowPage.rowDatabaseId).toBe(database.id);
    expect(rowPage.rowId).toBe(row.id);
    expect(rowPage.title).toBe('Acme');

    store.update(rowPage.id, { title: 'Acme Corp' });
    expect(store.get(database.id)?.database?.rows[0]?.values[titleProperty.id]).toBe('Acme Corp');
    expect(store.getSummary(database.id)?.title).toBe('Pipeline');

    store.updateDatabaseRow(database.id, row.id, { values: { [titleProperty.id]: 'Acme Global' } });
    expect(store.get(rowPage.id)?.title).toBe('Acme Global');

    const duplicate = store.duplicateDatabaseRow(database.id, row.id);
    expect(duplicate.rows).toHaveLength(2);
    expect(duplicate.rows[1]?.values[titleProperty.id]).toBe('Acme Global copy');
    expect(duplicate.rows[1]?.pageId).toBeUndefined();

    store.deleteDatabaseRow(database.id, row.id);
    expect(store.get(database.id)?.database?.rows).toHaveLength(1);
    expect(store.get(rowPage.id)?.trashedAt).not.toBeNull();
  });

  it('rejects invalid database values and duplicate row ids', () => {
    const store = makeStore();
    const database = store.create({ kind: 'database' });
    const titleProperty = database.database!.properties.find((property) => property.type === 'title')!;
    const rows = store.createDatabaseRow(database.id, {
      values: { [titleProperty.id]: '', status: 'missing-option', date: 'not-a-date' },
    });
    const row = rows.rows[0]!;
    expect(row.values[titleProperty.id]).toBe('Untitled');
    expect(row.values.status).toBeNull();
    expect(row.values.date).toBeNull();
  });

  it('adds, resolves, and deletes comments', () => {
    const store = makeStore();
    const page = store.create({ title: 'Review' });
    const withComment = store.addComment(page.id, '  Please tighten this section.  ', page.blocks[0]?.id);
    const comment = withComment.comments[0]!;
    expect(comment.text).toBe('Please tighten this section.');
    expect(comment.blockId).toBe(page.blocks[0]?.id);

    const resolved = store.resolveComment(page.id, comment.id, true);
    expect(resolved.comments[0]?.resolved).toBe(true);
    const removed = store.deleteComment(page.id, comment.id);
    expect(removed.comments).toEqual([]);
    expect(() => store.addComment(page.id, '   ')).toThrow(/comment/i);
  });

  it('saves and restores versions, including a manual snapshot', () => {
    const store = makeStore({ now: (() => { let t = 0; return () => ++t; })() });
    const page = store.create({ title: 'Draft' });
    const first = store.update(page.id, {
      blocks: [{ id: 'b1', type: 'paragraph', html: '<p>First draft</p>', depth: 0 }],
    });
    const saved = store.saveVersion(first.id);
    const manual = [...saved.versions].reverse().find((version) => version.reason === 'manual')!;
    expect(manual.title).toBe('Draft');
    expect(manual.blocks[0]?.html).toContain('First draft');

    store.update(page.id, {
      title: 'Final',
      blocks: [{ id: 'b1', type: 'paragraph', html: '<p>Final draft</p>', depth: 0 }],
    });
    const restored = store.restoreVersion(page.id, manual.id);
    expect(restored.title).toBe('Draft');
    expect(restored.blocks[0]?.html).toContain('First draft');
    expect(restored.versions.some((version) => version.title === 'Final')).toBe(true);
  });

  it('restores row titles and linked pages when a database version is restored', () => {
    let tick = 0;
    const store = makeStore({ now: () => ++tick });
    const database = store.create({ kind: 'database', title: 'Roadmap' });
    const titleProperty = database.database!.properties.find((property) => property.type === 'title')!;
    const withRow = store.createDatabaseRow(database.id, {
      values: { [titleProperty.id]: 'Original name' },
    });
    const row = withRow.rows[0]!;
    const rowPage = store.openRowPage(database.id, row.id);
    const saved = store.saveVersion(database.id);
    const snapshot = [...saved.versions].reverse().find((version) => version.reason === 'manual')!;

    const renamed = store.updateDatabaseRow(database.id, row.id, {
      values: { [titleProperty.id]: 'Renamed in table' },
    });
    expect(renamed.rows[0]?.values[titleProperty.id]).toBe('Renamed in table');
    expect(store.get(rowPage.id)?.title).toBe('Renamed in table');

    const restored = store.restoreVersion(database.id, snapshot.id);
    expect(restored.database?.rows[0]?.values[titleProperty.id]).toBe('Original name');
    expect(store.get(rowPage.id)?.title).toBe('Original name');
  });

  it('trashes and restores subtrees, then deletes them permanently', () => {
    const store = makeStore();
    const root = store.create({ title: 'Root' });
    const child = store.create({ title: 'Child', parentId: root.id });
    const grandchild = store.create({ title: 'Grandchild', parentId: child.id });

    store.trash(root.id);
    expect(store.getSummary(root.id)?.trashedAt).not.toBeNull();
    expect(store.getSummary(child.id)?.trashedAt).not.toBeNull();
    expect(store.getSummary(grandchild.id)?.trashedAt).not.toBeNull();

    store.deletePermanent(root.id);
    expect(store.get(root.id)).toBeNull();
    expect(store.get(child.id)).toBeNull();
    expect(store.get(grandchild.id)).toBeNull();
  });

  it('restores a trashed child as a root when its parent is still trashed', () => {
    const store = makeStore();
    const root = store.create({ title: 'Root' });
    const child = store.create({ title: 'Child', parentId: root.id });
    store.trash(root.id);
    const restored = store.restore(child.id);
    expect(restored.title).toBe('Child');
    expect(restored.parentId).toBeNull();
    expect(store.getSummary(child.id)?.trashedAt).toBeNull();
  });

  it('restores a trashed child under a live parent', () => {
    const store = makeStore();
    const root = store.create({ title: 'Root' });
    const child = store.create({ title: 'Child', parentId: root.id });
    store.trash(child.id);
    store.restore(child.id);
    expect(store.getSummary(child.id)?.parentId).toBe(root.id);
  });

  it('empties the trash without touching live pages', () => {
    const store = makeStore();
    const live = store.create({ title: 'Live' });
    const dead = store.create({ title: 'Dead' });
    store.trash(dead.id);
    store.emptyTrash();
    expect(store.get(live.id)).not.toBeNull();
    expect(store.get(dead.id)).toBeNull();
    expect(store.list().filter((page) => page.trashedAt !== null)).toEqual([]);
  });

  it('persists across reloads and preserves a corrupt file', () => {
    const dir = tempDir();
    const store = makeStore({ dataDir: dir });
    const page = store.create({ title: 'Durable' });
    store.update(page.id, { blocks: [{ id: 'b', type: 'paragraph', html: '<p>Saved</p>', depth: 0 }] });

    const reloaded = new PagesStore({ dataDir: dir });
    expect(reloaded.get(page.id)?.blocks[0]?.html).toBe('<p>Saved</p>');

    writeFileSync(join(dir, 'index.json'), '{broken json', 'utf8');
    const recovered = new PagesStore({ dataDir: dir });
    expect(recovered.list()).toEqual([]);
    expect(readdirSync(dir).some((name) => name.includes('.corrupt-'))).toBe(true);
  });

  it('duplicates a page together with its child pages', () => {
    const store = makeStore();
    const root = store.create({ title: 'Playbook' });
    const child = store.create({ title: 'Step one', parentId: root.id });
    store.update(child.id, { blocks: [{ id: 'b', type: 'paragraph', html: '<p>Do it</p>', depth: 0 }] });

    const copy = store.duplicate(root.id)!;
    expect(copy.title).toBe('Playbook copy');
    expect(copy.blocks).not.toBe(root.blocks);
    const copiedChild = store.list().find((page) => page.parentId === copy.id);
    expect(copiedChild?.title).toBe('Step one');
    expect(store.get(copiedChild!.id)?.blocks[0]?.html).toBe('<p>Do it</p>');
  });

  it('exports pages to Markdown and databases to CSV', () => {
    const store = makeStore();
    const child = store.create({ title: 'Linked page' });
    const page = store.create({ title: 'Launch plan' });
    store.update(page.id, {
      blocks: [
        { id: 'h', type: 'heading2', html: '<h2>Goals</h2>', depth: 0 },
        { id: 'p', type: 'paragraph', html: '<p><strong>Ship</strong> the release.</p>', depth: 0 },
        { id: 't', type: 'todo', html: '<p>Write notes</p>', depth: 0, checked: true },
        { id: 'c', type: 'child_page', html: '', depth: 0, pageId: child.id },
      ],
    });
    const pageRecord = store.get(page.id)!;
    const markdown = pageToMarkdown(pageRecord, { get: (id) => store.get(id) });
    expect(markdown).toContain('# 📄 Launch plan');
    expect(markdown).toContain('## Goals');
    expect(markdown).toContain('**Ship** the release.');
    expect(markdown).toContain('- [x] Write notes');
    expect(markdown).toContain('[Linked page](#page-');

    const database = store.create({ kind: 'database', title: 'People' });
    const titleProperty = database.database!.properties.find((property) => property.type === 'title')!;
    const withRow = store.createDatabaseRow(database.id, {
      values: { [titleProperty.id]: 'Ada, Inc.', status: 'status-done', assignee: 'Ada' },
    });
    const csv = databaseToCsv(store.get(database.id)!);
    expect(csv).toContain('Name,Status,Owner,Date');
    expect(csv).toContain('"Ada, Inc.",Done,Ada,');
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(withRow.rows).toHaveLength(1);
  });

  it('coerces invalid create input and respects page limits', () => {
    const store = makeStore();
    expect(store.create({ title: '   ' }).title).toBe('Untitled');
    expect(store.create({ kind: 'bogus' as never }).kind).toBe('page');
    expect(() => store.update('missing', { title: 'x' })).toThrow(/no longer exists/i);
    expect(store.get('missing')).toBeNull();
    expect(store.getSummary('missing')).toBeNull();
    expect(() => store.deletePermanent('missing')).toThrow(/no longer exists/i);

    const db = store.create({ kind: 'database' });
    const huge: PageDatabase = {
      ...db.database!,
      rows: Array.from({ length: 2_001 }, (_, index) => ({
        id: `row-${index}`,
        values: {},
        order: index,
        createdAt: 1,
        updatedAt: 1,
      })),
    };
    const saved = store.update(db.id, { database: huge });
    expect(saved.database?.rows).toHaveLength(2_000);
  });
});
