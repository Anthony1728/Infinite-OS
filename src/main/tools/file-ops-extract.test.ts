import { describe, expect, it } from 'vitest';
import { join, resolve, sep } from 'node:path';
import { resolveExtractTarget } from './file-ops.js';

/**
 * `FileOps extract` validated only the destination, never the entries.
 *
 * A ZIP entry is just a name, so an archive could carry `../../src/main/audit/`
 * and write outside the folder it was pointed at — including over the files
 * that implement the user's undo. PowerShell 5.1 happens to reject `../` on
 * this platform, but that is the extractor's behaviour, not a guarantee: the
 * same tool must be safe on any extractor and against entries that stay inside
 * the destination yet land on a protected file. Enforced before unpacking.
 */

const DEST = resolve('C:\\extract\\out');

function inside(entry: string): boolean {
  return resolveExtractTarget(DEST, entry) !== null;
}

describe('archive entries cannot escape the destination', () => {
  it.each([
    '../evil.txt',
    '../../evil.txt',
    'a/../../evil.txt',
    'a/b/../../../../evil.txt',
    './../../evil.txt',
    '..\\evil.txt',
    'a\\..\\..\\evil.txt',
  ])('refuses %s', (entry) => {
    expect(inside(entry), `${entry} escaped the destination`).toBe(false);
  });

  it.each([
    '/etc/passwd',
    '/absolute/evil.txt',
    'C:/Windows/System32/evil.dll',
    'C:\\Windows\\System32\\evil.dll',
    '//server/share/evil.txt',
  ])('refuses the absolute path %s', (entry) => {
    expect(inside(entry)).toBe(false);
  });

  it.each([
    'file.txt',
    'docs/readme.md',
    'a/b/c/deep.txt',
    './file.txt',
    'file with spaces.txt',
    'a/./b.txt',
    '...hidden',
    'weird..name.txt',
  ])('allows %s', (entry) => {
    expect(inside(entry), `${entry} was wrongly refused`).toBe(true);
  });

  it('resolves to a path genuinely inside the destination', () => {
    const target = resolveExtractTarget(DEST, 'docs/readme.md');
    expect(target).toBe(join(DEST, 'docs', 'readme.md'));
    expect(target!.startsWith(DEST + sep)).toBe(true);
  });

  it('accepts the destination folder itself', () => {
    expect(resolveExtractTarget(DEST, '.')).toBe(DEST);
  });

  it('cannot be fooled by a sibling folder sharing a prefix', () => {
    // The classic prefix bug: "/extract/out-evil" starts with "/extract/out".
    // A naive startsWith containment check would allow this.
    expect(resolveExtractTarget(DEST, '../out-evil/evil.txt')).toBeNull();
    expect(resolveExtractTarget(DEST, '../outbackup/evil.txt')).toBeNull();
  });

  it('stays put when the destination itself is deeply nested', () => {
    const deep = resolve('C:\\a\\b\\c\\d');
    expect(resolveExtractTarget(deep, '../../../../x.txt')).toBeNull();
    expect(resolveExtractTarget(deep, 'x.txt')).toBe(join(deep, 'x.txt'));
  });
});