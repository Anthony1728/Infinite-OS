/**
 * Outcome-driven experience learning.
 *
 * The learning memory store records what happened. This module turns those
 * outcomes into operating rules the agent actually sees on the next run:
 *
 *   - repeated failures → a guardrail ("run Verify after edits", "never repeat
 *     an identical failed tool call", …)
 *   - repeated verified successes → a procedure ("verified coding runs in this
 *     workspace used Read → Edit → Verify")
 *
 * Rules are derived deterministically from recorded evidence. Nothing is
 * synthesized by a model, and a rule never appears until it has at least two
 * observations — one bad run is an accident, not a lesson. The store is a small
 * atomically-written JSON file next to the rest of the brain data.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { redactMemorySecrets } from './memory.js';
import { lexicalOverlap, queryTerms } from '../memory/hybrid.js';

export type RunOutcome = 'success' | 'failure';
export type ExperienceIntent = 'coding' | 'debugging' | 'research' | 'planning' | 'automation' | 'conversation' | 'general';

export interface RunOutcomeInput {
  task: string;
  provider: string;
  model: string;
  outcome: RunOutcome;
  /** True only when the run's work was mechanically verified (Verify passed,
   *  or no file edits were made and the task needed none). */
  verified: boolean;
  tools: string[];
  durationMs: number;
  /** Raw failure reason from the agent loop (verification, tool, provider). */
  failure?: string;
  assistantText?: string;
}

export interface RunExperience {
  id: string;
  task: string;
  provider: string;
  model: string;
  outcome: RunOutcome;
  verified: boolean;
  tools: string[];
  durationMs: number;
  intent: ExperienceIntent;
  failureCategory: string | null;
  failureDetail: string | null;
  createdAt: number;
}

export interface LearnedDirective {
  id: string;
  kind: 'failure-guard' | 'verified-procedure';
  intent: ExperienceIntent | 'all';
  rule: string;
  evidence: number;
  failures: number;
  verifiedSuccesses: number;
  lastSeen: number;
}

export interface ExperienceStats {
  total: number;
  verifiedSuccesses: number;
  failures: number;
  directives: number;
  firstRecordedAt: number | null;
  lastRecordedAt: number | null;
}

export interface ExperienceStoreConfig {
  dataDir?: string;
  maxRecords?: number;
  now?: () => number;
}

interface PersistedExperiences {
  version: 1;
  experiences: RunExperience[];
}

interface FailureRule {
  id: string;
  pattern: RegExp;
  rule: string;
}

/**
 * Failure categories with a concrete corrective instruction. Provider/network
 * failures are intentionally excluded: they are handled by failover, and
 * turning them into agent instructions would teach the wrong lesson.
 */
const FAILURE_RULES: FailureRule[] = [
  {
    id: 'unverified-edits',
    pattern: /unverified file edits|verify was not run|unverified edits/i,
    rule: 'After any file edit, run Verify and fix every failure before writing the final answer.',
  },
  {
    id: 'typecheck',
    pattern: /typecheck|tsc\b|type error|typescript error/i,
    rule: 'Run the project typecheck after changes and fix type errors before claiming completion.',
  },
  {
    id: 'tests',
    pattern: /\btests?\b|vitest|jest|pytest|spec failed|failing test/i,
    rule: 'Run the focused tests for every file you change, then the broader suite before finishing.',
  },
  {
    id: 'build',
    pattern: /\bbuild\b|compile|bundle failed/i,
    rule: 'Build the project after structural changes; a passing typecheck alone does not prove the bundle works.',
  },
  {
    id: 'permission',
    pattern: /permission denied|not permitted|denied by policy|read-only|requires approval/i,
    rule: 'When a tool is blocked by policy, stop and explain the blocked action instead of retrying it.',
  },
  {
    id: 'timeout',
    pattern: /timed out|timeout|stalled/i,
    rule: 'Break long work into small verified steps and report progress instead of running one giant command.',
  },
  {
    id: 'promise-only',
    pattern: /promis|did not execute|no tool|required tool|plan instead|unfulfilled/i,
    rule: 'Execute the requested action with tools; never return a plan when the user asked for a finished result.',
  },
  {
    id: 'tool-failure',
    pattern: /tool error|tool failed|command failed|exit code|unknown tool|identical tool call/i,
    rule: 'After a tool failure, change the arguments or gather the missing precondition; never repeat an identical failed call.',
  },
];

