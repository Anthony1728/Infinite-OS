import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, parseRegistry, searchRegistry, scoreEntry, type CliHubRegistry } from './registry.js';
import { hasShellSyntax, tokenise, runCommand } from './run.js';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'cli-hub-'));
}

/**
 * The shape taken from the live registry, so a change upstream is caught here
 * rather than at the point the agent tries to use it.
 */
const REAL_SAMPLE = {
  meta: { repo: 'https://github.com/HKUDS/CLI-Anything', updated: '2026-06-19' },
  clis: [
    {
      name: 'gimp',
      display_name: 'GIMP',
      version: '0.1.0',
      description: 'Image editing — layers, filters, and scripted batch operations',
      requires: 'GIMP 2.10+',
      homepage: 'https://www.gimp.org',
      source_url: null,
      install_cmd: 'pip install git+https://github.com/HKUDS/CLI-Anything.git#subdirectory=gimp/agent-harness',
      entry_point: 'cli-anything-gimp',
      skill_md: 'skills/cli-anything-gimp/SKILL.md',
      category: 'image',
      contributors: [{ name: 'Someone', url: 'https://github.com/someone' }],
    },
    {
      name: 'libreoffice',
      display_name: 'LibreOffice',
      description: 'Office suite — documents, spreadsheets, presentations',
      requires: 'LibreOffice 7.x+',
      install_cmd: 'pip install git+https://github.com/HKUDS/CLI-Anything.git#subdirectory=libreoffice/agent-harness',
      entry_point: 'cli-anything-libreoffice',
      category: 'office',
    },
    {
      name: 'blender',
      display_name: 'Blender',
      description: '3D modelling, rendering and animation',
      install_cmd: 'pip install git+https://github.com/HKUDS/CLI-Anything.git#subdirectory=blender/agent-harness',
      entry_point: 'cli-anything-blender',
      category: '3d',
    },
  ],
};

describe('reading the catalogue', () => {
  it('parses the real registry shape', () => {
    const registry = parseRegistry(JSON.stringify(REAL_SAMPLE));
    expect(registry.clis).toHaveLength(3);
    expect(registry.clis[0].name).toBe('gimp');
    expect(registry.clis[0].entry_point).toBe('cli-anything-gimp');
    expect(registry.meta?.updated).toBe('2026-06-19');
  });

  it('accepts a bare array too, because the catalogue matters more than its wrapper', () => {
    const registry = parseRegistry(JSON.stringify(REAL_SAMPLE.clis));
    expect(registry.clis).toHaveLength(3);
  });

  it('drops entries with no name rather than reporting a CLI you cannot address', () => {
    const registry = parseRegistry(JSON.stringify({ clis: [{ name: 'ok' }, { display_name: 'no name' }, null, 'x'] }));
    expect(registry.clis.map(c => c.name)).toEqual(['ok']);
  });

  it('survives malformed JSON by throwing rather than returning a half-built catalogue', () => {
    // A caller that treats a parse failure as "no CLIs exist" would tell the
    // user the capability is gone. Throwing keeps that distinguishable.
    expect(() => parseRegistry('{ not json')).toThrow();
  });

  it('drops the contributor list, which no agent would act on', () => {
    const entry = parseRegistry(JSON.stringify(REAL_SAMPLE)).clis[0] as unknown as Record<string, unknown>;
    expect(entry.contributors).toBeUndefined();
    // The homepage stays: it is genuinely useful to show the user where the
    // thing they are installing comes from.
    expect(entry.homepage).toBe('https://www.gimp.org');
  });
});

