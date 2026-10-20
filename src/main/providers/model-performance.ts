// Persistent model reliability — the Brain's long-term memory of which
// models actually work.
//
// The in-memory failover quarantine (unhealthyUntil) dies with the process, so
// every restart re-discovers which models are dead. This module records every
// outcome (success/failure, plus the failure reason) per provider:model and
// persists it, then ranks candidates with a Wilson lower bound so 9/9 beats 1/1
// and small samples stay humble. Failover ordering consults the score, so the
// more conversations the Brain runs, the better its automatic model switching
// gets — that is the "learns from every conversation" loop for routing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { wilsonLowerBound } from '../brain/model-leaderboard.js';

export interface ModelPerfRecord {
  successes: number;
  failures: number;
  /** 'ok' | 'fail' — the most recent outcome, so status reads stay honest. */
  lastResult: 'ok' | 'fail';
  lastAt: number;
  /** Last failure message (truncated) — surfaced by the model-status command. */
  lastError?: string;
}

/** Below this many attempts the Wilson score is uninformative — report 0. */
const MIN_ATTEMPTS_FOR_SCORE = 3;
/** Keep the file bounded: retire the coldest entries past this size. */
const MAX_ENTRIES = 400;

let cache: Record<string, ModelPerfRecord> | null = null;
let dirty = false;
let lastFlushAt = 0;
const FLUSH_INTERVAL_MS = 5_000;

function filePath(): string {
  return join(infiniteHome(), 'model-performance.json');
}

function load(): Record<string, ModelPerfRecord> {
  if (cache) return cache;
  try {
    if (existsSync(filePath())) {
      const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as Record<string, unknown>;
      cache = {};
      for (const [key, value] of Object.entries(raw)) {
        const rec = value as Partial<ModelPerfRecord>;
        if (!rec || typeof rec !== 'object') continue;
        cache[key] = {
          successes: Number(rec.successes) || 0,
          failures: Number(rec.failures) || 0,
          lastResult: rec.lastResult === 'ok' ? 'ok' : 'fail',
          lastAt: Number(rec.lastAt) || 0,
          ...(typeof rec.lastError === 'string' ? { lastError: rec.lastError } : {}),
        };
      }
      return cache;
    }
  } catch { /* corrupt file: start fresh */ }
  cache = {};
  return cache;
}

function save(force = false): void {
  if (!dirty) return;
  const now = Date.now();
  if (!force && now - lastFlushAt < FLUSH_INTERVAL_MS) return;
  try {
    mkdirSync(infiniteHome(), { recursive: true });
    writeFileSync(filePath(), JSON.stringify(cache ?? {}, null, 2), 'utf8');
    dirty = false;
    lastFlushAt = now;
  } catch { /* learning is best-effort — never break a turn over it */ }
}

function perfKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/** Test seam: forget all persisted state. */
export function resetModelPerformance(): void {
  cache = null;
  dirty = false;
  lastFlushAt = 0;
}

/** Test seam: force any queued write to disk. */
export function flushModelPerformance(): void {
  save(true);
}

export function recordModelOutcome(
  provider: string,
  model: string,
  ok: boolean,
  error?: string,
): void {
  if (!provider || !model) return;
  const store = load();
  const key = perfKey(provider, model);
  const existing = store[key];
  const record: ModelPerfRecord = existing ?? { successes: 0, failures: 0, lastResult: ok ? 'ok' : 'fail', lastAt: 0 };
  if (ok) record.successes += 1;
  else record.failures += 1;
  record.lastResult = ok ? 'ok' : 'fail';
  record.lastAt = Date.now();
  if (!ok && error) record.lastError = error.slice(0, 300);
  if (ok) delete record.lastError;
  store[key] = record;

  // Bound the file: evict coldest entries once past the cap.
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    keys
      .sort((a, b) => (store[a]?.lastAt ?? 0) - (store[b]?.lastAt ?? 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((cold) => { delete store[cold]; });
  }
  dirty = true;
  save();
}

export function getModelPerformance(provider: string, model: string): ModelPerfRecord | null {
  return load()[perfKey(provider, model)] ?? null;
}

/**
 * Learned reliability in [0, 1] — Wilson lower bound over persisted outcomes.
 * Returns 0 until the model has enough attempts, so an untested model never
 * outranks a proven one on absence of data alone.
 */
export function getModelReliability(provider: string, model: string): number {
  const rec = getModelPerformance(provider, model);
  if (!rec) return 0;
  const attempts = rec.successes + rec.failures;
  if (attempts < MIN_ATTEMPTS_FOR_SCORE) return 0;
  return wilsonLowerBound(rec.successes, attempts);
}

export interface ModelPerformanceStat extends ModelPerfRecord {
  provider: string;
  model: string;
  attempts: number;
  reliability: number;
}

/** Snapshot for the model-status command and Brain Doctor surfaces. */
export function getModelPerformanceStats(): ModelPerformanceStat[] {
  const store = load();
  return Object.entries(store)
    .map(([key, rec]) => {
      const sep = key.indexOf(':');
      const provider = key.slice(0, sep);
      const model = key.slice(sep + 1);
      const attempts = rec.successes + rec.failures;
      return {
        provider,
        model,
        ...rec,
        attempts,
        reliability: getModelReliability(provider, model),
      };
    })
    .sort((a, b) => b.lastAt - a.lastAt);
}