const INTENTS: Array<{ intent: ExperienceIntent; pattern: RegExp }> = [
  { intent: 'debugging', pattern: /\b(debug|bug|error|fix|failing|regression|stack ?trace)\b/i },
  { intent: 'coding', pattern: /\b(code|implement|refactor|function|typescript|javascript|python|react|api|repo)\b/i },
  { intent: 'research', pattern: /\b(research|search|source|cite|latest|compare|investigate)\b/i },
  { intent: 'planning', pattern: /\b(plan|design|architecture|roadmap|strategy|break down)\b/i },
  { intent: 'automation', pattern: /\b(automat|schedule|cron|workflow|trigger|webhook)\b/i },
  { intent: 'conversation', pattern: /\b(hello|thanks|explain|summarize|chat|opinion)\b/i },
];

export function classifyIntent(task: string): ExperienceIntent {
  for (const entry of INTENTS) {
    if (entry.pattern.test(task)) return entry.intent;
  }
  return 'general';
}

export function classifyFailure(failure: string | undefined): { id: string; rule: string } | null {
  if (!failure) return null;
  for (const entry of FAILURE_RULES) {
    if (entry.pattern.test(failure)) return { id: entry.id, rule: entry.rule };
  }
  return null;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'rule';
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return redactMemorySecrets(value.replace(/\s+/g, ' ').trim()).slice(0, max);
}

function atomicWrite(path: string, contents: string): void {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, contents);
  renameSync(temporary, path);
}

export class ExperienceStore {
  private readonly dataDir: string;
  private readonly storePath: string;
  private readonly maxRecords: number;
  private readonly now: () => number;
  private experiences: RunExperience[];

  constructor(config: ExperienceStoreConfig = {}) {
    this.dataDir = config.dataDir ?? join(infiniteHome(), 'brain');
    this.storePath = join(this.dataDir, 'experience.json');
    this.maxRecords = Math.max(50, config.maxRecords ?? 1_000);
    this.now = config.now ?? Date.now;
    this.experiences = this.load();
  }

