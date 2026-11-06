/**
 * Hybrid recall scoring.
 *
 * The original recall path only saw rows that matched a SQL LIKE query and
 * ranked them by static signals. That works for exact keywords but misses the
 * main reason people write memories down: the next session asks the same thing
 * in different words. Recall now combines three independent, honest signals:
 *
 *   base      — importance, recency, prior usefulness, tier durability
 *   semantic  — cosine similarity between the stored vector and query vector
 *   lexical   — token overlap (kept because embeddings are lossy for names,
 *               paths, error codes, and version numbers)
 *
 * Everything here is pure so the ranking can be tested without the native
 * SQLite binding or an embedding backend.
 */

import { cosineSimilarity, lexicalVector } from '../indexing/embeddings.js';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'it', 'this', 'that', 'with', 'as', 'at', 'by', 'be', 'from', 'was', 'not',
  'what', 'when', 'where', 'which', 'who', 'how', 'did', 'does', 'do', 'we',
  'you', 'your', 'our', 'about', 'can', 'could', 'should', 'would', 'please',
]);

/** Meaningful query tokens, capped so one long paste cannot explode the scan. */
export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const word of query.toLowerCase().split(/[^a-z0-9_+#.-]+/)) {
    if (word.length < 3 || STOP_WORDS.has(word)) continue;
    seen.add(word);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

/** Fraction of query tokens present in the candidate text. */
export function lexicalOverlap(query: string, text: string): number {
  const wanted = queryTerms(query);
  if (wanted.length === 0) return 0;
  const haystack = text.toLowerCase();
  let matches = 0;
  for (const term of wanted) {
    if (haystack.includes(term)) matches++;
  }
  return matches / wanted.length;
}

export interface HybridScoreSignals {
  /** Raw scoreMemory() output. */
  baseScore: number;
  /** Cosine similarity in [-1, 1]. */
  semanticSimilarity: number;
  /** lexicalOverlap() in [0, 1]. */
  lexicalOverlap: number;
}

/**
 * Normalize scoreMemory's unbounded output before mixing. Its realistic
 * ceiling is ~4.0 (importance 2 + recency 1 + use 0.5 + tier 0.15 + title 0.3).
 */
export function normalizeBaseScore(baseScore: number): number {
  return clamp(baseScore / 3.6, 0, 1);
}

/** Blend the signals. Relevance signals carry slightly more weight than
 *  static importance, but cannot erase it: a stale trivial note with a lucky
 *  vector match still should not beat a pinned procedural memory by much. */
export function hybridScore(signals: HybridScoreSignals): number {
  const base = normalizeBaseScore(signals.baseScore);
  const semantic = clamp((signals.semanticSimilarity + 1) / 2, 0, 1);
  const lexical = clamp(signals.lexicalOverlap, 0, 1);
  return base * 0.32 + semantic * 0.5 + lexical * 0.18;
}

/**
 * Relevance gate. Hybrid recall scans the whole dataset instead of a LIKE
 * prefilter, so unrelated rows must be excluded explicitly. High-importance
 * rows still need a little real term/vector overlap to appear.
 */
export function isRelevant(semanticSimilarity: number, lexical: number, hasQuery: boolean): boolean {
  if (!hasQuery) return true;
  // Lexical similarity from the hashed fallback vector is a real lexical
  // signal; random collisions are positive but tiny. 0.08 keeps true matches
  // while dropping noise.
  return Math.max(semanticSimilarity, lexical * 0.5) >= 0.08;
}

/** Cosine similarity of the query's lexical vector with a text's lexical
 *  vector. Used when a row has no compatible embedding yet, so legacy rows
 *  keep a deterministic fuzzy-match signal during the backfill window. */
export function lexicalVectorSimilarity(query: string, text: string): number {
  return cosineSimilarity(lexicalVector(query), lexicalVector(text));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
