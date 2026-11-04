/**
 * Agent watchdog — once a minute it looks over running agents for ones that
 * look stuck, loop on one tool call, or have waited on the person for a long
 * time, and surfaces them on the Power Center ("Needs you").
 *
 * Otto-derived design, rebuilt for Infinite OS's renderer stores: it observes
 * progress fingerprints (activity tail + tool-call count) rather than
 * transcripts, and it NEVER stops or restarts an agent — the person decides.
 * A pass is cheap enough to run forever: when nothing is running it does
 * nothing at all.
 */

import { create } from 'zustand';
import { useAgentsStore, type AgentRun } from './agents';
import { useChatStore } from './chat';

/** No visible progress for this long while "running" reads as stalled. */
const STALL_AFTER_MS = 15 * 60_000;
/** A permission/question the person has not answered for this long gets a nudge. */
const WAITING_REMIND_AFTER_MS = 10 * 60_000;
/** The same tool call repeated this many times in a row reads as a loop. */
const LOOP_REPEAT_THRESHOLD = 4;
/** Findings are re-armed at most this often (timestamps refresh on each pass). */
const PASS_INTERVAL_MS = 60_000;

export type WatchdogKind = 'stalled' | 'looping' | 'waiting-on-person';

export interface WatchdogFinding {
  runId: string;
  task: string;
  kind: WatchdogKind;
  /** Epoch ms when the condition began (best estimate). */
  since: number;
  /** Plain-language, one line — what the person needs to know. */
  detail: string;
  toolName?: string;
  repeatCount?: number;
}

interface Observation {
  fingerprint: string;
  lastProgressAt: number;
}

/** Module-level so passes stay cheap and state survives store recreation in tests. */
const observations = new Map<string, Observation>();
const waitingSince = new Map<string, number>();

export function evaluateWatchdogPass(now = Date.now()): WatchdogFinding[] {
  const runs = useAgentsStore.getState().runs;
  const chat = useChatStore.getState();
  const live = runs.filter((r) => r.status === 'running' || r.status === 'queued');
  const findings: WatchdogFinding[] = [];
  const seen = new Set<string>();

  for (const run of live) {
    seen.add(run.id);
    const fingerprint = progressFingerprint(run);
    const prev = observations.get(run.id);
    if (!prev || prev.fingerprint !== fingerprint) {
      observations.set(run.id, { fingerprint, lastProgressAt: now });
      // A loop is visible on first sight: it is a property of the activity
      // tail, not of the observation clock (a stall needs a clock to compare
      // against, a repeated call does not).
      const firstLookLoop = repeatedToolCall(run);
      if (firstLookLoop) {
        findings.push({
          runId: run.id,
          task: run.task,
          kind: 'looping',
          since: firstLookLoop.firstAt,
          toolName: firstLookLoop.label,
          repeatCount: firstLookLoop.count,
          detail: `“${shortTask(run.task)}” may be going in circles on ${firstLookLoop.label} (×${firstLookLoop.count})`,
        });
      }
      continue;
    }

    // Looping: the activity tail repeats one tool call over and over.
    const loop = repeatedToolCall(run);
    if (loop) {
      findings.push({
        runId: run.id,
        task: run.task,
        kind: 'looping',
        since: loop.firstAt,
        toolName: loop.label,
        repeatCount: loop.count,
        detail: `“${shortTask(run.task)}” may be going in circles on ${loop.label} (×${loop.count})`,
      });
      continue;
    }

    // Stalled: working, but the fingerprint has not moved for a long while.
    const idleFor = now - prev.lastProgressAt;
    if (idleFor >= STALL_AFTER_MS) {
      findings.push({
        runId: run.id,
        task: run.task,
        kind: 'stalled',
        since: prev.lastProgressAt,
        detail: `“${shortTask(run.task)}” looks stuck — no progress for ${humanize(idleFor)}`,
      });
    }
  }

  // Waiting on the person: a blocked permission or question that has sat
  // unanswered. Tracked from first sight, because the request itself carries
  // no timestamp.
  const blockers: Array<{ key: string; what: string }> = [];
  if (chat.pendingPermission) blockers.push({ key: `perm:${chat.pendingPermission.id}`, what: `Allow ${chat.pendingPermission.tool}?` });
  if (chat.pendingQuestion) blockers.push({ key: 'question', what: 'A question needs your answer' });
  if (chat.planApproval) blockers.push({ key: 'plan', what: 'A plan is waiting for your approval' });
  for (const blocker of blockers) {
    const first = waitingSince.get(blocker.key) ?? now;
    waitingSince.set(blocker.key, first);
    if (now - first >= WAITING_REMIND_AFTER_MS) {
      findings.push({
        runId: blocker.key,
        task: blocker.what,
        kind: 'waiting-on-person',
        since: first,
        detail: `${blocker.what} — waiting for you for ${humanize(now - first)}`,
      });
    }
  }
  for (const key of waitingSince.keys()) {
    if (!blockers.some((b) => b.key === key)) waitingSince.delete(key);
  }

  // Observations for runs that ended are dead weight.
  for (const id of observations.keys()) {
    if (!seen.has(id)) observations.delete(id);
  }
  return findings;
}

