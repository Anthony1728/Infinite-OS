// ─────────────────────────────────────────────────────────────
// Prompt Architect — converts a natural-language objective into a
// compact, high-quality ExecutionBrief. Deterministic, heuristic-driven,
// no extra LLM call. Optimized for clarity and minimality.
// ─────────────────────────────────────────────────────────────

import type { ExecutionBrief, TaskCategory, CapabilityNeed } from './execution-brief.js';
import { decideAutonomy } from './autonomy-policy.js';

type BriefOptions = {
  cwd: string;
  model?: string;
  provider?: string;
  projectHints?: string[]; // known top-level paths in the workspace
};

const CATEGORY_KEYWORDS: Array<{ category: TaskCategory; re: RegExp; capabilities: CapabilityNeed[]; tools: string[]; skills: string[] }> = [
  {
    category: 'coding',
    re: /\b(code|feature|bug|refactor|test|typecheck|implement|component|function|endpoint|api\b|frontend|backend|repo|pr|pull request|typescript|javascript|python|css|html)\b/i,
    capabilities: [{ domain: 'coding', reason: 'Code change, inspection, and validation' }, { domain: 'filesystem', reason: 'Read/write project files' }, { domain: 'terminal', reason: 'Run tests, builds, and checks' }],
    tools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'FileOps', 'Bash', 'Git', 'GitStatus', 'GitDiff', 'TodoWrite', 'BuildFeature'],
    skills: [],
  },
  {
    category: 'web_design',
    re: /\b(website|web\s*app|landing|portfolio|saas|marketing|site|ui\b|ux\b|design|mockup|responsive|hero|navigation|branding)\b/i,
    capabilities: [{ domain: 'web_design', reason: 'Visual design, UX, and responsive layout' }, { domain: 'browser', reason: 'Visual inspection via browser' }, { domain: 'filesystem', reason: 'Project-local web assets' }],
    tools: ['Read', 'Write', 'Edit', 'Glob', 'Bash', 'CreateTab', 'browser_extension', 'WebsiteBuilder', 'AppBuilder', 'ImageEditor', 'ChartGenerator'],
    skills: [],
  },
  {
    category: 'research',
    re: /\b(research|investigate|compare|analysis|report|study|benchmark|market|survey|sources?|evidence|verify|fact.check)\b/i,
    capabilities: [{ domain: 'research', reason: 'Source discovery, retrieval, and synthesis' }],
    tools: ['WebSearch', 'WebFetch', 'Browser', 'Knowledge', 'CreateTab', 'DocumentGenerator'],
    skills: [],
  },
  {
    category: 'computer_automation',
    re: /\b(computer|desktop|window|app\b.*open|click|type|keyboard|mouse|screenshot|clipboard|notification|automate|control this pc)\b/i,
    capabilities: [{ domain: 'computer_automation', reason: 'OS-level control and observation' }, { domain: 'terminal', reason: 'System inspection' }],
    tools: ['Computer', 'Bash', 'System', 'Clipboard', 'ClipboardRead', 'ClipboardWrite', 'Notification', 'CreateTab'],
    skills: [],
  },
  {
    category: 'business',
    re: /\b(business|company|product|market|customer|revenue|pricing|strategy|go.to.market|pitch|investor|sales|saas pricing)\b/i,
    capabilities: [{ domain: 'business', reason: 'Audience, positioning, and economic reasoning' }],
    tools: ['BusinessAdvisor', 'Business', 'WebSearch', 'CreateTab', 'DocumentGenerator', 'ChartGenerator'],
    skills: [],
  },
  {
    category: 'file_operation',
    re: /\b(file|folder|directory|move|copy|rename|archive|organize|organise|batch rename|convert|extract|import|export)\b/i,
    capabilities: [{ domain: 'file_operation', reason: 'Filesystem organization and bulk operations' }],
    tools: ['Read', 'Glob', 'Grep', 'FileOps', 'Delete', 'Bash', 'TodoWrite'],
    skills: [],
  },
];

