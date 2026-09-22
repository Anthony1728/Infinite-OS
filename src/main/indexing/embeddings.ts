// Embedding backend for the workspace index. Local-first: real vectors from
// Ollama's embedding API (nomic-embed-text by default — no API cost, private),
// with a deterministic lexical-fallback vector so semantic search still works
// (worse, but honestly) when Ollama is offline. Replaces the demo hash-based
// pseudo-embeddings that ranked files by character coincidence.

import { OLLAMA_URL } from '../ollama/utils.js';

export const EMBEDDING_DIM = 768;
export const FALLBACK_EMBEDDING_MODEL = 'nomic-embed-text';

interface OllamaEmbedResponse {
  embeddings?: number[][];
  embedding?: number[];
}

let ollamaEmbeddingAvailable: boolean | null = null;
let availabilityCheckedAt = 0;
const AVAILABILITY_TTL_MS = 60_000;

/** Preferred embedding model: first installed of the preference list. */
export async function resolveEmbeddingModel(): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const installed = (data.models ?? []).map((m) => m.name);
    for (const pref of [FALLBACK_EMBEDDING_MODEL, 'mxbai-embed-large', 'all-minilm', 'snowflake-arctic-embed:s']) {
      const hit = installed.find((name) => name === pref || name.startsWith(`${pref}:`));
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

/** True when Ollama currently has an embedding model installed. */
export async function ollamaEmbeddingsAvailable(): Promise<boolean> {
  const now = Date.now();
  if (ollamaEmbeddingAvailable !== null && now - availabilityCheckedAt < AVAILABILITY_TTL_MS) {
    return ollamaEmbeddingAvailable;
  }
  ollamaEmbeddingAvailable = (await resolveEmbeddingModel()) !== null;
  availabilityCheckedAt = now;
  return ollamaEmbeddingAvailable;
}

/** Real embedding via Ollama. Throws on failure so callers can fall back. */
export async function ollamaEmbed(text: string, model: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text.slice(0, 8_000) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
  const data = (await res.json()) as OllamaEmbedResponse;
  const vec = data.embeddings?.[0] ?? data.embedding;
  if (!vec || !vec.length) throw new Error('Ollama embed returned no vector');
  return vec;
}

// ── Lexical fallback vector ────────────────────────────────────────────────
// A hashed bag-of-words vector (bag-of-words over a fixed space, no random
// sign flipping): near-identical texts land close together, so "semantic"
// search degrades to fuzzy keyword search instead of nonsense.

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'it', 'this', 'that', 'with', 'as', 'at', 'by', 'be', 'from', 'was', 'not',
]);

export function lexicalVector(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const words = text.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  for (const word of words) {
    let h = 2166136261;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBEDDING_DIM;
    vec[idx] += 1;
  }
  return normalize(vec);
}

export function normalize(vec: number[]): number[] {
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Embed text with the best available backend. Returns the vector and which
 * backend produced it, so mixed indexes can be flagged for re-indexing when
 * the backend changes.
 */
export async function embedText(text: string): Promise<{ vector: number[]; backend: 'ollama' | 'lexical'; model?: string }> {
  if (await ollamaEmbeddingsAvailable()) {
    const model = await resolveEmbeddingModel();
    if (model) {
      try {
        return { vector: normalize(await ollamaEmbed(text, model)), backend: 'ollama', model };
      } catch { /* fall through to lexical */ }
    }
  }
  return { vector: lexicalVector(text), backend: 'lexical' };
}
