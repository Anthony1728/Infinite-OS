/**
 * Stratified-memory ranking (pure, dependency-free so it stays unit-testable
 * without the native SQLite binding). The AIOS pattern: episodic session
 * events decay, semantic facts persist, procedural how-tos rank highest.
 */

export type MemoryTier = 'episodic' | 'semantic' | 'procedural';

export const VALID_TIERS: MemoryTier[] = ['episodic', 'semantic', 'procedural'];

export function normalizeTier(tier: unknown, fallback: MemoryTier = 'semantic'): MemoryTier {
  return VALID_TIERS.includes(tier as MemoryTier) ? (tier as MemoryTier) : fallback;
}

export function tierForType(type: string): MemoryTier {
  return type === 'chat' ? 'episodic' : 'semantic';
}

export interface ScorableMemory {
  title: string;
  updatedAt: number;
  importance: number;
  accessCount: number;
  tier: MemoryTier;
}

/** Rank score: importance dominates, then recency (30-day half-life), prior
 * usefulness, tier durability, and title hits. */
export function scoreMemory(entry: ScorableMemory, query: string, now = Date.now()): number {
  const ageDays = Math.max(0, (now - entry.updatedAt) / 86_400_000);
  const recency = Math.exp(-ageDays / 30);
  const useBonus = Math.min(0.5, entry.accessCount * 0.05);
  const tierBoost = entry.tier === 'procedural' ? 0.15 : entry.tier === 'semantic' ? 0.1 : 0;
  const titleHit = entry.title.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0;
  return entry.importance * 2 + recency + useBonus + tierBoost + titleHit;
}

/** Normalize timestamps: old rows may carry unixepoch() seconds, code writes ms. */
export function toMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number') return fallback;
  return value > 0 && value < 1_000_000_000_000 ? value * 1000 : value;
}
