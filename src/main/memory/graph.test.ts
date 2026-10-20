import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase } from './store.js';
import {
  forgetGraph,
  graphStats,
  improveGraph,
  listDatasets,
  normalizeName,
  recallGraph,
  rememberGraph,
} from './graph.js';

let dir: string;

// The packaged build rebuilds better-sqlite3 for Electron's ABI. Under plain
// Node that binary cannot load, so skip the DB-backed suite rather than fail.
let canUseNative = true;
try {
  new Database(':memory:').close();
} catch {
  canUseNative = false;
}
const maybeDescribe = canUseNative ? describe : describe.skip;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'infinite-graph-'));
  process.env.INFINITE_TEST_HOME = dir;
});

afterAll(() => {
  closeDatabase();
  delete process.env.INFINITE_TEST_HOME;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  closeDatabase();
  for (const name of ['memory.db', 'memory.db-wal', 'memory.db-shm']) {
    rmSync(join(dir, name), { force: true });
  }
});

maybeDescribe('graph memory', () => {
  it('extracts entities and connects them to the primary fact', () => {
    const result = rememberGraph({
      title: 'Release Pipeline',
      content: 'Deploy the [[Infinite OS]] app to @Acer using #docker. The Release Pipeline depends on Docker.',
      tags: ['release', 'docker'],
    });

    expect(result.node.name).toBe('Release Pipeline');
    expect(result.entities.some((n) => n.name === 'Infinite OS')).toBe(true);
    expect(result.entities.some((n) => n.name === 'Acer')).toBe(true);
    expect(result.entities.some((n) => n.name === 'docker')).toBe(true);
    expect(result.edges).toBeGreaterThan(0);

    const recalled = recallGraph('Release Pipeline', { depth: 1, limit: 20 });
    expect(recalled.nodes.some((n) => n.name === 'Release Pipeline')).toBe(true);
    expect(recalled.edges.length).toBeGreaterThan(0);
  });

  it('deduplicates a repeated fact and strengthens its edges', () => {
    rememberGraph({ title: 'Deploy target', content: 'Push to #production.', tags: ['deploy'] });
    const before = graphStats();
    rememberGraph({ title: 'Deploy target', content: 'Push to #production.', tags: ['deploy'] });
    const after = graphStats();

    expect(after.nodes).toBe(before.nodes);
    const recalled = recallGraph('Deploy target', { depth: 1, limit: 20 });
    const tagNode = recalled.nodes.find((n) => n.name === 'production');
    expect(tagNode).toBeDefined();
    const edge = recalled.edges.find((e) => e.targetId === tagNode?.id || e.sourceId === tagNode?.id);
    expect(edge?.weight).toBeGreaterThan(1);
  });

  it('keeps datasets isolated', () => {
    rememberGraph({ dataset: 'alpha', title: 'Shared fact', content: 'Alpha only #one' });
    rememberGraph({ dataset: 'beta', title: 'Shared fact', content: 'Beta only #two' });

    const alpha = recallGraph('Shared fact', { dataset: 'alpha', depth: 1, limit: 20 });
    expect(alpha.nodes.length).toBeGreaterThan(0);
    expect(alpha.nodes.every((n) => n.dataset === 'alpha')).toBe(true);
    expect(alpha.nodes.some((n) => n.name === 'two')).toBe(false);

    const stats = graphStats('alpha');
    expect(stats.nodes).toBeGreaterThan(0);
    expect(graphStats('beta').nodes).toBeGreaterThan(0);
  });

  it('improves the graph by linking nodes that share tags', () => {
    rememberGraph({ title: 'Alpha service', content: 'Owned by the platform team.', tags: ['platform', 'backend'] });
    rememberGraph({ title: 'Beta service', content: 'Owned by the platform team.', tags: ['platform', 'backend'] });

    const result = improveGraph();
    expect(result.linked).toBeGreaterThan(0);
    expect(graphStats().byRelation.related_to).toBeGreaterThan(0);
  });

  it('forgets a node and every edge that touches it', () => {
    rememberGraph({ title: 'Temporary note', content: 'Mentions #ephemeral and @Nobody.' });
    const before = graphStats();
    const deleted = forgetGraph({ query: 'Temporary note' });
    const after = graphStats();

    expect(deleted.nodes).toBe(1);
    expect(deleted.edges).toBeGreaterThan(0);
    expect(after.nodes).toBe(before.nodes - 1);
  });

  it('lists memory and graph datasets with counts', () => {
    rememberGraph({ dataset: 'project-x', title: 'Fact one', content: 'A #tag' });
    const datasets = listDatasets();
    const project = datasets.find((d) => d.name === 'project-x');
    expect(project).toBeDefined();
    expect(project?.nodes).toBeGreaterThan(0);
    expect(datasets.some((d) => d.name === 'default')).toBe(true);
  });

  it('normalizes names for stable deduplication', () => {
    expect(normalizeName('  #Infinite   OS! ')).toBe('infinite os');
    expect(normalizeName('Release-Pipeline')).toBe('release-pipeline');
  });
});
