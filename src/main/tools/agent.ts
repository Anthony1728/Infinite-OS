// The `Agent` tool — the main agent uses this to spawn a subagent
// for a specific task. Supports single and batch spawning.

import type { Tool, ToolResult } from './base.js';
import { spawnSubagent, spawnBatch, listRunStates } from '../agent/runtime.js';
import { listAgents } from '../agents/registry.js';
import type { AgentId } from '../agents/types.js';

export const agent: Tool = {
  name: 'Agent',
  description: [
    'Spawn a specialised subagent to handle a focused task in isolation.',
    'The subagent gets its own context, tool restrictions, and report.',
    'Use this for parallelisable or specialised work like research, code edits, design, data analysis, or SEO audits.',
    'Supports single or batch mode. For batch, pass multiple prompts to run agents in parallel.',
    'When delegating, the main agent should clearly describe the task in `prompt` and trust the subagent to handle it.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      subagent_type: {
        type: 'string',
        description: 'The type of subagent to spawn (e.g. research, code, design, data, seo, general, or a custom-xxx id).',
      },
      prompt: { type: 'string', description: 'The task description for the subagent. Be specific.' },
      run_in_background: { type: 'boolean', description: 'If true, return immediately and continue without waiting.', default: false },
      batch: {
        type: 'array',
        description: 'Optional: array of {subagent_type, prompt} objects to spawn multiple agents in parallel. Overrides single subagent_type/prompt.',
        items: {
          type: 'object',
          properties: {
            subagent_type: { type: 'string', description: 'Agent type for this subtask.' },
            prompt: { type: 'string', description: 'Task description for this subtask.' },
          },
          required: ['subagent_type', 'prompt'],
        },
      },
      max_concurrent: {
        type: 'number',
        description: 'Maximum concurrent agents in batch mode (1-10).',
        default: 10,
      },
    },
    required: ['subagent_type', 'prompt'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { subagent_type, prompt, run_in_background = false, batch, max_concurrent = 10 } = args as {
      subagent_type: AgentId;
      prompt: string;
      run_in_background?: boolean;
      batch?: Array<{ subagent_type: string; prompt: string }>;
      max_concurrent?: number;
    };

    // Inherit the exact provider, model, and workspace selected in the parent chat.
    const { loadSessionMeta } = await import('../session/store.js');
    const meta = await loadSessionMeta(ctx.sessionId);
    const cwd = meta?.cwd ?? ctx.cwd;
    const provider = meta?.provider ?? 'openrouter';
    const model = meta?.model ?? 'meta-llama/llama-3.3-70b-instruct:free';

    // Batch mode: spawn multiple agents in parallel
    if (Array.isArray(batch) && batch.length > 0) {
      const count = Math.min(batch.length, 10);
      ctx.onUpdate({ content: `[Agent] Spawning ${count} agents in parallel...` });

      const validAgents = new Set(listAgents().map((a) => a.id));
      for (const task of batch) {
        if (!validAgents.has(task.subagent_type as AgentId)) {
          return { content: `Unknown agent type: ${task.subagent_type}`, is_error: true };
        }
      }

      const results = await spawnBatch(
        batch.slice(0, 10).map((t) => ({
          agentId: t.subagent_type as AgentId,
          task: t.prompt,
        })),
        {
          sessionId: ctx.sessionId,
          cwd,
          model,
          provider,
          parentHistory: [],
          sink: () => {},
        },
        {
          maxConcurrent: Math.max(1, Math.min(10, max_concurrent)),
          executionMode: 'parallel',
        },
      );

      const output: string[] = [];
      const finalMap = results[0];
      let success = 0;
      let failed = 0;

      for (let i = 0; i < batch.slice(0, 10).length; i++) {
        const task = batch[i];
        // Use index-based lookup since duplicate agent types would overwrite in a Map
        const resultKey = Array.from(finalMap.keys())[i];
        const result = resultKey ? finalMap.get(resultKey) : undefined;
        if (result?.error) {
          failed++;
          output.push(`[${task.subagent_type}] FAILED: ${result.error}`);
        } else {
          success++;
          output.push(`[${task.subagent_type}] ${(result?.result ?? '').slice(0, 3_000)}`);
        }
      }

      return { content: `[Agent batch] ${success} succeeded, ${failed} failed.\n\n${output.join('\n\n')}` };
    }

    // Single mode
    const valid = listAgents().some((a) => a.id === subagent_type);
    if (!valid) return { content: `Unknown subagent type: ${subagent_type}`, is_error: true };

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