function classify(text: string): { primary: TaskCategory; secondaries: TaskCategory[] } {
  const hits = CATEGORY_KEYWORDS.filter((k) => k.re.test(text)).map((k) => k.category);
  if (hits.length === 0) return { primary: 'general', secondaries: [] };
  const [primary, ...rest] = hits;
  return { primary, secondaries: rest.slice(0, 2) };
}

function capabilitiesFor(categories: TaskCategory[]): CapabilityNeed[] {
  const byDomain = new Map<string, CapabilityNeed>();
  for (const cat of categories) {
    const entry = CATEGORY_KEYWORDS.find((k) => k.category === cat);
    if (!entry) continue;
    for (const cap of entry.capabilities) {
      if (!byDomain.has(cap.domain)) byDomain.set(cap.domain, cap);
    }
  }
  return [...byDomain.values()];
}

function toolsFor(categories: TaskCategory[]): string[] {
  const s = new Set<string>();
  for (const cat of categories) {
    const entry = CATEGORY_KEYWORDS.find((k) => k.category === cat);
    entry?.tools.forEach((t) => s.add(t));
  }
  // Always useful
  s.add('TodoWrite');
  s.add('Knowledge');
  s.add('Bash');
  s.add('Read');
  return [...s];
}

function relevantPathsFor(text: string, categories: TaskCategory[], projectHints: string[]): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  const add = (p: string) => { if (!hits.includes(p)) hits.push(p); };
  if (projectHints.length) projectHints.slice(0, 8).forEach(add);
  if (/infinite\s*os/i.test(lower)) add('./');
  if (/\bwebsite|landing|portfolio\b/i.test(lower)) { add('src/renderer'); add('src/renderer/components'); }
  if (/\bbusiness|contacts?|leads?|invoices?|deals?\b/i.test(lower)) add('src/main/business');
  if (/\bautomation|cron|workflow\b/i.test(lower)) add('src/main/automation');
  if (/\b(browser|extension|chrome)\b/i.test(lower)) { add('src/main/bridge'); add('src/main/agent/browser-routing.ts'); }
  if (categories.includes('coding')) { add('src/main'); add('src/renderer'); }
  return hits.slice(0, 6);
}

