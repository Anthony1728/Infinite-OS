import { describe, it, expect } from 'vitest';
import { noteMtime, noteReport } from './source-guard.js';

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
});