  record(input: RunOutcomeInput): RunExperience | null {
    const task = text(input.task, 500);
    if (task.length < 3) return null;
    const failure = text(input.failure, 600);
    const category = input.outcome === 'failure' ? classifyFailure(failure) : null;
    const recorded: RunExperience = {
      id: `exp-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task,
      provider: text(input.provider, 80),
      model: text(input.model, 160),
      outcome: input.outcome,
      verified: input.outcome === 'success' ? input.verified !== false : false,
      tools: [...new Set(input.tools.map((tool) => text(tool, 60)).filter(Boolean))].slice(0, 20),
      durationMs: Math.max(0, Math.round(input.durationMs)),
      intent: classifyIntent(task),
      failureCategory: category?.id ?? (input.outcome === 'failure' ? 'uncategorized' : null),
      failureDetail: input.outcome === 'failure' && failure ? failure : null,
      createdAt: this.now(),
    };
    this.experiences.push(recorded);
    if (this.experiences.length > this.maxRecords) {
      this.experiences = this.experiences.slice(-this.maxRecords);
    }
    this.save();
    return structuredClone(recorded);
  }

  list(): RunExperience[] {
    return this.experiences.map((experience) => structuredClone(experience));
  }

  stats(): ExperienceStats {
    const verifiedSuccesses = this.experiences.filter((e) => e.outcome === 'success' && e.verified).length;
    const failures = this.experiences.filter((e) => e.outcome === 'failure').length;
    return {
      total: this.experiences.length,
      verifiedSuccesses,
      failures,
      directives: this.deriveDirectives().length,
      firstRecordedAt: this.experiences[0]?.createdAt ?? null,
      lastRecordedAt: this.experiences.at(-1)?.createdAt ?? null,
    };
  }

  /**
   * Derive evidence-backed directives. Failure guards need two failures in the
   * same category; success procedures need two verified runs with the same
   * leading tool sequence for the same intent. Everything else is ignored.
   */
  deriveDirectives(): LearnedDirective[] {
    const failureGroups = new Map<string, { rule: string; count: number; lastSeen: number }>();
    const procedureGroups = new Map<string, { intent: ExperienceIntent; tools: string[]; count: number; lastSeen: number }>();
    let verifiedSuccesses = 0;
    let failures = 0;

    for (const experience of this.experiences) {
      if (experience.outcome === 'failure') {
        failures++;
        const category = classifyFailure(experience.failureDetail ?? '');
        if (!category) continue;
        const current = failureGroups.get(category.id) ?? { rule: category.rule, count: 0, lastSeen: 0 };
        current.count++;
        current.lastSeen = Math.max(current.lastSeen, experience.createdAt);
        failureGroups.set(category.id, current);
        continue;
      }

      if (!experience.verified) continue;
      verifiedSuccesses++;
      if (experience.tools.length < 2) continue;
      const leading = experience.tools.slice(0, 5);
      const signature = leading.join('>');
      const key = `${experience.intent}:${signature}`;
      const current = procedureGroups.get(key) ?? {
        intent: experience.intent,
        tools: leading,
        count: 0,
        lastSeen: 0,
      };
      current.count++;
      current.lastSeen = Math.max(current.lastSeen, experience.createdAt);
      procedureGroups.set(key, current);
    }

    const directives: LearnedDirective[] = [];
    for (const [id, group] of failureGroups) {
      if (group.count < 2) continue;
      directives.push({
        id: `failure:${id}`,
        kind: 'failure-guard',
        intent: 'all',
        rule: group.rule,
        evidence: group.count,
        failures: group.count,
        verifiedSuccesses,
        lastSeen: group.lastSeen,
      });
    }
    // Keep the two strongest procedures per intent so context stays compact.
    const byIntent = new Map<ExperienceIntent, LearnedDirective[]>();
    for (const [key, group] of procedureGroups) {
      if (group.count < 2) continue;
      const directive: LearnedDirective = {
        id: `procedure:${slug(key)}`,
        kind: 'verified-procedure',
        intent: group.intent,
        rule: `Verified ${group.intent} runs followed ${group.tools.join(' → ')}; use that order where it fits, then run the checks again.`,
        evidence: group.count,
        failures,
        verifiedSuccesses,
        lastSeen: group.lastSeen,
      };
      const list = byIntent.get(group.intent) ?? [];
      list.push(directive);
      byIntent.set(group.intent, list);
    }
    for (const list of byIntent.values()) {
      list.sort((a, b) => b.evidence - a.evidence || b.lastSeen - a.lastSeen);
      directives.push(...list.slice(0, 2));
    }
    return directives;
  }

  /** Directives most relevant to this task, ranked by intent + term overlap +
   *  evidence. Only evidence-backed directives are ever returned. */
  learnedDirectives(query: string, limit = 4): LearnedDirective[] {
    const intent = classifyIntent(query);
    const terms = queryTerms(query).join(' ');
    const scored = this.deriveDirectives().map((directive) => {
      const intentMatch = directive.intent === intent ? 1.2 : directive.intent === 'all' ? 0.65 : 0;
      const termMatch = terms ? lexicalOverlap(terms, directive.rule) : 0;
      return {
        directive,
        score: intentMatch + termMatch * 0.8 + Math.min(1, directive.evidence * 0.15),
      };
    });
    scored.sort((a, b) => b.score - a.score || b.directive.lastSeen - a.directive.lastSeen);
    return scored
      .filter((entry) => entry.score >= 0.75)
      .slice(0, Math.max(0, Math.min(limit, 10)))
      .map((entry) => ({ ...entry.directive }));
  }

  /** Compact system-context block. Requires real evidence before it appears. */
  formatForContext(query: string, limit = 4): string {
    const directives = this.learnedDirectives(query, limit);
    if (!directives.length) return '';
    const stats = this.stats();
    return [
      `[Learned operating rules — ${stats.total} recorded run(s): ${stats.verifiedSuccesses} verified success(es), ${stats.failures} failure(s)]`,
      ...directives.map((directive) => `- ${directive.rule} (evidence: ${directive.evidence})`),
    ].join('\n');
  }

  clear(): void {
    this.experiences = [];
    this.save();
  }

  private load(): RunExperience[] {
    try {
      if (!existsSync(this.storePath)) return [];
      const data = JSON.parse(readFileSync(this.storePath, 'utf8')) as PersistedExperiences;
      if (data.version !== 1 || !Array.isArray(data.experiences)) return [];
      return data.experiences
        .filter((entry) => entry?.id && entry?.task && (entry.outcome === 'success' || entry.outcome === 'failure'))
        .slice(-this.maxRecords);
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      mkdirSync(this.dataDir, { recursive: true });
      atomicWrite(this.storePath, JSON.stringify({ version: 1, experiences: this.experiences } satisfies PersistedExperiences));
    } catch {
      // Experience learning is advisory. A read-only profile must not break
      // the agent run that just finished.
    }
  }
}

let instance: ExperienceStore | null = null;

export function getExperienceStore(): ExperienceStore {
  if (!instance) instance = new ExperienceStore();
  return instance;
}

/** Test hook: replace the singleton with an isolated store. */
export function createExperienceStore(config?: ExperienceStoreConfig): ExperienceStore {
  instance = new ExperienceStore(config);
  return instance;
}

export function recordRunExperience(input: RunOutcomeInput): RunExperience | null {
  return getExperienceStore().record(input);
}

export function getExperienceStats(): ExperienceStats {
  return getExperienceStore().stats();
}

export function getLearnedDirectives(query: string, limit?: number): LearnedDirective[] {
  return getExperienceStore().learnedDirectives(query, limit);
}

export function getExperienceContext(query: string, limit?: number): string {
  return getExperienceStore().formatForContext(query, limit);
}
