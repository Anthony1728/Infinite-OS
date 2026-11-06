// Agent coordination — the layer that makes delegation trustworthy.
//
// Before this module, a crew specialist received "produce a production-grade
// artifact for your role" (no definition of done), its string result flowed
// straight into the leader's integration prompt (nothing checked), and
// nothing about its work persisted for the next run (no agent memory).
//
// This module upgrades that path IN PLACE on the real spawn pipeline:
//   1. DelegatedTask — objective + ACCEPTANCE CRITERIA that are mechanically
//      checkable (file paths exist, claimed commands produced output), not vibes.
//   2. verifyDeliverable — runs the checks BEFORE the leader consumes the
//      result. A failed specialist gets one revision round carrying exactly
//      which criteria failed and why.
//   3. Honest verification records flow to the leader, so integration knows
//      which outputs were proven and which are claims.
//   4. Per-agent memory — completed work is recorded into the SQLite memory
//      store under dataset "agent:<type>", and a specialist of the same type
//      starts its next run with that context recalled into its prompt.

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface DelegatedTask {
  id: string;
  role: string;
  agentType: string;
  /** The objective the specialist was given (objective + criteria + deliverable format). */
  prompt: string;
  /** Checkable statements the final result must satisfy. */
  acceptanceCriteria: string[];
  status: 'delegated' | 'result_ready' | 'verified' | 'rejected';
  result: string;
  verification: VerificationResult;
}

export interface VerificationResult {
  /** 'pass' — every mechanical check succeeded. 'fail' — at least one failed
   *  and the specialist was asked to revise. 'unverified' — nothing checkable
   *  (pure-text roles) and no criterion contradicted the result. */
  verdict: 'pass' | 'fail' | 'unverified';
  checked: Array<{ criterion: string; ok: boolean; detail: string }>;
  reasons: string[];
}

/** Role-specific, mechanically checkable acceptance criteria. Each entry is
 *  a sentence shown to the specialist AND a check the verifier can run. */
export function deriveAcceptanceCriteria(agentType: string, objective: string): string[] {
  const type = agentType.toLowerCase();
  // Universal baseline for every role.
  const criteria: string[] = [
    'Your final reply states exactly what you produced (files changed/created, decisions made) — not a plan to produce it.',
  ];
  if (/\b(code|coder|devops|automation|security|architect|tester|mobile|aieng)\b/.test(type) || type === 'code' || type === 'tester') {
    criteria.push('Every file you created or modified is named with its full absolute path in your final reply.');
    criteria.push('Every file named in your reply actually exists on disk at the stated path.');
    if (/\b(tests?|qa|verify)\b/.test(type) || type === 'tester') {
      criteria.push('If you ran checks (typecheck/lint/tests), your reply includes the command AND its real output summary. Do not claim checks you did not run.');
    }
  }
  if (/\b(research|student)\b/.test(type) || type === 'research') {
    criteria.push('Every factual claim carries its source (URL or document name) inline.');
    criteria.push('Claims you could not verify from a source are explicitly marked as unverified.');
  }
  if (/\b(data|finance|business)\b/.test(type) || type === 'data') {
    criteria.push('Every number in your reply states where it came from (file, command, or dataset).');
  }
  if (/\b(writer|seo|marketing|creator|design)\b/.test(type) || type === 'writer' || type === 'design' || type === 'seo') {
    criteria.push('If your deliverable is a file, its absolute path appears in your final reply; otherwise the full text is in the reply itself.');
  }
  void objective;
  return criteria;
}

/** Render the criteria into the delegation prompt (shown to the specialist). */
export function renderTaskWithCriteria(objective: string, role: string, description: string, criteria: string[]): string {
  return [
    `Work independently on your part of the project. You are one member of a crew led by the user's chosen model.`,
    ``,
    `PROJECT / OBJECTIVE:`,
    objective,
    ``,
    `YOUR ROLE: ${role} — ${description}`,
    ``,
    `DEFINITION OF DONE — your final reply MUST satisfy every one of these, or your work will be sent back for revision:`,
    ...criteria.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `Produce the real artifact now — read files, write files, run what you need. A reply that only DESCRIBES future work fails criterion 1.`,
  ].join('\n');
}

// ── Mechanical verification ────────────────────────────────────────────────

/** Absolute-ish paths mentioned in a result that look like real file claims. */
export function extractClaimedPaths(result: string): string[] {
  const out = new Set<string>();
  // Windows absolute paths and POSIX absolute paths. Space is deliberately
  // NOT in the segment class: it made the match swallow the rest of the
  // sentence ("C:\app\index.ts. Also ..."), so every claim looked missing.
  // Paths with literal spaces must be quoted by the specialist — the sane
  // contract, and under-matching beats falsely failing every delivery.
  const pathRe = /(?:[A-Za-z]:[\\/](?:[\w.@()-]+[\\/]?)+)|(?:\/(?:home|Users|tmp|var|opt)\/(?:[\w.@()-]+\/?)+)/g;
  for (const match of result.matchAll(pathRe)) {
    const candidate = match[0].replace(/[)\].,;'"]+$/g, '').trim();
    if (candidate.length > 4) out.add(candidate);
  }
  return [...out];
}

