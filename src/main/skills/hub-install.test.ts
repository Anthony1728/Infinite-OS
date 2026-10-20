import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchSkillFile, loadSkillIndex, type SkillHubEntry } from './hub.js';
import { SkillFileStore, parseSkillMarkdown } from './skill-store.js';

/**
 * The seam between the public library and the local skill store.
 *
 * `SkillFileStore` is already well tested on its own, and the hub is tested on
 * its own. What neither covers is the join: a skill fetched from the library has
 * to land in the store as an ordinary skill the agent can then invoke. If that
 * join breaks, a user installs a skill and it silently never appears in the
 * catalogue — the same failure shape as the tasks that used to live only in
 * renderer memory.
 */

/** The real frontmatter shape from `alirezarezvani/claude-skills`, trimmed. */
const UPSTREAM_SKILL_MD = `---
name: capture
description: "Captures and organizes chaotic brain dumps into a structured system with zero information loss."
license: MIT
metadata:
  author: upstream
  version: 2.1.0
---

# Capture

When the user unloads a messy stream of ideas:

1. Sort them into Projects, Ideas, Tasks and Connections.
2. Do not lose anything — "zero information loss" is the point.
3. Ask at most one clarifying question, and only when genuinely ambiguous.
`;

const ENTRY: SkillHubEntry = {
  name: 'capture',
  path: 'productivity/skills/capture/SKILL.md',
  category: 'productivity',
  bundle: 'productivity-skills',
  description: 'Capture, review and organise work',
  keywords: ['notes', 'capture'],
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'skill-join-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fakeFetch = (body: string) =>
  (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

/** Exactly what the `hub_install` branch of the Skills tool does. */
async function install(store: SkillFileStore): Promise<string> {
  const markdown = await fetchSkillFile(ENTRY.path, fakeFetch(UPSTREAM_SKILL_MD));
  const parsed = parseSkillMarkdown(markdown, ENTRY.path);
  return store.write({
    name: parsed.name || ENTRY.name,
    description: String(parsed.frontmatter.description ?? ENTRY.description ?? ''),
    category: ENTRY.category,
    instructions: markdown,
  });
}

describe('a skill from the public library becomes an ordinary local skill', () => {
  it('is written and then listed, so the agent can find it afterwards', async () => {
    const store = new SkillFileStore(join(dir, 'skills'));
    await install(store);

    const listed = store.list();
    expect(listed.map(s => s.name)).toContain('capture');
    expect(listed[0].path).toContain('capture');
  });

  it('keeps the instructions intact, so invoking it returns the real content', async () => {
    const store = new SkillFileStore(join(dir, 'skills'));
    await install(store);

    const read = store.read('capture');
    expect(read).not.toBeNull();
    expect(read!.instructions).toContain('zero information loss');
    // The body must not be truncated by the install.
    expect(read!.instructions.length).toBeGreaterThan(UPSTREAM_SKILL_MD.length * 0.8);
  });

  it('carries the description, so a search matches the words that describe it', async () => {
    const store = new SkillFileStore(join(dir, 'skills'));
    await install(store);

    const read = store.read('capture');
    expect(read!.frontmatter.description).toContain('brain dumps');
  });

  it('goes through the store guards rather than writing the file directly', async () => {
    // A skill name derived from upstream must still be slugged and bounds-checked.
    const hostile = { ...ENTRY, name: '../../escape' };
    const markdown = await fetchSkillFile(hostile.path, fakeFetch(UPSTREAM_SKILL_MD));
    const store = new SkillFileStore(join(dir, 'skills'));

    // slugifySkillName turns the hostile name into something safe rather than
    // letting it escape the base directory.
    const written = store.write({
      name: hostile.name,
      description: 'x',
      category: 'x',
      instructions: markdown,
    });
    expect(written.startsWith(join(dir, 'skills'))).toBe(true);
    expect(written).not.toContain('..');
  });

  it('is idempotent: installing twice does not create two skills', async () => {
    const store = new SkillFileStore(join(dir, 'skills'));
    await install(store);
    await install(store);
    expect(store.list()).toHaveLength(1);
  });

  it('an offline machine can still install from its cached catalogue', async () => {
    const cacheDir = join(dir, 'cache');
    const tree = JSON.stringify({
      tree: [{ path: ENTRY.path, type: 'blob' }],
    });
    const online = (async (url: string) =>
      new Response(String(url).includes('trees') ? tree : JSON.stringify({ plugins: {} }), { status: 200 })) as unknown as typeof fetch;
    const first = await loadSkillIndex(cacheDir, online);
    expect(first.index.entries).toHaveLength(1);

    // Well past the week TTL, with no network: the catalogue still resolves.
    const later = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const broken = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const second = await loadSkillIndex(cacheDir, broken, later);
    expect(second.index.entries).toHaveLength(1);

    const store = new SkillFileStore(join(dir, 'skills'));
    const markdown = await fetchSkillFile(second.index.entries[0].path, fakeFetch(UPSTREAM_SKILL_MD));
    expect(store.write({ name: 'capture', description: 'x', category: 'x', instructions: markdown })).toContain('capture');
  });
});