export function architectBrief(objective: string, opts: BriefOptions): ExecutionBrief {
  const trimmed = objective.trim();
  // Distill to a single clean sentence (first sentence or first 160 chars)
  const distilled = trimmed.split(/[.!?\n]/)[0]?.trim().slice(0, 160) || trimmed.slice(0, 160);
  const { primary, secondaries } = classify(trimmed);
  const allCats: TaskCategory[] = [primary, ...secondaries];
  const capabilities = capabilitiesFor(allCats);
  const toolHints = toolsFor(allCats);
  const projectHints = opts.projectHints ?? [];

  const constraints: string[] = [
    'Preserve existing functionality and architecture; make minimal, focused changes.',
    'Avoid unnecessary dependencies.',
    'Keep the result responsive, performant, and accessible where a UI is involved.',
  ];
  // Category-specific constraint
  if (primary === 'web_design') constraints.push('Respect the existing design system and component patterns.');
  if (primary === 'business') constraints.push('Separate assumptions from verified facts; state risks explicitly.');

  const successCriteria: string[] = [];
  if (primary === 'coding') successCriteria.push('Compiles/builds without new errors', 'Relevant tests pass or no new regressions', 'Change is focused and does not break neighbors');
  else if (primary === 'web_design') successCriteria.push('Visual result matches the objective', 'Responsive across breakpoints', 'No console errors, no broken resources', 'Accessible: keyboard + semantics');
  else if (primary === 'research') successCriteria.push('Key questions are addressed with sourced evidence', 'Conflicts and uncertainties are called out', 'Citations link to real sources', 'Separate facts from conclusions');
  else if (primary === 'computer_automation') successCriteria.push('Observable system state matches the requested outcome', 'No stray side effects left behind', 'Failure leaves a clear, actionable report');
  else if (primary === 'business') successCriteria.push('Recommendation is specific and actionable', 'Audience and trade-offs are stated', 'Next steps are concrete');
  else if (primary === 'file_operation') successCriteria.push('Correct files in correct locations', 'No unintended deletions or overwrites', 'Structure matches the stated goal');
  else successCriteria.push('Result demonstrably satisfies the stated objective', 'No obvious errors or regressions', 'User can use or verify the outcome immediately');

  const risks: ExecutionBrief['risks'] = [];
  if (primary === 'coding') risks.push({ risk: 'Assumed repo layout is wrong', mitigation: 'Glob/Read to confirm before editing' });
  if (primary === 'web_design') risks.push({ risk: 'Design overlaps unknown component contract', mitigation: 'Read neighboring components first' });
  if (primary === 'research') risks.push({ risk: 'Stale or conflicting sources', mitigation: 'Cross-check and cite with dates' });
  if (/delete|remove|trash|publish|send|purchase|payment/i.test(trimmed)) risks.push({ risk: 'Irreversible or external side effect', mitigation: 'Confirm scope before executing' });

  const strategy: string[] = [];
  if (primary === 'coding') strategy.push('Inspect project and relevant files', 'Plan the smallest correct change (TodoWrite for multi-step)', 'Implement the change', 'Run typecheck/tests/build and fix failures', 'Verify the running artifact and report what changed');
  else if (primary === 'web_design') strategy.push('Inspect the current site and design system', 'Draft a focused visual plan', 'Implement components and styles', 'Verify in a live preview (screenshot / interactive inspection)', 'Polish, check responsiveness/accessibility, and re-verify');
  else if (primary === 'research') strategy.push('Define research questions and success bar', 'Search and retrieve authoritative sources', 'Cross-check, synthesize, and separate facts from interpretation', 'Produce a structured brief with links', 'Re-check claims and tighten where needed');
  else if (primary === 'computer_automation') strategy.push('Observe current state', 'Construct the minimal action sequence', 'Execute step by step with observation after each', 'Verify the end state matches the objective', 'Correct and retry on failure');
  else if (primary === 'business') strategy.push('Clarify objective and audience', 'Gather relevant evidence / prior decisions', 'Enumerate options with assumptions and risks', 'Choose and justify a recommendation', 'List concrete next steps');
  else strategy.push('Understand the objective and its success bar', 'Choose the narrowest capable tools', 'Execute the smallest correct sequence', 'Observe and verify the result', 'Correct if needed and finalize');

  const relevantPaths = relevantPathsFor(trimmed, allCats, projectHints);

  // Cheap autonomy estimate: if the objective reads destructive/external, escalate
  const probeTier = decideAutonomy({ type: 'tool_use', id: 'arch-probe', name: 'Bash', input: { command: trimmed } } as never, opts.cwd).tier;
  // Distill to brief-level tier conservatively
  const riskTier: ExecutionBrief['riskTier'] =
    /delete|destroy|trash|format|remove\s+-rf|publish|deploy\s+prod|send\s+email|purchase|payment/i.test(trimmed) ? 'confirm'
    : probeTier === 'block' ? 'confirm'
    : 'auto';

  const skillHints: string[] = [];
  const lower = trimmed.toLowerCase();
  if (primary === 'coding' && /\b(audit|fix|stabilize)\b/.test(lower)) skillHints.push('self-improvement');
  if (primary === 'research') skillHints.push('research-brief');
  if (primary === 'web_design') skillHints.push('ui-design');

  const summary = `${distilled} [${primary}${secondaries.length ? '+' + secondaries.join('+') : ''}] — ${strategy.length} phases, ${toolHints.length} tools, ${successCriteria.length} criteria.`;

  return {
    id: crypto.randomUUID(),
    objective: trimmed,
    distilled,
    category: primary,
    secondaryCategories: secondaries,
    capabilities,
    toolHints,
    skillHints,
    constraints,
    successCriteria,
    dependencies: relevantPaths.length ? [`Relevant area: ${relevantPaths.join(', ')}`] : [],
    strategy,
    risks,
    relevantPaths,
    summary,
    riskTier,
  };
}
