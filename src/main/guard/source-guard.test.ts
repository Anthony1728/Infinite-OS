import { describe, it, expect } from 'vitest';
import { noteMtime, noteReport, seedMtimes } from './source-guard.js';

describe('source-guard spurious-event filter', () => {
  it('ignores repeat sightings without mtime advance', () => {
    const rel = `spurious-${Date.now()}-a`;
    expect(noteMtime(rel, 1000)).toBe(true);
    expect(noteMtime(rel, 1000)).toBe(false);
    expect(noteMtime(rel, 999)).toBe(false);
    expect(noteMtime(rel, 1001)).toBe(true);
  });

  it('debounces repeat reports per file', () => {
    const rel = `spurious-${Date.now()}-b`;
    const now = Date.now();
    expect(noteReport(rel, now)).toBe(true);
    expect(noteReport(rel, now + 1000)).toBe(false);
    expect(noteReport(rel, now + 31_000)).toBe(true);
  });

  it('seeds current mtimes so an untouched file never warns on a spurious first event', async () => {
    const { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join, relative } = await import('node:path');
    const cwd = mkdtempSync(join(tmpdir(), 'guard-seed-'));
    try {
      const srcDir = join(cwd, 'src');
      mkdirSync(srcDir, { recursive: true });
      const file = join(srcDir, 'index.html');
      writeFileSync(file, '<html></html>');
      const rel = relative(cwd, file).replace(/\\/g, '/');
      seedMtimes(srcDir, cwd);
      // First watch event on a file that never changed (Windows fires these
      // for AV scans and dev-server reads): equals the baseline → no warn.
      expect(noteMtime(rel, statSync(file).mtimeMs)).toBe(false);
      // A real external edit advances mtime past the baseline → warns.
      expect(noteMtime(rel, Date.now() + 60_000)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