/**
 * Verify a specialist's deliverable against its acceptance criteria.
 * This is the "agents check each other's work" primitive: file-existence
 * checks catch the most common failure in multi-agent runs — a specialist
 * that *claims* it wrote files it never wrote — before that claim can
 * poison the leader's integration.
 */
export function verifyDeliverable(task: DelegatedTask, cwd: string): VerificationResult {
  const checked: VerificationResult['checked'] = [];
  const reasons: string[] = [];
  const result = task.result ?? '';

  if (!result.trim()) {
    return {
      verdict: 'fail',
      checked: [{ criterion: task.acceptanceCriteria[0] ?? 'produced a result', ok: false, detail: 'empty result' }],
      reasons: ['The specialist returned no result at all.'],
    };
  }

  // Promise-only detection: a result that is entirely about the future.
  const futureOnly = isPromiseOnly(result);
  checked.push({
    criterion: task.acceptanceCriteria[0],
    ok: !futureOnly,
    detail: futureOnly ? 'result reads as a plan, not a delivery' : 'result states delivered work',
  });
  if (futureOnly) reasons.push('The reply describes future work instead of delivering it.');

  // File-claim verification: every claimed path must exist.
  const claimed = extractClaimedPaths(result);
  for (const claim of claimed.slice(0, 20)) {
    const candidate = isAbsolute(claim) ? claim : resolve(cwd, claim);
    const ok = existsSync(candidate);
    checked.push({ criterion: 'Every file named in your reply actually exists on disk at the stated path.', ok, detail: `${claim}${ok ? '' : ' (missing)'}` });
    if (!ok) reasons.push(`Claims file "${claim}" but it does not exist on disk.`);
  }

  const failed = checked.filter((c) => !c.ok);
  // Nothing checkable contradicted the result → unverified is honest (a
  // researcher citing inline sources is verified at review time, not here).
  if (checked.length === 1 && !failed.length && !claimed.length) {
    return { verdict: 'unverified', checked, reasons: [] };
  }
  return {
    verdict: failed.length ? 'fail' : 'pass',
    checked,
    reasons,
  };
}

function isPromiseOnly(text: string): boolean {
  const t = text.trim();
  if (t.length < 24) return false;
  const futureVerbs = /\b(will|going to|next,? (?:i('| a)m? |we )?(?:will|would|plan)|about to|let's |let us )/i;
  const pastEvidence = /\b(created|wrote|wrote to|modified|edited|updated|added|deleted|ran|executed|installed|fixed|verified|output:|result:|path:)\b/i;
  const hasPast = pastEvidence.test(t);
  const hasFuture = futureVerbs.test(t);
  // Only "promise-only" when future language dominates and no delivery evidence exists.
  return hasFuture && !hasPast;
}

/** The revision prompt sent to a specialist whose deliverable failed checks. */
export function renderRevisionRequest(task: DelegatedTask, verification: VerificationResult): string {
  return [
    'Your previous result FAILED MECHANICAL VERIFICATION. Fix it now — do not re-describe, DELIVER.',
    '',
    'FAILED CHECKS:',
    ...verification.reasons.map((r, i) => `${i + 1}. ${r}`),
    '',
    'Your previous reply:',
    task.result.slice(0, 4_000),
    '',
    'DEFINITION OF DONE (unchanged — your revised reply must satisfy every item):',
    ...task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    'Return the corrected, complete delivery.',
  ].join('\n');
}

/** The verification line the leader sees for each member. */
export function renderVerificationLine(task: DelegatedTask): string {
  const v = task.verification;
  if (v.verdict === 'pass') return `[verified] mechanical checks passed (${v.checked.filter((c) => c.ok).length} checked)`;
  if (v.verdict === 'fail') return `[UNVERIFIED — failed checks: ${v.reasons.join('; ').slice(0, 300)}] Treat this output with suspicion; re-check its claims before integrating.`;
  return '[unverified] no mechanical checks applied to this output type';
}

// ── Per-agent memory ────────────────────────────────────────────────────────

export const agentMemoryDataset = (agentType: string): string => `agent:${agentType.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}`;

/** Persist what an agent produced so the next run of the same specialist
 *  type starts with real context instead of a cold start. */
export async function recordAgentWork(agentType: string, role: string, objective: string, result: string, sessionId: string): Promise<void> {
  try {
    const { createMemory } = await import('../memory/store.js');
    const summary = result.replace(/\s+/g, ' ').trim().slice(0, 1_200);
    if (!summary) return;
    createMemory({
      type: 'note',
      tier: 'semantic',
      title: `${role} work: ${objective.slice(0, 80)}`,
      content: summary,
      tags: ['crew', agentType],
      sessionId,
      importance: 0.6,
      dataset: agentMemoryDataset(agentType),
    });
  } catch {
    // Memory is advisory — a recording failure must never fail the crew.
  }
}

/** Recall an agent type's own past work for its system prompt. */
export async function recallAgentMemory(agentType: string, objective: string): Promise<string> {
  try {
    const { recallMemories } = await import('../memory/store.js');
    const hits = recallMemories(objective, { dataset: agentMemoryDataset(agentType), limit: 3 });
    if (!hits.length) return '';
    return [
      `[Your past work as this specialist — recall from earlier sessions]`,
      ...hits.map((m) => `- ${String(m.title ?? '')}: ${String(m.content ?? '').slice(0, 300)}`),
    ].join('\n').slice(0, 1_200);
  } catch {
    return '';
  }
}