/** Everything that moves when an agent makes progress, in one string. */
function progressFingerprint(run: AgentRun): string {
  const tail = run.activity?.slice(-3).map((a) => a.id) ?? [];
  return `${run.toolCallCount}|${run.activity?.length ?? 0}|${tail.join(',')}|${run.preview ?? ''}`;
}

/** The tool call repeated at the very end of the activity feed, if any. */
function repeatedToolCall(run: AgentRun): { label: string; count: number; firstAt: number } | null {
  const activity = run.activity ?? [];
  if (activity.length < LOOP_REPEAT_THRESHOLD) return null;
  const tail = activity.slice(-LOOP_REPEAT_THRESHOLD);
  const label = tail[0]?.label ?? '';
  if (!label || !tail.every((a) => a.kind === 'tool' && a.label === label)) return null;
  return { label, count: tail.length, firstAt: tail[0]?.timestamp ?? Date.now() };
}

function shortTask(task: string): string {
  const t = task.replace(/\s+/g, ' ').trim();
  return t.length > 44 ? `${t.slice(0, 44)}…` : t || 'a task';
}

function humanize(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

interface WatchdogState {
  findings: WatchdogFinding[];
  lastPassAt: number;
  /** One evaluation pass. Cheap; called from a single app-level interval. */
  evaluate: () => void;
  /** Person decided to ignore a finding for now (comes back if it persists). */
  dismiss: (finding: WatchdogFinding) => void;
}

export const useWatchdogStore = create<WatchdogState>((set, get) => ({
  findings: [],
  lastPassAt: 0,
  evaluate: () => {
    const findings = evaluateWatchdogPass();
    set({ findings, lastPassAt: Date.now() });
  },
  dismiss: (finding) => {
    // Dropping the observation resets its clock: the same condition gets a
    // fresh full grace period before it is surfaced again.
    observations.delete(finding.runId);
    waitingSince.delete(finding.runId);
    set({ findings: get().findings.filter((f) => f.runId !== finding.runId) });
  },
}));

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

/** Clear every observation and waiting clock. Tests use this to isolate runs. */
export function resetWatchdog(): void {
  observations.clear();
  waitingSince.clear();
}

/** Start the once-a-minute watchdog. Idempotent; called once from the shell. */
export function attachWatchdog(): () => void {
  if (watchdogTimer) return () => undefined;
  useWatchdogStore.getState().evaluate();
  watchdogTimer = setInterval(() => useWatchdogStore.getState().evaluate(), PASS_INTERVAL_MS);
  return () => {
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
  };
}
