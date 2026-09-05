// ─────────────────────────────────────────────────────────────
// Execution Brief — the task-specific prompt the agent generates for itself.
// Produced by Prompt Architect, reviewed by Prompt Critic, consumed by the loop.
// Keeps the core identity small and stable; per-task detail lives here.
// ─────────────────────────────────────────────────────────────

export type TaskCategory =
  | 'coding'
  | 'web_design'
  | 'research'
  | 'computer_automation'
  | 'business'
  | 'file_operation'
  | 'general';

export type RiskTier = 'auto' | 'confirm' | 'block';

export interface CapabilityNeed {
  /** Capability domain, e.g. "coding", "browser", "terminal", "filesystem" */
  domain: string;
  /** Why it is needed for this objective */
  reason: string;
}

export interface ExecutionBrief {
  /** Stable id for this brief (ties to the agent turn) */
  id: string;
  /** Raw user objective verbatim */
  objective: string;
  /** 1-2 sentence distilled objective */
  distilled: string;
  /** Primary task category */
  category: TaskCategory;
  /** Secondary categories if the task spans domains */
  secondaryCategories: TaskCategory[];
  /** Capability domains + tool hints the task needs (drives tool filtering + context load) */
  capabilities: CapabilityNeed[];
  /** Explicit tool names the brief recommends attaching this turn */
  toolHints: string[];
  /** Skill ids the brief recommends loading */
  skillHints: string[];
  /** What must remain untouched / preserved */
  constraints: string[];
  /** Concrete, observable success criteria */
  successCriteria: string[];
  /** Dependencies / ordering assumptions */
  dependencies: string[];
  /** Most efficient action outline (1-8 high-level phases, each 1 sentence) */
  strategy: string[];
  /** Likely failure modes + mitigation hint */
  risks: Array<{ risk: string; mitigation: string }>;
  /** Project files / directories worth pre-loading context for */
  relevantPaths: string[];
  /** Short human-readable summary (for UI / logs) */
  summary: string;
  /** Autonomy tier for this execution */
  riskTier: RiskTier;
}

export function emptyBrief(objective: string): ExecutionBrief {
  return {
    id: crypto.randomUUID(),
    objective,
    distilled: objective,
    category: 'general',
    secondaryCategories: [],
    capabilities: [],
    toolHints: [],
    skillHints: [],
    constraints: [],
    successCriteria: [],
    dependencies: [],
    strategy: [],
    risks: [],
    relevantPaths: [],
    summary: '',
    riskTier: 'auto',
  };
}
