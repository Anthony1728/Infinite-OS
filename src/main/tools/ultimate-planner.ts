import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Universal Task Planner — the Hermes-beating "Goal → Requirements → Plan → Subtasks → Verification" engine.
 * Hermes plans per-task; Infinite OS plans with hardware-aware agent assignment and
 * verification built-in, so the output is directly executable via Batch/Sandbox.
 */
interface PlannerArgs {
  goal: string;
  constraints?: string;
  context?: string;
}

export const ultimatePlannerTool: Tool = {
  name: 'UltimatePlanner',
  description:
    'Decompose any legitimate goal into requirements, a phased plan, subtasks with agent/tool assignment, and verification steps. Input a free-form goal ("build a landing page with auth and deploy it"), get a structured plan you can execute with Batch. Hermes planning is per-agent; Infinite OS plans once, assigns the General agent by default (best at everything) and specialists only when measurably better, with verification always included.',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'The user objective in natural language — be specific' },
      constraints: { type: 'string', description: 'Optional constraints: deadline, stack, budget, privacy' },
      context: { type: 'string', description: 'Optional project context: repo path, existing files, prior decisions' },
    },
    required: ['goal'],
  },
  permission: 'allow',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as PlannerArgs;
    const goal = a.goal.trim();
    if (!goal) return { content: 'UltimatePlanner requires goal.', is_error: true };

    // Heuristic classification — fast, deterministic, no model call, so the planner itself is instant
    const isCode = /\b(code|repo|file|function|class|api|typescript|javascript|python|bug|refactor|test|build|commit|git)\b/i.test(goal);
    const isWeb = /\b(website|landing page|dashboard|app|ui|frontend|design|css|html)\b/i.test(goal);
    const isResearch = /\b(research|investigate|compare|market|literature|sources|citation)\b/i.test(goal);
    const isData = /\b(data|csv|json|sql|excel|chart|analysis|etl)\b/i.test(goal);
    const isAutomation = /\b(automate|schedule|workflow|cron|webhook|bot)\b/i.test(goal);
    const isBrowser = /\b(browser|scrape|crawl|click|fill|extract|monitor)\b/i.test(goal);

    const requirements: string[] = [];
    if (isCode) requirements.push('Inspect repo (Glob/Grep/Read) before editing');
    if (isWeb) requirements.push('Design system + responsive layout, accessible contrast');
    if (isResearch) requirements.push('Multi-source search, primary-source verification, citations');
    if (isData) requirements.push('Profile schema, validate row counts, show intermediate results');
    if (isAutomation) requirements.push('Trigger → Condition → Action → Verification → Notification');
    if (isBrowser) requirements.push('Observe before act (visual_observe), verify after each interaction');
    requirements.push('Permission check before destructive/network actions');
    requirements.push('Verification: tests/build/typecheck or visual confirmation');

    const phases = [
      { name: 'Phase 1 — Inspect', detail: 'Read project, list files, note conventions, capture baseline metrics.' },
      { name: 'Phase 2 — Plan', detail: 'This plan. No code yet — just the sequence and verification criteria.' },
      { name: 'Phase 3 — Build', detail: isCode ? 'Edit smallest precise files, create new files with Write, follow existing style.' : isWeb ? 'Build components, wire state, add preview.' : 'Execute the core creation step.' },
      { name: 'Phase 4 — Verify', detail: isCode || isWeb ? 'Run npm run typecheck && npm run test && npm run build; fix what they reveal.' : 'Verify output matches goal: screenshots, row counts, or manual checks.' },
      { name: 'Phase 5 — Harden', detail: 'Checkpoint, add a reusable Skill via SkillManage if the workflow is repeatable.' },
    ];

    const subtasks: Array<{ title: string; agent: string; tools: string; verify: string }> = [];
    subtasks.push({ title: 'Scope & context capture', agent: 'General (best — handles any)', tools: 'Read, Glob, Grep, Bash ls', verify: 'List 3-5 existing files + their purpose' });
    if (isResearch) subtasks.push({ title: 'Deep research', agent: 'General as analyst', tools: 'WebSearch, WebFetch, Browser', verify: '≥3 primary sources with URLs' });
    if (isCode || isWeb || isData) subtasks.push({ title: 'Implementation', agent: 'General as engineer', tools: 'TodoWrite → Edit/Write → Bash', verify: 'Files changed + diff' });
    if (isBrowser) subtasks.push({ title: 'Browser/computer automation', agent: 'General as operator', tools: 'Browser/Computer visual_observe → visual_click → screenshot', verify: 'Before/after screenshots' });
    if (isAutomation) subtasks.push({ title: 'Automation', agent: 'General', tools: 'Automation, Batch', verify: 'Trigger fires, logs show success' });
    if (isData) subtasks.push({ title: 'Data delivery', agent: 'General as analyst', tools: 'Bash python, ChartGenerator, DocumentGenerator', verify: 'CSV/Chart row counts' });
    subtasks.push({ title: 'Verification & handoff', agent: 'General', tools: 'Bash npm run typecheck/test, Sandbox if risky', verify: 'All checks pass, final summary with file list' });

    const constraints = a.constraints ? `\nConstraints: ${a.constraints}` : '';
    const context = a.context ? `\nContext: ${a.context}` : '';

    const out = [
      `# Ultimate Plan — Infinite OS`,
      ``,
      `**Goal:** ${goal}${constraints}${context}`,
      ``,
      `**Requirements**`,
      ...requirements.map((r) => `- ${r}`),
      ``,
      `**Phased Plan**`,
      ...phases.map((p, i) => `${i + 1}. **${p.name}** — ${p.detail}`),
      ``,
      `**Subtasks (agent + tools + verification)**`,
      ...subtasks.map((s, i) => `${i + 1}. ${s.title} — *${s.agent}* — \`${s.tools}\` → verify: ${s.verify}`),
      ``,
      `**Execution hint:** Feed the subtasks to Batch (parallel where independent) or let the General agent run them sequentially. General is best at everything — leave it on General unless a step is clearly specialist and measurable.`,
      ``,
      `Ready to execute — no tool has run yet. Say "go" to start Phase 1.`,
    ].join('\n');

    return { content: out };
  },
};
