import { describe, it, expect, beforeEach, vi } from 'vitest';

// The module under test reads localStorage at import time; the hoisted block
// runs before any import, so the shim is in place when it loads.
const ls = vi.hoisted(() => {
  const backing = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return backing.size;
    },
    key: (index: number) => [...backing.keys()][index] ?? null,
    clear: () => backing.clear(),
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  };
  (globalThis as { localStorage?: Storage }).localStorage = shim;
  return backing;
});

import { composerDraft, saveComposerDraft, clearComposerDraft } from './composerDrafts';

describe('composer drafts', () => {
  beforeEach(() => {
    ls.clear();
  });

  it('stores and returns a draft per session', () => {
    saveComposerDraft('s1', 'Hello, draft one');
    saveComposerDraft('s2', 'Second session text');
    expect(composerDraft('s1')).toBe('Hello, draft one');
    expect(composerDraft('s2')).toBe('Second session text');
    expect(composerDraft('s3')).toBe('');
    expect(composerDraft(null)).toBe('');
  });

  it('treats whitespace-only text as "no draft"', () => {
    saveComposerDraft('s1', 'real text');
    saveComposerDraft('s1', '   ');
    expect(composerDraft('s1')).toBe('');
  });

  it('clears a draft explicitly', () => {
    saveComposerDraft('s1', 'to be cleared');
    clearComposerDraft('s1');
    expect(composerDraft('s1')).toBe('');
  });

  it('evicts the oldest-written draft beyond the cap', () => {
    for (let i = 0; i < 205; i += 1) {
      saveComposerDraft(`session-${i}`, `draft ${i}`);
    }
    // The first-written sessions were evicted; the newest are all present.
    expect(composerDraft('session-0')).toBe('');
    expect(composerDraft('session-4')).toBe('');
    expect(composerDraft('session-5')).toBe('draft 5');
    expect(composerDraft('session-204')).toBe('draft 204');
  });

  it('rewriting a draft keeps it young in the eviction order', () => {
    for (let i = 0; i < 200; i += 1) saveComposerDraft(`session-${i}`, `draft ${i}`);
    // Touch session-0 so it becomes the newest-written slot.
    saveComposerDraft('session-0', 'draft 0 (edited)');
    saveComposerDraft('session-200', 'draft 200');
    expect(composerDraft('session-0')).toBe('draft 0 (edited)');
    expect(composerDraft('session-200')).toBe('draft 200');
    // session-1 is now the oldest and took the eviction.
    expect(composerDraft('session-1')).toBe('');
  });
});
