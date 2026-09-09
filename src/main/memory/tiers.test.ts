import { describe, expect, it } from 'vitest';
import { normalizeTier, tierForType, scoreMemory, toMs } from './tiers.js';

// Pure ranking math — no native SQLite binding needed.

describe('memory tiers', () => {
  it('normalizes tiers and defaults by entry type', () => {
    expect(normalizeTier('episodic')).toBe('episodic');
    expect(normalizeTier('procedural')).toBe('procedural');
    expect(normalizeTier('bogus')).toBe('semantic');
    expect(normalizeTier(undefined)).toBe('semantic');
    expect(tierForType('chat')).toBe('episodic');
    expect(tierForType('preference')).toBe('semantic');
    expect(tierForType('note')).toBe('semantic');
  });

  it('ranks important, title-matching memories above trivia', () => {
    const now = Date.now();
    const base = { updatedAt: now, accessCount: 0, tier: 'semantic' as const };
    const trivia = scoreMemory({ ...base, title: 'unrelated', importance: 0.1 }, 'deploy');
    const star = scoreMemory({ ...base, title: 'deploy checklist', importance: 0.95 }, 'deploy');
    expect(star).toBeGreaterThan(trivia);
  });

  it('prefers fresh procedural how-tos over stale episodic events', () => {
    const now = Date.now();
    const stale = scoreMemory(
      { title: 'did a thing', updatedAt: now - 60 * 86_400_000, importance: 0.5, accessCount: 0, tier: 'episodic' },
      'thing',
      now,
    );
    const fresh = scoreMemory(
      { title: 'did a thing', updatedAt: now, importance: 0.5, accessCount: 0, tier: 'procedural' },
      'thing',
      now,
    );
    expect(fresh).toBeGreaterThan(stale);
  });

  it('rewards reuse without letting it dominate importance', () => {
    const now = Date.now();
    const base = { title: 'x', updatedAt: now, tier: 'semantic' as const };
    const cold = scoreMemory({ ...base, importance: 0.5, accessCount: 0 }, 'x', now);
    const warm = scoreMemory({ ...base, importance: 0.5, accessCount: 100 }, 'x', now);
    expect(warm - cold).toBeLessThanOrEqual(0.5);
    expect(warm).toBeGreaterThan(cold);
  });

  it('normalizes second-based legacy timestamps to ms', () => {
    expect(toMs(1_700_000_000, 0)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000, 0)).toBe(1_700_000_000_000);
    expect(toMs('junk', 42)).toBe(42);
  });
});
