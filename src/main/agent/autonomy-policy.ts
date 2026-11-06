// ─────────────────────────────────────────────────────────────
// Autonomy Policy — "Have the authority to act, but decide if you should."
// Classifies every tool-use intent into a risk tier that decides whether
// the agent may proceed autonomously or must request confirmation.
// Low-risk work proceeds without pausing. High-impact work pauses.
// ─────────────────────────────────────────────────────────────

import type { ContentBlock } from '../../shared/types.js';
import type { RiskTier } from './execution-brief.js';

export interface AutonomyDecision {
  tier: RiskTier;
  reason: string;
  /** Concrete safer alternative if the original is confirm/block */
  alternative?: string;
}

type ToolUse = Extract<ContentBlock, { type: 'tool_use' }>;

// Patterns that are inherently high-impact and need explicit user consent.
const HIGH_IMPACT_PATTERNS: Array<{ test: (tu: ToolUse) => boolean; reason: string; alternative?: string }> = [
  {
    // Destructive file ops outside /tmp
    test: (tu) => tu.name === 'Delete' || (tu.name === 'FileOps' && /delete|remove|trash/i.test(JSON.stringify(tu.input))),
    reason: 'Permanent deletion is irreversible. Confirm scope and whether a backup is wanted.',
    alternative: 'Move to a backup folder instead of deleting, then re-confirm deletion.',
  },
  {
    // External communication
    test: (tu) => tu.name === 'Email',
    reason: 'Sends a message to an external person — user should confirm recipient and content.',
  },
  {
    // Publishing / deploying publicly
    test: (tu) => tu.name === 'GitPush' || tu.name === 'Deploy',
    reason: 'Publishes code or an artifact publicly.',
  },
  {
    // Financial / account side effects
    test: (tu) => {
      const cmd = (tu.input as { command?: string }).command ?? '';
      return /purchase|payment|billing|subscribe|checkout/i.test(cmd);
    },
    reason: 'Potential financial consequence — needs confirmation.',
  },
  {
    // System security settings
    test: (tu) => {
      if (tu.name !== 'Bash' && tu.name !== 'System') return false;
      const cmd = (tu.input as Record<string, unknown>).command as string | undefined ?? '';
      return /(net\s+user\s+\/add|\breg\s+add|\bSet-MpPreference|\bfirewall|defender\s+disable|uac\s+disable)/i.test(cmd);
    },
    reason: 'Modifies account or security settings.',
  },
  {
    // Mass file change outside workspace (broad replace_all outside cwd)
    test: (tu) => {
      if (tu.name !== 'Edit') return false;
      const input = tu.input as { file_path?: string; replace_all?: boolean };
      return !!input.replace_all && /\.\.|C:\\/i.test(input.file_path ?? '');
    },
    reason: 'Broad replacement across many files outside the project.',
  },
];

// Low-risk tools that almost always proceed autonomously
const LOW_RISK_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'Knowledge', 'TodoWrite',
  'WebSearch', 'WebFetch', 'Browser', 'System',
  'Time', 'Timer', 'Math', 'Text', 'Json', 'Crypto',
  'DocumentGenerator', 'ChartGenerator', 'ImageEditor', 'Calendar',
  'AppBuilder', 'WebsiteBuilder', 'Teach', 'Skills', 'SkillManage',
  'GitStatus', 'GitLog', 'GitDiff', 'GitBranch', 'Git',
  'CreateTab', 'Bash', // Bash is nuanced — checked separately below for destructive commands
]);

/** Destructive, irreversible shell commands (rm -rf /, format C:, DROP TABLE…).
 * Exported so the tool-execution gate can ENFORCE this rather than leave it to
 * the advisory autonomy estimate — a match here is a hard stop, never a
 * downgraded-to-confirm suggestion. */
export function isDestructiveBash(input: unknown): boolean {
  const cmd = (input as { command?: string }).command ?? '';
  return /(\brm\s+-rf\s+\/$|\bformat\s+[A-Z]:|\bdel\s+\/[sS]\b|\bRemove-Item\b.*-Recurse\s+-Force|\bDROP\s+TABLE|\bTRUNCATE\s)/i.test(cmd);
}

function isBashHighRisk(tu: ToolUse): boolean {
  return isDestructiveBash(tu.input);
}

export function decideAutonomy(tu: ToolUse, cwd: string): AutonomyDecision {
  void cwd;

  // Check high-impact patterns first
  for (const rule of HIGH_IMPACT_PATTERNS) {
    if (rule.test(tu)) {
      return { tier: 'confirm', reason: rule.reason, alternative: rule.alternative };
    }
  }

  // Destructive bash specifically
  if ((tu.name === 'Bash' || (tu.input as Record<string, unknown>).command) && isBashHighRisk(tu)) {
    return { tier: 'block', reason: 'Destructive low-level command blocked. Use a safer, scoped alternative.' };
  }

  // Write/Edit inside workspace: auto
  if (tu.name === 'Write' || tu.name === 'Edit' || tu.name === 'Bash') {
    return { tier: 'auto', reason: 'Scoped project edit / routine command.' };
  }

  if (LOW_RISK_TOOLS.has(tu.name)) {
    return { tier: 'auto', reason: 'Low-risk autonomous action.' };
  }

  // Default: allow but flag for logging
  return { tier: 'auto', reason: 'No high-impact signal; proceeding autonomously.' };
}

/** Prompt fragment injected alongside the execution brief so the model knows its autonomy envelope. */
export function autonomyPolicyPrompt(tier: RiskTier): string {
  switch (tier) {
    case 'auto':
      return 'Autonomy: you are fully authorized to act end-to-end for this objective. Proceed through observe→verify→correct without pausing. Only pause if you would hit a high-impact action not in this plan.';
    case 'confirm':
      return 'Autonomy: this objective touches a high-impact surface (external communication, publishing, deletion, billing, or security). When you reach that step, pause, state what you will do, why, and the consequence, then request confirmation before executing it.';
    case 'block':
      return 'Autonomy: this objective is currently blocked by policy (destructive scope). Re-plan to a safer, reversible approach and explain what you changed.';
  }
}
