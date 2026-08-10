// TaskGroup tool — spawn multiple agents in parallel for complex multi-part tasks.
// The main agent can delegate up to 10 parallel subagents from a single tool call.

import type { Tool, ToolResult } from './base.js';
import { spawnBatch } from '../agent/runtime.js';
import { listAgents } from '../agents/registry.js';
import type { AgentId } from '../agents/types.js';

export const taskGroupTool: Tool = {
  name: 'TaskGroup',
  description: [
    'Spawn multiple agents in parallel to handle a complex multi-part task.',
    'Each subagent works independently on its assigned piece. Results are aggregated when all complete.',
    'Use this when a task has clearly independent parts that can be worked on simultaneously.',
    'Up to 10 agents can run in parallel. Each agent gets its own context and tools.',
    'Example: "Research 5 different topics and write a summary" → spawn 5 research agents in parallel.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Array of subtasks to execute in parallel. Each task has an agent_type and a prompt.',
        items: {
          type: 'object',
          properties: {
            agent_type: {
              type: 'string',
              description: 'Agent type: general, research, code, design, data, seo, or a custom-xxx id.',
            },
            prompt: {
              type: 'string',
              description: 'Specific task description for this agent. Be detailed.',
            },
          },
          required: ['agent_type', 'prompt'],
        },
      },
      execution_mode: {
        type: 'string',
        enum: ['parallel', 'sequential', 'mixed'],
        description: 'How to execute tasks. parallel=all at once, sequential=one by one, mixed=independent parallel, dependent sequential.',
        default: 'parallel',
      },
      max_concurrent: {
        type: 'number',
        description: 'Maximum number of agents running simultaneously (1-10).',
        default: 10,
      },
    },
    required: ['tasks'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const { tasks, execution_mode = 'parallel', max_concurrent = 10 } = args as {
      tasks: Array<{ agent_type: string; prompt: string }>;
      execution_mode?: 'parallel' | 'sequential' | 'mixed';
      max_concurrent?: number;
    };

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { content: 'TaskGroup requires at least one task.', is_error: true };
    }

    if (tasks.length > 10) {
      return { content: 'TaskGroup supports a maximum of 10 parallel tasks. Split larger batches.', is_error: true };
    }

    // Validate agent types
    const validAgents = new Set(listAgents().map((a) => a.id));
    for (const task of tasks) {
      if (!validAgents.has(task.agent_type as AgentId)) {
        return { content: `Unknown agent type: ${task.agent_type}. Available: ${Array.from(validAgents).join(', ')}`, is_error: true };
      }
    }

    // Inherit provider/model from session
    const { loadSessionMeta } = await import('../session/store.js');
    const meta = await loadSessionMeta(ctx.sessionId);
    const cwd = meta?.cwd ?? ctx.cwd;
    const provider = meta?.provider ?? 'openrouter';
    const model = meta?.model ?? 'meta-llama/llama-3.3-70b-instruct:free';

    const concurrency = Math.max(1, Math.min(10, max_concurrent));

    ctx.onUpdate({ content: `[TaskGroup] Spawning ${tasks.length} agents (${execution_mode} mode, max ${concurrent} concurrent)...` });

    const results = await spawnBatch(
      tasks.map((t) => ({
        agentId: t.agent_type as AgentId,
        task: t.prompt,
      })),
      {
        sessionId: ctx.sessionId,
        cwd,
        model,
        provider,
        parentHistory: [],
        sink: (event) => {
          if (event.type === 'complete' || event.type === 'fail') {
            ctx.onUpdate({ content: `[TaskGroup] ${event.type === 'complete' ? '✓' : '✗'} ${event.type}` });
          }
        },
      },
      {
        maxConcurrent: concurrency,
        executionMode: execution_mode,
      },
    );

    // Aggregate results
    const output: string[] = [];
    const finalMap = results[0];
    let successCount = 0;
    let failCount = 0;

    for (const task of tasks) {
      const result = finalMap.get(task.agent_type as AgentId);
      if (result?.error) {
        failCount++;
        output.push(`## ${task.agent_type} — FAILED\nError: ${result.error}`);
      } else {
        successCount++;
        output.push(`## ${task.agent_type}\n${(result?.result ?? '(no output)').slice(0, 4_000)}`);
      }
    }

    const summary = `[TaskGroup] ${successCount} succeeded, ${failCount} failed out of ${tasks.length} tasks.`;
    ctx.onUpdate({ content: summary });

    return { content: `${summary}\n\n${output.join('\n\n')}` };
  },
};