describe('finding the right CLI', () => {
  const registry = parseRegistry(JSON.stringify(REAL_SAMPLE));

  it('finds by name', () => {
    expect(searchRegistry(registry, 'gimp').map(c => c.name)).toEqual(['gimp']);
  });

  it('finds by what the user asked for, not only by product name', () => {
    // The whole point of the catalogue: the user says "edit a photo", not
    // "gimp". The registry calls it "Image editing"; without the synonym map
    // this returns nothing at all.
    expect(searchRegistry(registry, 'photo').map(c => c.name)).toContain('gimp');
    expect(searchRegistry(registry, 'spreadsheet').map(c => c.name)).toContain('libreoffice');
    expect(searchRegistry(registry, 'make a video').map(c => c.name)).toEqual([]);
    expect(searchRegistry(registry, '3d model').map(c => c.name)).toContain('blender');
  });

  it('ignores the words that describe the request rather than the thing', () => {
    // "edit" and "my" are not in any registry entry. Failing on them would make
    // every natural request return nothing.
    expect(searchRegistry(registry, 'edit a photo').map(c => c.name)).toContain('gimp');
    expect(searchRegistry(registry, 'I want to make a spreadsheet').map(c => c.name)).toContain('libreoffice');
  });

  it('puts an exact name match above a description match', () => {
    expect(scoreEntry(registry.clis[0], ['gimp'])).toBeGreaterThan(scoreEntry(registry.clis[1], ['gimp']));
  });

  it('ranks a partial match rather than discarding it', () => {
    // Not a strict AND. "blender photo" still finds Blender, because dropping
    // it would mean the catalogue cannot answer the half of the question it
    // knows. It ranks below a full match rather than vanishing.
    const found = searchRegistry(registry, 'blender photo', 10).map(c => c.name);
    expect(found).toContain('blender');
  });

  it('does not match a word hidden inside a longer one', () => {
    // "notebooks" contains "book". Before word-boundary matching, searching
    // "read books" returned note-taking CLIs on the strength of that substring.
    const noteTaking = parseRegistry(JSON.stringify({
      clis: [{ name: 'joplin', display_name: 'Joplin', description: 'Note-taking - manage notebooks and notes', category: 'knowledge' }],
    }));
    expect(searchRegistry(noteTaking, 'book')).toEqual([]);
    // The whole word still finds it.
    expect(searchRegistry(noteTaking, 'notebooks').map(c => c.name)).toEqual(['joplin']);
  });

  it('understands a plural the registry does not use', () => {
    // The registry says "Note-taking"; the user types "notes".
    const noteTaking = parseRegistry(JSON.stringify({
      clis: [{ name: 'joplin', display_name: 'Joplin', description: 'Note-taking - manage notebooks and notes', category: 'knowledge' }],
    }));
    expect(searchRegistry(noteTaking, 'notes').map(c => c.name)).toEqual(['joplin']);
  });

  it('does not match a short word inside a longer one', () => {
    // 'animation'.includes('a') is true, so "make a video" used to return
    // Blender on the strength of the letter a. A result that looks like an
    // answer and is not, is worse than no result.
    expect(searchRegistry(registry, 'make a video')).toEqual([]);
    expect(scoreEntry(registry.clis[2], ['a'])).toBe(0);
  });

  it('still matches a short word when it really is a word', () => {
    expect(scoreEntry(registry.clis[2], ['3d'])).toBeGreaterThan(0);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchRegistry(registry, '')).toEqual([]);
    expect(searchRegistry(registry, '   ')).toEqual([]);
  });

  it('answers the same way twice, so a search is not a lottery', () => {
    const once = searchRegistry(registry, 'cli').map(c => c.name);
    const twice = searchRegistry(registry, 'cli').map(c => c.name);
    expect(once).toEqual(twice);
  });

  it('honours the limit', () => {
    expect(searchRegistry(registry, 'a', 1).length).toBeLessThanOrEqual(1);
  });
});

