// The `Agent` tool — the main agent uses this to spawn a subagent
// for a specific task. The subagent runs in isolation with its own
// context, allowed tools, and model.

import type { Tool, ToolResult } from './base.js';
import { spawnSubagent, listRunStates } from '../agent/runtime.js';
import { listAgents } from '../agents/registry.js';
import type { AgentId } from '../agents/types.js';

export const agent: Tool = {
  name: 'Agent',
  description: [
    'Spawn a specialised subagent to handle a focused task in isolation.',
    'The subagent gets its own context, tool restrictions, and report.',
    'Use this for parallelisable or specialised work like research, code edits, design, data analysis, or SEO audits.',
    'When delegating, the main agent should clearly describe the task in `prompt` and trust the subagent to handle it.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        enum: ['research', 'code', 'design', 'data', 'seo', 'general'],
        description: 'The type of subagent to spawn. Determines system prompt, tools, and behaviour.',
      },
      prompt: { type: 'string', description: 'The task description for the subagent. Be specific.' },
      run_in_background: { type: 'boolean', description: 'If true, return immediately and continue without waiting.', default: false },
    },
    required: ['subagent_type', 'prompt'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { subagent_type, prompt, run_in_background = false } = args as { subagent_type: AgentId; prompt: string; run_in_background?: boolean };
    const valid = listAgents().some((a) => a.id === subagent_type);
    if (!valid) return { content: `Unknown subagent type: ${subagent_type}`, is_error: true };

    const settings = (await import('../settings/store.js')).settings;
    const provider = (settings.get('defaultProvider') as string | undefined) ?? 'openrouter';
    const model = (settings.get('defaultModel') as string | undefined) ?? 'meta-llama/llama-3.3-70b-instruct:free';

    // Find the parent session's cwd from the session store
    const { loadSessionMeta } = await import('../session/store.js');
    const meta = await loadSessionMeta(ctx.sessionId);
    const cwd = meta?.cwd ?? ctx.cwd;

    const sink = (e: unknown) => ctx.onUpdate({ content: `[subagent ${subagent_type}] ${JSON.stringify(e).slice(0, 200)}` });

    const { done } = spawnSubagent({
      agentId: subagent_type,
      task: prompt,
      sessionId: ctx.sessionId,
      cwd,
      model,
      provider,
      parentHistory: [],
      sink,
      background: run_in_background,
    });

    if (run_in_background) {
      return { content: `Spawned ${subagent_type} agent in background. There are now ${listRunStates().length} active agent runs.` };
    }

    const result = await done;
    return { content: result };
  },
};

