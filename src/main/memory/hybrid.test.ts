import { describe, expect, it } from 'vitest';
import {
  hybridScore,
  isRelevant,
  lexicalOverlap,
  lexicalVectorSimilarity,
  normalizeBaseScore,
  queryTerms,
} from './hybrid.js';

describe('hybrid memory recall scoring', () => {
  it('extracts meaningful query terms without stop words', () => {
    expect(queryTerms('What did we decide about the deploy pipeline?')).toEqual([
      'decide',
      'deploy',
      'pipeline',
    ]);
    expect(queryTerms('a an the')).toEqual([]);
    expect(queryTerms('retry HTTP 429 on api.example.com')).toContain('429');
    expect(queryTerms('retry HTTP 429 on api.example.com')).toContain('api.example.com');
  });

  it('scores token overlap fractionally', () => {
    expect(lexicalOverlap('deploy pipeline retry', 'The deploy pipeline uses a retry budget')).toBe(1);
    expect(lexicalOverlap('deploy pipeline retry', 'The deploy pipeline is documented')).toBeCloseTo(2 / 3, 5);
    expect(lexicalOverlap('unrelated words', 'nothing relevant here')).toBe(0);
  });

  it('normalizes the unbounded base score into [0, 1]', () => {
    expect(normalizeBaseScore(0)).toBe(0);
    expect(normalizeBaseScore(1.8)).toBeCloseTo(0.5, 5);
    expect(normalizeBaseScore(9)).toBe(1);
  });

  it('lets real semantic similarity beat an unrelated but important memory', () => {
    const relevant = hybridScore({ baseScore: 0.6, semanticSimilarity: 0.82, lexicalOverlap: 0.5 });
    const unrelated = hybridScore({ baseScore: 3.2, semanticSimilarity: 0.05, lexicalOverlap: 0 });
    expect(relevant).toBeGreaterThan(unrelated);
  });

  it('keeps exact names competitive through the lexical signal', () => {
    const exact = hybridScore({ baseScore: 1, semanticSimilarity: 0.55, lexicalOverlap: 1 });
    const fuzzy = hybridScore({ baseScore: 1.4, semanticSimilarity: 0.7, lexicalOverlap: 0 });
    expect(exact).toBeGreaterThan(0);
    expect(fuzzy).toBeGreaterThan(0);
    // A one-token exact match is worth more than a vague vector match at equal base.
    expect(hybridScore({ baseScore: 1, semanticSimilarity: 0, lexicalOverlap: 1 }))
      .toBeGreaterThan(hybridScore({ baseScore: 1, semanticSimilarity: 0, lexicalOverlap: 0 }));
  });

  it('gates unrelated scans but allows empty queries to rank by importance', () => {
    expect(isRelevant(0.2, 0.1, true)).toBe(true);
    expect(isRelevant(0.01, 0, true)).toBe(false);
    expect(isRelevant(0.01, 0, false)).toBe(true);
  });

  it('provides a deterministic lexical fallback similarity', () => {
    const close = lexicalVectorSimilarity('deploy pipeline retry budget', 'deploy pipeline retry budget');
    const far = lexicalVectorSimilarity('deploy pipeline retry budget', 'unrelated cooking recipe');
    expect(close).toBeCloseTo(1, 5);
    expect(far).toBeLessThan(close);
  });
});
