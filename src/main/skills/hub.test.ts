import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkillIndex,
  fetchSkillFile,
  searchSkills,
  parseTree,
  applyManifest,
  scoreSkill,
  type SkillHubIndex,
} from './hub.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'skill-hub-'));
}

const fakeFetch = (body: string, ok = true) =>
  (async () => new Response(body, { status: ok ? 200 : 500 })) as unknown as typeof fetch;

/**
 * Shapes taken from the live repository, because the catalogue is upstream data
 * and its shape is not something this code controls.
 *
 * The tree fixture includes a `.gemini/` path on purpose: the repository ships
 * 458 per-agent copies of skills alongside the 388 real ones, and counting them
 * would report the library as more than twice its size.
 */
const TREE = JSON.stringify({
  tree: [
    { path: 'engineering/skills/code-reviewer/SKILL.md', type: 'blob' },
    { path: 'engineering/skills/test-writer/SKILL.md', type: 'blob' },
    { path: 'engineering/agent-harness/skills/agent-harness/SKILL.md', type: 'blob' },
    { path: 'finance/skills/financial-analyst/SKILL.md', type: 'blob' },
    { path: 'productivity/skills/capture/SKILL.md', type: 'blob' },
    { path: '.gemini/skills/code-reviewer/SKILL.md', type: 'blob' },
    { path: 'README.md', type: 'blob' },
  ],
});

const MANIFEST = JSON.stringify({
  name: 'claude-code-skills',
  plugins: {
    'engineering-skills': {
      name: 'engineering-skills',
      source: './engineering',
      description: 'Code review, testing, refactoring and delivery skills',
      keywords: ['review', 'test', 'refactor', 'quality'],
      category: 'engineering',
    },
    'agent-harness': {
      name: 'agent-harness',
      source: './engineering/agent-harness',
      description: 'Run and supervise autonomous agents',
      keywords: ['agent', 'autonomy', 'orchestration'],
    },
    'finance-skills': {
      name: 'finance-skills',
      source: './finance',
      description: 'Financial analysis, forecasting and reporting',
      keywords: ['revenue', 'forecast', 'report', 'churn'],
    },
    'productivity-skills': {
      name: 'productivity-skills',
      source: './productivity',
      description: 'Capture, review and organise work',
      keywords: ['notes', 'capture', 'organisation'],
    },
  },
});

describe('reading the library', () => {
  it('finds only the canonical skills', () => {
    const entries = parseTree(TREE);
    expect(entries).toHaveLength(5);
    // The per-agent copy must not appear, or the same skill is offered twice.
    expect(entries.map(e => e.name)).not.toContain('README');
    expect(entries.filter(e => e.path.includes('.gemini'))).toHaveLength(0);
  });

  it('takes the name from the directory, not the filename', () => {
    // Every file is called SKILL.md, so the parent directory is the only thing
    // that identifies the skill.
    const entries = parseTree(TREE);
    expect(entries.find(e => e.category === 'productivity')?.name).toBe('capture');
  });

  it('attaches the bundle description to each skill', () => {
    const merged = applyManifest(parseTree(TREE), MANIFEST);
    const reviewer = merged.find(e => e.name === 'code-reviewer');
    expect(reviewer?.description).toBe('Code review, testing, refactoring and delivery skills');
    expect(reviewer?.keywords).toContain('review');
  });

  it('prefers the most specific bundle when bundles nest', () => {
    // `engineering/agent-harness` sits inside `engineering`. Matching the short
    // one would describe an agent harness as code review.
    const merged = applyManifest(parseTree(TREE), MANIFEST);
    const harness = merged.find(e => e.name === 'agent-harness');
    expect(harness?.description).toBe('Run and supervise autonomous agents');
  });

  it('still produces a usable catalogue when the manifest is broken', () => {
    // A manifest change must not make 388 skills unfindable.
    const merged = applyManifest(parseTree(TREE), '{ not json');
    expect(merged).toHaveLength(5);
    expect(merged.every(e => e.category.length > 0)).toBe(true);
  });

  it('rejects a malformed tree rather than returning nothing quietly', () => {
    expect(() => parseTree('{ not json')).toThrow();
  });
});

