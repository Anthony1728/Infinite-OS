import { describe, it, expect } from 'vitest';
import { wilsonLowerBound, median, buildLeaderboard, renderLeaderboard, type ModelRecord } from './model-leaderboard.js';

describe('wilsonLowerBound', () => {
  it('scores 9/9 above 1/1', () => {
    expect(wilsonLowerBound(9, 9)).toBeGreaterThan(wilsonLowerBound(1, 1));
  });
  it('is 0 with no attempts', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
  it('penalizes 0/10 to zero-ish', () => {
    expect(wilsonLowerBound(0, 10)).toBeLessThan(0.1);
  });
});

describe('median', () => {
  it('handles odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe('buildLeaderboard', () => {
  const records: ModelRecord[] = [
    ...Array.from({ length: 10 }, (_, i) => ({ modelUsed: 'model-a', taskType: 'code', success: i < 9, duration: 1000 })),
    ...Array.from({ length: 4 }, (_, i) => ({ modelUsed: 'model-b', taskType: 'code', success: i < 1, duration: 800 })),
    ...Array.from({ length: 2 }, () => ({ modelUsed: 'model-c', taskType: 'research', success: true, duration: 500 })),
  ];

  it('aggregates per model+taskType', () => {
    const { entries } = buildLeaderboard(records);
    const a = entries.find((e) => e.model === 'model-a' && e.taskType === 'code');
    expect(a?.attempts).toBe(10);
    expect(a?.successRate).toBeCloseTo(0.9);
  });

  it('recommends the Wilson-best qualified model per task type', () => {
    const { recommendations } = buildLeaderboard(records);
    const code = recommendations.find((r) => r.taskType === 'code');
    expect(code?.bestModel).toBe('model-a');
    expect(code?.statement).toContain('n=10');
    // research has only 2 attempts (below MIN_ATTEMPTS) → early-data phrasing
    const research = recommendations.find((r) => r.taskType === 'research');
    expect(research?.statement).toContain('Not enough history');
  });

  it('renders agent-consumable text', () => {
    const { entries, recommendations } = buildLeaderboard(records);
    const text = renderLeaderboard(entries, recommendations);
    expect(text).toContain('Learned model leaderboard');
    expect(text).toContain('model-a');
  });

  it('returns empty render for no data', () => {
    expect(renderLeaderboard([], [])).toBe('');
  });
});
