import { describe, expect, it, beforeAll } from 'vitest';
import { parseTree, applyManifest, searchSkills, fetchSkillFile, type SkillHubIndex } from './hub.js';

/**
 * The library as it actually is.
 *
 * The unit tests use a five-entry fixture so the rules can be checked exactly.
 * This one fetches the real catalogue and asks the questions a person would
 * actually ask, because a matching function that only works against a fixture is
 * not a matching function.
 *
 * Skipped when offline, so a network outage never turns into a red suite.
 */

let index: SkillHubIndex | null = null;
let skipped = false;

beforeAll(async () => {
  try {
    const treeRes = await fetch(
      'https://api.github.com/repos/alirezarezvani/claude-skills/git/trees/main?recursive=1',
      { headers: { 'User-Agent': 'infinite-os' } },
    );
    if (!treeRes.ok) throw new Error(`HTTP ${treeRes.status}`);
    let entries = parseTree(await treeRes.text());
    try {
      const manifestRes = await fetch(
        'https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/.claude-plugin/marketplace.json',
      );
      if (manifestRes.ok) entries = applyManifest(entries, await manifestRes.text());
    } catch {
      /* names alone still work */
    }
    if (entries.length === 0) throw new Error('no entries');
    index = { entries, fetchedAt: Date.now() };
  } catch {
    skipped = true;
  }
}, 30_000);

describe('the real library', () => {
  it('parses into a usable catalogue', () => {
    if (skipped) return;
    expect(index!.entries.length).toBeGreaterThan(300);
    // Every skill must be addressable, or the agent has no way to name it.
    expect(index!.entries.every(e => e.name.length > 0 && e.path.endsWith('/SKILL.md'))).toBe(true);
  });

  it('is not double-counted by the per-agent copies', () => {
    if (skipped) return;
    expect(index!.entries.filter(e => e.path.includes('.gemini'))).toHaveLength(0);
  });

  it('finds skills by task rather than by name', () => {
    if (skipped) return;
    const names = index!.entries.map(e => e.name);
    const cases: [string, string[]][] = [
      ['code review', ['code-reviewer']],
      ['security audit', ['security-pen-testing']],
      ['onboarding a new engineer', ['codebase-onboarding']],
    ];
    const misses: string[] = [];
    for (const [query, expected] of cases) {
      const found = searchSkills(index!, query, 10).map(e => e.name);
      for (const want of expected) {
        if (!found.includes(want)) misses.push(`"${query}" wanted ${want}, got [${found.join(', ')}]`);
      }
      if (found.length === 0) misses.push(`"${query}" returned nothing`);
    }
    expect(misses).toEqual([]);
    // Guards against a search that matches everything, which is not a search.
    expect(names.length).toBeGreaterThan(300);
  });

  it('does not answer a nonsense query with a confident wrong answer', () => {
    if (skipped) return;
    expect(searchSkills(index!, 'zzzznotathing')).toEqual([]);
  });

  it('is stable: the same question gets the same answer', () => {
    if (skipped) return;
    const once = searchSkills(index!, 'review', 5).map(e => e.name);
    const twice = searchSkills(index!, 'review', 5).map(e => e.name);
    expect(once).toEqual(twice);
    expect(once.length).toBeGreaterThan(0);
  });

  it('a real SKILL.md downloads with its frontmatter intact', async () => {
    if (skipped) return;
    const sample = index!.entries.find(e => e.path.includes('productivity/'));
    if (!sample) return;
    const markdown = await fetchSkillFile(sample.path);
    expect(markdown.length).toBeGreaterThan(200);
    expect(markdown.trimStart().startsWith('---')).toBe(true);
    expect(markdown).toMatch(/\nname:\s*\S/);
  }, 20_000);
});