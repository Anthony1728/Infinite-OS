import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SkillFileStore,
  parseSkillMarkdown,
  renderSkillMarkdown,
  safeSkillDir,
  slugifySkillName,
} from './skill-store.js';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'infinite-skill-store-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('slugifySkillName', () => {
  it('normalizes display names into safe slugs', () => {
    expect(slugifySkillName('Deep Research!')).toBe('deep-research');
    expect(slugifySkillName('  Code Review  ')).toBe('code-review');
    expect(slugifySkillName('meeting_notes_v2')).toBe('meeting-notes-v2');
  });

  it('rejects empty or symbol-only names', () => {
    expect(() => slugifySkillName('')).toThrow();
    expect(() => slugifySkillName('!!!')).toThrow();
  });
});

describe('safeSkillDir', () => {
  it('rejects traversal and absolute paths', () => {
    expect(() => safeSkillDir(dir, '..')).toThrow();
    expect(() => safeSkillDir(dir, '../evil')).toThrow();
    expect(() => safeSkillDir(dir, 'a\\..\\b')).toThrow();
    expect(() => safeSkillDir(dir, 'C:\\x')).toThrow();
    expect(() => safeSkillDir(dir, 'x/y')).toThrow();
  });

  it('joins safe names under the base', () => {
    expect(safeSkillDir(dir, 'code-review')).toBe(join(dir, 'code-review'));
  });
});

describe('parseSkillMarkdown', () => {
  it('parses frontmatter scalars, lists, and the instructions body', () => {
    const content = [
      '---',
      'name: code-review',
      'description: Review code systematically.',
      'category: development',
      'enabled: true',
      'created: 1234',
      'triggers:',
      '  - review',
      '  - lint',
      'examples:',
      '  - "review src/main.ts"',
      '---',
      '# Code Review',
      '',
      'Pass 1: correctness.',
    ].join('\n');
    const file = parseSkillMarkdown(content, '/x/SKILL.md');
    expect(file.name).toBe('code-review');
    expect(file.frontmatter.description).toBe('Review code systematically.');
    expect(file.frontmatter.enabled).toBe('true');
    expect(file.frontmatter.created).toBe('1234');
    expect(file.frontmatter.triggers).toEqual(['review', 'lint']);
    expect(file.frontmatter.examples).toEqual(['review src/main.ts']);
    expect(file.instructions).toContain('# Code Review');
    expect(file.instructions).toContain('Pass 1: correctness.');
  });

  it('treats a file without frontmatter as pure instructions', () => {
    const file = parseSkillMarkdown('# Just a body', '/x/SKILL.md');
    expect(file.name).toBe('');
    expect(file.instructions).toBe('# Just a body');
  });

  it('round-trips through renderSkillMarkdown', () => {
    const original = {
      name: 'deep-research',
      id: 'skill-1',
      source: 'bundled' as const,
      description: 'Do thorough research.',
      category: 'research',
      enabled: true,
      created: 100,
      updated: 200,
      triggers: ['research', 'sources'],
      examples: ['research RPA frameworks'],
      instructions: '1. Plan sub-questions.\n2. Gather evidence.\n3. Cite sources.',
    };
    const rendered = renderSkillMarkdown(original);
    const reparsed = parseSkillMarkdown(rendered, '/x/SKILL.md');
    expect(reparsed.name).toBe(original.name);
    expect(reparsed.frontmatter.description).toBe(original.description);
    expect(reparsed.frontmatter.category).toBe(original.category);
    expect(reparsed.frontmatter.id).toBe(original.id);
    expect(reparsed.frontmatter.enabled).toBe('true');
    expect(reparsed.frontmatter.created).toBe('100');
    expect(reparsed.frontmatter.updated).toBe('200');
    expect(reparsed.frontmatter.triggers).toEqual(original.triggers);
    expect(reparsed.frontmatter.examples).toEqual(original.examples);
    expect(reparsed.instructions).toBe(original.instructions);
  });
});

describe('SkillFileStore', () => {
  it('lists, reads, writes, and removes SKILL.md files', () => {
    const store = new SkillFileStore(dir);
    expect(store.list()).toEqual([]);

    const path = store.write({ name: 'code-review', description: 'Review code.', instructions: '# Steps' });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('name: code-review');

    const files = store.list();
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('code-review');
    expect(files[0].instructions).toBe('# Steps');

    const read = store.read('Code-Review');
    expect(read).not.toBeNull();
    expect(read!.frontmatter.description).toBe('Review code.');

    expect(store.read('missing')).toBeNull();
    expect(store.hasAny()).toBe(true);

    expect(store.remove('code-review')).toBe(true);
    expect(store.list()).toEqual([]);
    expect(store.hasAny()).toBe(false);
    expect(store.remove('code-review')).toBe(false);
  });

  it('overwrites an existing skill of the same slug', () => {
    const store = new SkillFileStore(dir);
    store.write({ name: 'meeting-notes', description: 'v1', instructions: 'old' });
    store.write({ name: 'meeting-notes', description: 'v2', instructions: 'new' });
    expect(store.list()).toHaveLength(1);
    expect(store.read('meeting-notes')!.frontmatter.description).toBe('v2');
    expect(store.read('meeting-notes')!.instructions).toBe('new');
  });

  it('skips directories without SKILL.md', () => {
    writeFileSync(join(dir, 'stray.txt'), 'x');
    mkdirSync(join(dir, 'no-skill-dir'), { recursive: true });
    writeFileSync(join(dir, 'no-skill-dir', 'other.md'), 'x');
    const store = new SkillFileStore(dir);
    expect(store.list()).toEqual([]);
  });
});
