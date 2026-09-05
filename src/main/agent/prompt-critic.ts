// ─────────────────────────────────────────────────────────────
// Prompt Critic — reviews an ExecutionBrief before execution.
// Goal: smallest high-quality context that reliably achieves the objective.
// No extra LLM call; deterministic checklist mirroring section 8 of the spec.
// ─────────────────────────────────────────────────────────────

import type { ExecutionBrief } from './execution-brief.js';

export type CriticIssue = {
  severity: 'block' | 'warn' | 'info';
  message: string;
  fix: string;
};

export type CriticReport = {
  ok: boolean;
  issues: CriticIssue[];
  /** Patch to merge into the brief (only fields the critic changed) */
  patch: Partial<ExecutionBrief>;
  /** One-line verdict for logs */
  verdict: string;
};

const MAX_TOOLS = 16;
const MAX_PATHS = 6;

export function critiqueBrief(brief: ExecutionBrief): CriticReport {
  const issues: CriticIssue[] = [];
  const patch: Partial<ExecutionBrief> = {};

  const objective = brief.objective.trim();
  if (!objective) {
    issues.push({ severity: 'block', message: 'Objective is empty.', fix: 'Require a non-empty objective.' });
    return { ok: false, issues, patch, verdict: 'blocked: empty objective' };
  }

  // Objective understood?
  if (objective.split(/\s+/).length < 3) {
    issues.push({ severity: 'warn', message: 'Objective is very short — may be ambiguous.', fix: 'If execution seems directionless, request a brief clarification or make the smallest useful assumption and proceed.' });
  }

  // Success criteria measurable?
  if (!brief.successCriteria.length) {
    issues.push({ severity: 'warn', message: 'No success criteria.', fix: 'Derive at least 2 observable criteria from the objective.' });
  }

  // Tools available and not over-included?
  if (brief.toolHints.length > MAX_TOOLS) {
    const trimmed = brief.toolHints.slice(0, MAX_TOOLS);
    patch.toolHints = trimmed;
    issues.push({ severity: 'info', message: `Too many tool hints (${brief.toolHints.length}). Trimmed to ${MAX_TOOLS} to keep context focused.`, fix: `Kept: ${trimmed.join(', ')}` });
  }
  if (brief.toolHints.length === 0) {
    issues.push({ severity: 'warn', message: 'No tool hints selected.', fix: 'Attach at least Read/Bash/TodoWrite so the agent can inspect and act.' });
    patch.toolHints = ['Read', 'Bash', 'TodoWrite'];
  }

  // Relevant paths not excessive?
  if (brief.relevantPaths.length > MAX_PATHS) {
    patch.relevantPaths = brief.relevantPaths.slice(0, MAX_PATHS);
    issues.push({ severity: 'info', message: `Relevant paths trimmed to ${MAX_PATHS}.`, fix: 'Kept the most specific entries.' });
  }

  // Contradictory requirements — cheap heuristic
  if (/delete.*preserve|remove.*keep|destroy.*retain/i.test(objective)) {
    issues.push({ severity: 'warn', message: 'Contradictory verbs in objective (delete vs preserve).', fix: 'Resolve intent before destructive execution; default to non-destructive.' });
  }

  // Dependencies understood?
  if (!brief.dependencies.length && /build|deploy|publish|release|migrate/i.test(objective)) {
    issues.push({ severity: 'info', message: 'Likely has build/deploy dependencies not yet spelled out.', fix: 'Inspect project layout before assuming paths.' });
  }

  // Edge cases considered?
  if (!brief.risks.length && /production|prod|live|billing|payment|security/i.test(objective)) {
    issues.push({ severity: 'warn', message: 'High-stakes keyword but no risks listed.', fix: 'Add an explicit risk/mitigation entry before proceeding.' });
  }

  // Plan unnecessarily complicated?
  if (brief.strategy.length > 6) {
    patch.strategy = brief.strategy.slice(0, 6);
    issues.push({ severity: 'info', message: 'Strategy has many phases — compressed to the essential 6.', fix: 'Favor fewer, reversible phases.' });
  }
  if (brief.strategy.length === 0) {
    patch.strategy = ['Understand and distill the objective', 'Inspect relevant context', 'Execute the smallest correct sequence', 'Observe and verify', 'Correct if needed and finalize'];
    issues.push({ severity: 'warn', message: 'No strategy steps.', fix: 'Inserted a minimal default strategy.' });
  }

  // Safer approach?
  if (brief.riskTier === 'confirm' && !brief.constraints.some((c) => /confirm|backup|dry.run|reversible/i.test(c))) {
    const constraints = [...brief.constraints, 'For high-impact steps, confirm scope and prefer reversible actions (backup, dry-run, staged publish).'];
    patch.constraints = constraints;
    issues.push({ severity: 'info', message: 'Risk tier is "confirm" but constraints lack a confirmation/reversibility note.', fix: 'Added a reversibility constraint.' });
  }

  const blockCount = issues.filter((i) => i.severity === 'block').length;
  const warnCount = issues.filter((i) => i.severity === 'warn').length;
  const ok = blockCount === 0;
  const verdict = !ok ? `blocked (${blockCount})`
    : warnCount ? `ok with ${warnCount} warning(s), ${issues.length - warnCount} note(s)`
    : issues.length ? `ok with ${issues.length} note(s)`
    : 'ok';

  return { ok, issues, patch, verdict };
}

export function applyPatch(brief: ExecutionBrief, patch: Partial<ExecutionBrief>): ExecutionBrief {
  if (!Object.keys(patch).length) return brief;
  return { ...brief, ...patch };
}
