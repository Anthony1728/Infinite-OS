import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let testHome = '';
const savedHome = process.env.INFINITE_TEST_HOME;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), 'cmds-'));
  process.env.INFINITE_TEST_HOME = testHome;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
  if (testHome) rmSync(testHome, { recursive: true, force: true });
});

async function load() {
  return import('./custom.js');
}

function write(rel: string, content: string): void {
  const dir = join(testHome, 'commands');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, rel), content, 'utf8');
}

describe('parseCommandFile', () => {
  it('parses frontmatter name/description/template', async () => {
    const { parseCommandFile } = await load();
    const cmd = parseCommandFile('review.md', '---\nname: review\ndescription: Review code\n---\nBe blunt. Focus: $ARGS');
    expect(cmd).toEqual({ name: 'review', description: 'Review code', template: 'Be blunt. Focus: $ARGS' });
  });

  it('falls back to filename + first line without frontmatter', async () => {
    const { parseCommandFile } = await load();
    const cmd = parseCommandFile('ship.md', '# Ship it\nPush the branch and open a PR.');
    expect(cmd?.name).toBe('ship');
    expect(cmd?.description).toBe('Ship it');
  });

  it('rejects invalid names and empty templates', async () => {
    const { parseCommandFile } = await load();
    expect(parseCommandFile('BAD NAME.md', '---\nname: BAD NAME\n---\nbody')).toBeNull();
    expect(parseCommandFile('empty.md', '---\nname: empty\n---\n   ')).toBeNull();
  });
});

describe('expandTemplate', () => {
  it('expands $ARGS and positional $1..$9', async () => {
    const { expandTemplate } = await load();
    expect(expandTemplate('Do $ARGS now', 'the thing')).toBe('Do the thing now');
    expect(expandTemplate('$1 vs $2', 'cats dogs')).toBe('cats vs dogs');
    expect(expandTemplate('[$1][$9]', 'only')).toBe('[only][]');
    expect(expandTemplate('No placeholders', 'ignored')).toBe('No placeholders');
  });
});

describe('listCustomCommands', () => {
  it('lists valid files, ignores bad ones, dedupes', async () => {
    write('a.md', '---\nname: alpha\ndescription: First\n---\nDo alpha: $ARGS');
    write('b.md', 'Just a body line for beta.');
    write('evil.md', '---\nname: ../escape\ndescription: x\n---\nnope');
    const { listCustomCommands } = await load();
    const { dir, commands } = listCustomCommands();
    expect(dir.endsWith('commands')).toBe(true);
    expect(commands.map((c) => c.name).sort()).toEqual(['alpha', 'b']);
  });

  it('returns an empty list when the dir is missing', async () => {
    const { listCustomCommands } = await load();
    expect(listCustomCommands().commands).toEqual([]);
  });
});

describe('getCustomCommand + saveCustomCommand', () => {
  it('round-trips through disk', async () => {
    const { saveCustomCommand, getCustomCommand } = await load();
    expect(saveCustomCommand('FixUP', 'Fix things', 'Fix $ARGS today')).toEqual({ ok: true });
    expect(getCustomCommand('fixup')?.template).toBe('Fix $ARGS today');
  });

  it('rejects bad names and empty templates', async () => {
    const { saveCustomCommand } = await load();
    expect(saveCustomCommand('../x', 'd', 't').ok).toBe(false);
    expect(saveCustomCommand('ok', 'd', '   ').ok).toBe(false);
  });
});