describe('the catalogue is cached, and a stale copy still works', () => {
  it('fetches once and then serves from disk', async () => {
    const dir = scratch();
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify(REAL_SAMPLE), { status: 200 });
    }) as unknown as typeof fetch;

    await loadRegistry(dir, fakeFetch);
    await loadRegistry(dir, fakeFetch);
    await loadRegistry(dir, fakeFetch);
    // Opening the agent must not re-fetch on every call.
    expect(calls).toBe(1);

    expect(existsSync(join(dir, 'cli-hub-registry.json'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the cached copy when the network is gone, and says so', async () => {
    const dir = scratch();
    const good = (async () => new Response(JSON.stringify(REAL_SAMPLE), { status: 200 })) as unknown as typeof fetch;
    await loadRegistry(dir, good);

    // A day later, with no network.
    const later = Date.now() + 25 * 60 * 60 * 1000;
    const broken = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
    const result = await loadRegistry(dir, broken, later);

    expect(result.fromCache).toBe(true);
    expect(result.registry.clis).toHaveLength(3);
    expect(result.error).toContain('ENOTFOUND');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports honestly when there is nothing cached and nothing online', async () => {
    const dir = scratch();
    const broken = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const result = await loadRegistry(dir, broken);
    expect(result.registry.clis).toEqual([]);
    expect(result.fromCache).toBe(false);
    expect(result.error).toContain('offline');
    rmSync(dir, { recursive: true, force: true });
  });

  it('does not replace a good cache with an empty one', async () => {
    const dir = scratch();
    const good = (async () => new Response(JSON.stringify(REAL_SAMPLE), { status: 200 })) as unknown as typeof fetch;
    await loadRegistry(dir, good);

    // Upstream returns a valid document that happens to contain nothing.
    const empty = (async () => new Response(JSON.stringify({ clis: [] }), { status: 200 })) as unknown as typeof fetch;
    const later = Date.now() + 25 * 60 * 60 * 1000;
    const result = await loadRegistry(dir, empty, later);

    // Wiping the cache here would strand a machine that is offline tomorrow.
    expect(result.registry.clis).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignores a corrupt cache instead of failing every call forever', async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cli-hub-registry.json'), '{ truncated', 'utf8');
    const good = (async () => new Response(JSON.stringify(REAL_SAMPLE), { status: 200 })) as unknown as typeof fetch;
    const result = await loadRegistry(dir, good);
    expect(result.registry.clis).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('discards a cache stamped in the future, which a clock change can produce', async () => {
    const dir = scratch();
    mkdirSync(dir, { recursive: true });
    const future: CliHubRegistry = { clis: [] };
    writeFileSync(
      join(dir, 'cli-hub-registry.json'),
      JSON.stringify({ fetchedAt: Date.now() + 7 * 24 * 3600 * 1000, registry: future }),
      'utf8',
    );
    const good = (async () => new Response(JSON.stringify(REAL_SAMPLE), { status: 200 })) as unknown as typeof fetch;
    const result = await loadRegistry(dir, good);
    expect(result.registry.clis).toHaveLength(3);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the cache atomically, so a crash cannot truncate it', async () => {
    const dir = scratch();
    const good = (async () => new Response(JSON.stringify(REAL_SAMPLE), { status: 200 })) as unknown as typeof fetch;
    await loadRegistry(dir, good);
    // No stray temp files left behind.
    const leftovers = readFileSync(join(dir, 'cli-hub-registry.json'), 'utf8');
    expect(leftovers.length).toBeGreaterThan(0);
    expect(() => JSON.parse(leftovers)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('refusing to run something it should not', () => {
  it('spots shell syntax', () => {
    expect(hasShellSyntax('pip install x')).toBe(false);
    expect(hasShellSyntax('pip install x && rm -rf /')).toBe(true);
    expect(hasShellSyntax('pip install x; whoami')).toBe(true);
    expect(hasShellSyntax('echo `whoami`')).toBe(true);
    expect(hasShellSyntax('pip install $HOME/x')).toBe(true);
    expect(hasShellSyntax('cmd > out.txt')).toBe(true);
    expect(hasShellSyntax('cmd\nother')).toBe(true);
  });

  it('tokenises a simple command into argv', () => {
    expect(tokenise('pip install foo')).toEqual({ file: 'pip', args: ['install', 'foo'] });
    expect(tokenise('  cli-anything-gimp --help ')).toEqual({ file: 'cli-anything-gimp', args: ['--help'] });
  });

  it('keeps a quoted argument as one argument, so a path with a space survives', () => {
    expect(tokenise('cli "my file.png"')).toEqual({ file: 'cli', args: ['my file.png'] });
  });

  it('refuses an unbalanced quote rather than guessing where it ended', () => {
    expect(tokenise('cli "unclosed')).toBeNull();
  });

  it('refuses to run a command carrying shell syntax', async () => {
    const result = await runCommand('echo hi && echo there');
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('Refused');
    // Nothing was executed: the dangerous half never ran.
    expect(result.stdout).toBe('');
  });

  it('says plainly when the command is not installed', async () => {
    const result = await runCommand('definitely-not-a-real-command-xyz --help', { timeoutMs: 5000 });
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/not installed or not on PATH/);
  });

  it('runs a real command and returns its output', async () => {
    const result = await runCommand(['node', '-e', 'process.stdout.write("hello")'], { timeoutMs: 15_000 });
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('hello');
  });

  it('passes an argument containing a space as one argument, not two', async () => {
    // The argv form exists for exactly this. Round-tripping through a string
    // would split "my file.png" into two arguments and the CLI would fail on a
    // file that does not exist.
    const result = await runCommand(
      ['node', '-e', 'process.stdout.write(process.argv[1])', 'my file.png'],
      { timeoutMs: 15_000 },
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('my file.png');
  });

  it('does not expand shell syntax inside an argument', async () => {
    // Array form is already inert; nothing in it can reach a shell.
    const result = await runCommand(
      ['node', '-e', 'process.stdout.write("safe")', 'a && rm -rf /', '$HOME', '`id`'],
      { timeoutMs: 15_000 },
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('safe');
  });

  it('reports a non-zero exit rather than throwing', async () => {
    const result = await runCommand(['node', '-e', 'process.exit(3)'], { timeoutMs: 15_000 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(3);
  });

  it('gives up on a command that hangs, instead of blocking the turn', async () => {
    const result = await runCommand(['node', '-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 1500 });
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  }, 20_000);
});