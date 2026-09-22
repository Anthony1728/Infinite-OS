// Learned model leaderboard — Infinite OS already records every interaction
// (task type, provider, model, success, duration) in the Intelligence Engine.
// This module aggregates those records into a private, personalized ranking:
// "for coding tasks, model X succeeded 92% of the time (n=37)". No competitor
// has this because none of them owns the whole runtime like Infinite OS does.

export interface ModelRecord {
  modelUsed: string;
  provider?: string;
  taskType: string;
  success: boolean;
  duration: number;
  tokens?: { input?: number; output?: number };
}

export interface LeaderboardEntry {
  model: string;
  taskType: string;
  attempts: number;
  successes: number;
  successRate: number;
  medianDurationMs: number;
  /** Wilson lower bound — small-sample rates stay humble. */
  score: number;
}

export interface LeaderboardRecommendation {
  taskType: string;
  bestModel: string;
  successRate: number;
  attempts: number;
  statement: string;
}

/** Wilson score lower bound at 95% — ranks "9/9" above "1/1" fairly. */
export function wilsonLowerBound(successes: number, attempts: number, z = 1.96): number {
  if (attempts === 0) return 0;
  const p = successes / attempts;
  const denom = 1 + (z * z) / attempts;
  const centre = p + (z * z) / (2 * attempts);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * attempts)) / attempts);
  return Math.max(0, (centre - margin) / denom);
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MIN_ATTEMPTS = 3;

/** Build the per-task-type leaderboard from raw records. */
export function buildLeaderboard(records: ModelRecord[]): {
  entries: LeaderboardEntry[];
  recommendations: LeaderboardRecommendation[];
} {
  const groups = new Map<string, ModelRecord[]>();
  for (const r of records) {
    if (!r.modelUsed) continue;
    const key = `${r.taskType}||${r.provider ? `${r.provider}/` : ''}${r.modelUsed}`;
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }

  const entries: LeaderboardEntry[] = [];
  for (const [key, list] of groups) {
    const [taskType, model] = key.split('||');
    const successes = list.filter((r) => r.success).length;
    entries.push({
      model,
      taskType,
      attempts: list.length,
      successes,
      successRate: list.length ? successes / list.length : 0,
      medianDurationMs: Math.round(median(list.map((r) => r.duration))),
      score: wilsonLowerBound(successes, list.length),
    });
  }
  entries.sort((a, b) => b.score - a.score);

  const recommendations: LeaderboardRecommendation[] = [];
  const byTask = new Map<string, LeaderboardEntry[]>();
  for (const e of entries) {
    const list = byTask.get(e.taskType) ?? [];
    list.push(e);
    byTask.set(e.taskType, list);
  }
  for (const [taskType, list] of byTask) {
    const qualified = list.filter((e) => e.attempts >= MIN_ATTEMPTS);
    const best = (qualified.length ? qualified : list).sort((a, b) => b.score - a.score)[0];
    if (best) {
      recommendations.push({
        taskType,
        bestModel: best.model,
        successRate: best.successRate,
        attempts: best.attempts,
        statement:
          best.attempts < MIN_ATTEMPTS
            ? `Not enough history for ${taskType} yet — early data favors ${best.model} (${best.successes}/${best.attempts}).`
            : `For ${taskType} tasks, ${best.model} succeeded ${Math.round(best.successRate * 100)}% of the time (n=${best.attempts}).`,
      });
    }
  }

  return { entries, recommendations };
}

/** Render the leaderboard as compact agent-consumable context. */
export function renderLeaderboard(entries: LeaderboardEntry[], recommendations: LeaderboardRecommendation[], limit = 8): string {
  if (!entries.length) return '';
  const lines = ['# Learned model leaderboard (private, from this machine\'s history)'];
  for (const r of recommendations.slice(0, 4)) lines.push(`- ${r.statement}`);
  lines.push('');
  lines.push('Overall ranking (Wilson-scored success rate):');
  for (const e of entries.slice(0, limit)) {
    lines.push(`- ${e.model} [${e.taskType}]: ${Math.round(e.successRate * 100)}% (${e.successes}/${e.attempts}), median ${e.medianDurationMs}ms`);
  }
  return lines.join('\n');
}
