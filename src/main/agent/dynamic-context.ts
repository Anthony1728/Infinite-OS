// ─────────────────────────────────────────────────────────────
// Dynamic Context Assembly — §3 of the spec.
// Builds the smallest high-quality working context for the current brief.
// Replaces the old "load everything into every prompt" approach.
// Current context = CORE IDENTITY + RELEVANT SKILLS + RELEVANT TOOLS
//                  + PROJECT CONTEXT + RELEVANT MEMORY + OBJECTIVE
//                  + SYSTEM STATE + EXECUTION BRIEF + AUTONOMY POLICY
// ─────────────────────────────────────────────────────────────

import type { ExecutionBrief } from './execution-brief.js';
import { autonomyPolicyPrompt } from './autonomy-policy.js';

export interface DynamicContextOptions {
  cwd: string;
  brief: ExecutionBrief;
  /** Full system prompt up to tool-catalog (already built by context.ts) */
  baseSystem: string;
  /** Already-present INFINITE.md text (if any), to avoid re-reading */
  projectInstructions?: string;
  /** Compact skills catalog line (if needed) */
  skillsCatalogLine?: string;
  /** Bounded memory recall line (if any) */
  memoryLine?: string;
  /** Bounded system-state line (if any) */
  systemStateLine?: string;
}

const MAX_OBJECTIVE_CHARS = 600;
const MAX_BRIEF_CHARS = 2600;

/** Render the execution brief as a compact markdown block for prompt injection. */
export function renderDynamicBriefBlock(brief: ExecutionBrief): string {
  const lines: string[] = [];
  lines.push('# Task — Execution Brief');
  lines.push(`Objective: ${brief.objective.slice(0, MAX_OBJECTIVE_CHARS)}`);
  if (brief.distilled !== brief.objective) lines.push(`Distilled: ${brief.distilled}`);
  lines.push(`Category: ${brief.category}${brief.secondaryCategories.length ? ' (also: ' + brief.secondaryCategories.join(', ') + ')' : ''}`);
  if (brief.capabilities.length) lines.push(`Capabilities: ${brief.capabilities.map((c) => `${c.domain} — ${c.reason}`).join('; ')}`);
  if (brief.toolHints.length) lines.push(`Suggested tools: ${brief.toolHints.join(', ')}`);
  if (brief.skillHints.length) lines.push(`Suggested skills: ${brief.skillHints.join(', ')}`);
  lines.push(`Success criteria:`);
  for (const c of brief.successCriteria) lines.push(`- ${c}`);
  lines.push(`Strategy:`);
  for (let i = 0; i < brief.strategy.length; i++) lines.push(`${i + 1}. ${brief.strategy[i]}`);
  if (brief.constraints.length) {
    lines.push(`Constraints:`);
    for (const c of brief.constraints) lines.push(`- ${c}`);
  }
  if (brief.dependencies.length) {
    lines.push(`Dependencies:`);
    for (const d of brief.dependencies) lines.push(`- ${d}`);
  }
  if (brief.risks.length) {
    lines.push(`Risks:`);
    for (const r of brief.risks) lines.push(`- ${r.risk} → ${r.mitigation}`);
  }
  if (brief.relevantPaths.length) lines.push(`Relevant areas: ${brief.relevantPaths.join(', ')}`);
  lines.push(`Autonomy: ${autonomyPolicyPrompt(brief.riskTier)}`);
  const block = lines.join('\n');
  return block.length > MAX_BRIEF_CHARS ? block.slice(0, MAX_BRIEF_CHARS) + '\n…(brief truncated for brevity)' : block;
}

/** Select only INFINITE.md / AUTO MEMORY / SKILLS entries that are relevant to the brief. */
export function filterProjectContext(
  memories: Array<{ path: string; content: string }>,
  brief: ExecutionBrief,
): Array<{ path: string; content: string }> {
  // For now: return all; the per-CWD discoverMemory is already bounded (4 files).
  // This hook exists so future keyword-scoring can shrink it further per category.
  void brief;
  return memories;
}

/** Decide whether a skill entry should be surfaced in the prompt for this brief. */
export function isSkillRelevant(skillName: string, _category: string, brief: ExecutionBrief): boolean {
  const haystack = `${brief.objective} ${brief.category} ${brief.toolHints.join(' ')}`.toLowerCase();
  const name = skillName.toLowerCase();
  // Always surface skills the brief explicitly requested
  if (brief.skillHints.some((h) => h.toLowerCase() === name)) return true;
  // Otherwise: direct keyword hit or sufficiently general skill
  if (haystack.includes(name.split(/[-_]/)[0] ?? '')) return true;
  // Prefix-based general skills (e.g. "coding-standards") match category
  if (brief.category === 'coding' && /code|lint|test|ts|python|javascript/.test(name)) return true;
  if (brief.category === 'web_design' && /design|ui|component|style|css/.test(name)) return true;
  if (brief.category === 'research' && /research|citation|source|web/.test(name)) return true;
  if (brief.category === 'computer_automation' && /computer|automation|desktop|browser|pc/.test(name)) return true;
  return false;
}