describe('finding the right skill', () => {
  const index: SkillHubIndex = {
    fetchedAt: 0,
    entries: applyManifest(parseTree(TREE), MANIFEST),
  };

  it('finds by name', () => {
    expect(searchSkills(index, 'capture').map(s => s.name)).toEqual(['capture']);
  });

  it('finds by the words a person would use, not the skill name', () => {
    // A user asking about churn does not know the skill is "financial-analyst".
    expect(searchSkills(index, 'churn').map(s => s.name)).toContain('financial-analyst');
    expect(searchSkills(index, 'forecast a quarter').map(s => s.name)).toContain('financial-analyst');
  });

  it('ranks a name match above a keyword match', () => {
    const found = searchSkills(index, 'review', 5).map(s => s.name);
    expect(found[0]).toBe('code-reviewer');
  });

  it('returns nothing for a nonsense query', () => {
    expect(searchSkills(index, 'zzzznotathing')).toEqual([]);
  });

  it('returns nothing for an empty query', () => {
    expect(searchSkills(index, '')).toEqual([]);
    expect(searchSkills(index, '  ')).toEqual([]);
  });

  it('is stable: the same question gets the same answer', () => {
    const once = searchSkills(index, 'test', 5).map(s => s.name);
    const twice = searchSkills(index, 'test', 5).map(s => s.name);
    expect(once).toEqual(twice);
  });

  it('ignores the words that describe the request rather than the thing', () => {
    expect(scoreSkill(index.entries[0], ['write'])).toBe(0);
    expect(searchSkills(index, 'write a capture').map(s => s.name)).toEqual(['capture']);
  });

  it('honours the limit', () => {
    expect(searchSkills(index, 'e', 1).length).toBeLessThanOrEqual(1);
  });
});

describe('the catalogue is cached', () => {
  it('fetches once and then serves from disk', async () => {
    const dir = scratch();
    let calls = 0;
    const counting = (async (url: string) => {
      calls++;
      return new Response(String(url).includes('trees') ? TREE : MANIFEST, { status: 200 });
    }) as unknown as typeof fetch;

    await loadSkillIndex(dir, counting);
    await loadSkillIndex(dir, counting);
    // A 2 MB download must not happen on every tool call.
    expect(calls).toBe(2); // one tree + one manifest, then cached
    expect(existsSync(join(dir, 'skill-hub-index.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the cached copy when the network is gone, and says so', async () => {
    const dir = scratch();
    const good = (async (url: string) =>
      new Response(String(url).includes('trees') ? TREE : MANIFEST, { status: 200 })) as unknown as typeof fetch;
    await loadSkillIndex(dir, good);

    const later = Date.now() + 30 * 24 * 60 * 60 * 1000; // past the week TTL
    const broken = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const result = await loadSkillIndex(dir, broken, later);

    expect(result.fromCache).toBe(true);
    expect(result.index.entries.length).toBe(5);
    expect(result.error).toContain('ENOTFOUND');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports honestly when there is nothing cached and nothing online', async () => {
    const dir = scratch();
    const broken = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const result = await loadSkillIndex(dir, broken);
    expect(result.index.entries).toEqual([]);
    expect(result.error).toContain('offline');
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not replace a good cache with an empty one', async () => {
    const dir = scratch();
    const good = (async (url: string) =>
      new Response(String(url).includes('trees') ? TREE : MANIFEST, { status: 200 })) as unknown as typeof fetch;
    await loadSkillIndex(dir, good);

    const empty = fakeFetch(JSON.stringify({ tree: [] }));
    const later = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const result = await loadSkillIndex(dir, empty, later);
    expect(result.index.entries).toHaveLength(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores a corrupt cache instead of failing every call forever', async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'skill-hub-index.json'), '{ truncated', 'utf8');
    const good = (async (url: string) =>
      new Response(String(url).includes('trees') ? TREE : MANIFEST, { status: 200 })) as unknown as typeof fetch;
    const result = await loadSkillIndex(dir, good);
    expect(result.index.entries).toHaveLength(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('discards a cache stamped in the future, which a clock change can produce', async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'skill-hub-index.json'),
      JSON.stringify({ fetchedAt: Date.now() + 30 * 24 * 3600 * 1000, index: { entries: [], fetchedAt: 0 } }),
      'utf8',
    );
    const good = (async (url: string) =>
      new Response(String(url).includes('trees') ? TREE : MANIFEST, { status: 200 })) as unknown as typeof fetch;
    const result = await loadSkillIndex(dir, good);
    expect(result.index.entries).toHaveLength(5);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('fetching one skill', () => {
  it('refuses a path that tries to escape the repository', async () => {
    // The path comes from a catalogue fetched at runtime, so it is upstream
    // data and must not be able to reach anywhere else.
    await expect(fetchSkillFile('../../etc/passwd', fakeFetch('x'))).rejects.toThrow(/Unsafe/);
    await expect(fetchSkillFile('a/b/../../../secrets', fakeFetch('x'))).rejects.toThrow(/Unsafe/);
    await expect(fetchSkillFile('/etc/passwd', fakeFetch('x'))).rejects.toThrow(/Unsafe/);
  });

  it('refuses a path that is not a SKILL.md', async () => {
    await expect(fetchSkillFile('engineering/skills/code-reviewer/other.md', fakeFetch('x'))).rejects.toThrow(/Unsafe/);
  });

  it('returns the file for a legitimate path', async () => {
    const md = '---\nname: capture\ndescription: "Captures brain dumps"\n---\n\nInstructions here.';
    const result = await fetchSkillFile('productivity/skills/capture/SKILL.md', fakeFetch(md));
    expect(result).toBe(md);
    expect(result.startsWith('---')).toBe(true);
  });
});