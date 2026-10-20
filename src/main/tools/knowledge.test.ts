import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from './base.js';

// better-sqlite3 is a native module built for Electron. Under plain Node the
// ABI can mismatch; skip the DB-backed suite in that case instead of failing.
let canUseNative = true;
try {
  new Database(':memory:').close();
} catch {
  canUseNative = false;
}

const maybeDescribe = canUseNative ? describe : describe.skip;
let dir: string;
let testCtx: ToolContext;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'infinite-knowledge-'));
  process.env.INFINITE_TEST_HOME = dir;
  testCtx = {
    sessionId: 'test-session',
    cwd: dir,
    abortSignal: new AbortController().signal,
    onUpdate: () => {},
  } as unknown as ToolContext;
});

afterAll(async () => {
  if (canUseNative) {
    const store = await import('../memory/store.js');
    store.closeDatabase();
  }
  delete process.env.INFINITE_TEST_HOME;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  if (!canUseNative) return;
  const store = await import('../memory/store.js');
  store.closeDatabase();
  for (const name of ['memory.db', 'memory.db-wal', 'memory.db-shm']) {
    rmSync(join(dir, name), { force: true });
  }
  vi.resetModules();
});

maybeDescribe('Knowledge tool', () => {
  it('should remember a new memory in a dataset', async () => {
    const { knowledgeTool: freshKnowledgeTool } = await import('./knowledge.js');

    const result = await freshKnowledgeTool.execute({
      action: 'remember',
      title: 'Test Memory',
      content: 'This is a test memory.',
      tags: ['test'],
      dataset: 'project-x',
    }, testCtx);

    expect(result.is_error).toBeFalsy();
    const parsed = JSON.parse(result.content as string);
    expect(parsed).toHaveProperty('id');
    expect(parsed.title).toBe('Test Memory');
    expect(parsed.content).toBe('This is a test memory.');
    expect(parsed.tags).toEqual(['test']);
    expect(parsed.dataset).toBe('project-x');
    expect(parsed).toHaveProperty('tier');
    expect(parsed).toHaveProperty('importance');
    expect(parsed).toHaveProperty('accessCount');
    expect(parsed).toHaveProperty('lastAccessed');
  });

  it('extracts a graph when remember is called with graph=true', async () => {
    const { knowledgeTool: freshKnowledgeTool } = await import('./knowledge.js');
    const result = await freshKnowledgeTool.execute({
      action: 'remember',
      graph: true,
      dataset: 'project-x',
      title: 'Release pipeline',
      content: 'Deploy [[Infinite OS]] to @Acer using #docker.',
      tags: ['release'],
    }, testCtx);

    expect(result.is_error).toBeFalsy();
    const parsed = JSON.parse(result.content as string);
    expect(parsed.memory.dataset).toBe('project-x');
    expect(parsed.graph.node.name).toBe('Release pipeline');
    expect(parsed.graph.entities.some((node: { name: string }) => node.name === 'Infinite OS')).toBe(true);
    expect(parsed.graph.edges).toBeGreaterThan(0);
  });

  it('links, recalls, reports stats, and forgets graph nodes', async () => {
    const { knowledgeTool: freshKnowledgeTool } = await import('./knowledge.js');
    const first = JSON.parse((await freshKnowledgeTool.execute({
      action: 'graph_remember',
      dataset: 'project-x',
      title: 'Alpha service',
      content: 'Owned by the platform team.',
      tags: ['platform'],
    }, testCtx)).content as string);
    const second = JSON.parse((await freshKnowledgeTool.execute({
      action: 'graph_remember',
      dataset: 'project-x',
      title: 'Beta service',
      content: 'Depends on Alpha.',
      tags: ['platform'],
    }, testCtx)).content as string);

    await freshKnowledgeTool.execute({ action: 'remember', dataset: 'project-x', title: 'Memory one', content: 'A durable note.' }, testCtx);

    const linked = await freshKnowledgeTool.execute({
      action: 'graph_link',
      dataset: 'project-x',
      nodeId: second.node.id,
      targetId: first.node.id,
      relation: 'depends_on',
    }, testCtx);
    expect(linked.is_error).toBeFalsy();
    expect(JSON.parse(linked.content as string).relation).toBe('depends_on');

    const recalled = JSON.parse((await freshKnowledgeTool.execute({
      action: 'graph_recall',
      dataset: 'project-x',
      query: 'Beta service',
      depth: 1,
    }, testCtx)).content as string);
    expect(recalled.nodes.some((node: { name: string }) => node.name === 'Alpha service')).toBe(true);
    expect(recalled.edges.some((edge: { relation: string }) => edge.relation === 'depends_on')).toBe(true);

    const stats = JSON.parse((await freshKnowledgeTool.execute({ action: 'stats', dataset: 'project-x' }, testCtx)).content as string);
    expect(stats.memory.total).toBeGreaterThan(0);
    expect(stats.graph.nodes).toBeGreaterThan(0);

    const datasets = JSON.parse((await freshKnowledgeTool.execute({ action: 'datasets' }, testCtx)).content as string);
    expect(datasets.some((dataset: { name: string }) => dataset.name === 'project-x')).toBe(true);

    const forgotten = JSON.parse((await freshKnowledgeTool.execute({
      action: 'graph_forget',
      dataset: 'project-x',
      nodeId: first.node.id,
    }, testCtx)).content as string);
    expect(forgotten.nodes).toBe(1);
  });
});
