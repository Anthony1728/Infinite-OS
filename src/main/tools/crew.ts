// The `Crew` tool — the agent recruits a multi-agent, multi-model crew for a
// big domain-spanning project. The user's leader model stays in charge; each
// specialist is auto-assigned the best fitting model from every configured
// provider key (OpenRouter + NVIDIA + Groq + ...). Falls back gracefully.

import type { Tool, ToolResult } from './base.js';
import { buildCrewPlan, runCrew, getCrewRun } from '../agent/crew.js';
import { providerRegistry } from '../providers/registry.js';
import { getApiKey } from '../settings/secrets.js';
import { listProviders } from '../providers/registry.js';

export const crewTool: Tool = {
  name: 'Crew',
  description: [
    'Recruit a crew of specialist agents that work together on a large, multi-domain project, with each specialist auto-assigned its own best-fit model from every provider key the user has configured (OpenRouter, NVIDIA, Groq, etc). The user\'s selected model remains the LEADER and integrates everything at the end.',
    'Use ONLY for genuinely large, multi-domain projects (build + design + research + data, full apps with UI, multi-part deliverables). For a single focused task use the Agent tool instead.',
    'Members are chosen by the task: coding, design, research, data, seo/marketing, writer, tester, devops, automation. Passing `agents` forces a specific roster.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The full project description. This is what the leader will verify against at the end.' },
      agents: {
        type: 'array',
        description: 'Optional: force specific specialist agents (code, design, research, data, seo, writer, tester, security, devops, automation). Omitted to auto-select from the task.',
        items: { type: 'string' },
      },
    },
    required: ['task'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { task, agents } = args as { task: string; agents?: string[] };
    if (!task?.trim()) return { content: 'Crew requires a task.', is_error: true };

    // Inherit the leader model from the parent session.
    const { loadSessionMeta } = await import('../session/store.js');
    const meta = await loadSessionMeta(ctx.sessionId);
    const leaderProvider = meta?.provider ?? 'openrouter';
    const leaderModel = meta?.model ?? 'meta-llama/llama-3.3-70b-instruct:free';

    // All provider keys the user has configured.
    const available = new Map<string, { apiKey?: string; baseUrl?: string }>();
    for (const p of listProviders()) {
      const key = await getApiKey(p.id).catch(() => undefined);
      if (key) available.set(p.id, { apiKey: key });
    }
    if (leaderProvider && !available.has(leaderProvider)) {
      available.set(leaderProvider, { apiKey: await getApiKey(leaderProvider).catch(() => undefined) });
    }

    let leaderFree = false;
    try {
      const adapter = providerRegistry[leaderProvider];
      leaderFree = adapter?.freeModels.some((m) => m.id === leaderModel && m.free) ?? false;
    } catch { /* best effort */ }

    const plan = buildCrewPlan(
      task,
      { provider: leaderProvider, model: leaderModel, free: leaderFree },
      available,
      agents?.length ? agents : undefined,
    );

    let progress = 0;
    const result = await runCrew(plan, {
      prompt: task,
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      parentHistory: [],
      sink: (ev) => {
        if (ev.type === 'crew_member_progress' || ev.type === 'crew_member_completed') {
          progress = Math.min(progress + 1, 100);
          const detail = (ev.data as { memberId?: string; agentEvent?: string }) || {};
          ctx.onUpdate({ content: `Crew ${detail.memberId ?? ''} ${detail.agentEvent ?? ''}` });
        }
      },
    });

    if (!result.report) return { content: 'Crew run produced no report.', is_error: true };

    const lines = [
      `Crew complete (${plan.strategy}):`,
      `- Leader: ${leaderProvider}/${leaderModel}`,
      ...plan.members.map((m) => `- ${m.role}: ${m.assignment.provider}/${m.assignment.model} → ${m.status}`),
      '',
      result.report.fallbacks.length ? `Model fallbacks used:\n${result.report.fallbacks.map((f) => `- ${f}`).join('\n')}\n` : '',
      result.report.leaderResult,
    ].filter(Boolean);
    return { content: lines.join('\n') };
  },
};

export function getCrewRunById(id: string) {
  return getCrewRun(id);
}
