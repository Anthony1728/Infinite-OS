import type { Tool, ToolContext, ToolResult } from './base.js';
import { toolRegistry } from './base.js';

/**
 * Batch Execution — Hermes-beating parallel tool fan-out.
 * Hermes runs tools sequentially per turn; Infinite OS can fan out N independent
 * tool calls in parallel (respecting permission), collect results, and verify as a batch.
 * Think: n8n batch node + LangGraph parallel, as a single tool call.
 */
interface BatchArgs {
  calls: Array<{ tool: string; input: Record<string, unknown> }>;
  stopOnError?: boolean;
}

export const batchTool: Tool = {
  name: 'Batch',
  description:
    'Run multiple independent tool calls in parallel and collect results. Each entry is {tool, input}. Hermes batch is implicit; Infinite OS makes it explicit, parallel, and verified: runs up to 8 calls concurrently, respects the General agent\'s FULL tool registry, and returns a combined report with per-call status. Use for independent I/O (read many files, fire many web fetches, etc.).',
  inputSchema: {
    type: 'object',
    properties: {
      calls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'Canonical tool name, e.g. Read, Bash, WebFetch' },
            input: { type: 'object', description: 'Tool input object', additionalProperties: true },
          },
          required: ['tool', 'input'],
        },
        description: 'Tool calls to run in parallel (2-8 recommended, max 12)',
      },
      stopOnError: { type: 'boolean', description: 'If true, abort remaining on first error (default false)' },
    },
    required: ['calls'],
  },
  permission: 'ask',
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as BatchArgs;
    if (!Array.isArray(a.calls) || a.calls.length === 0) return { content: 'Batch requires a non-empty calls array.', is_error: true };
    if (a.calls.length > 12) return { content: 'Batch limited to 12 parallel calls ( Hermes limit is lower). Split into multiple batches.', is_error: true };
    // Validate tools exist before running anything
    for (let i = 0; i < a.calls.length; i++) {
      const c = a.calls[i];
      if (!c.tool || typeof c.tool !== 'string') return { content: `calls[${i}] missing tool`, is_error: true };
      if (!toolRegistry.resolve(c.tool)) return { content: `Unknown tool in batch[${i}]: "${c.tool}". Available: ${toolRegistry.list().map(t => t.name).slice(0, 8).join(', ')}…`, is_error: true };
    }

    const results: string[] = [];
    let hadError = false;
    // Simple concurrency of 8
    const concurrency = 8;
    let idx = 0;
    const runOne = async (call: { tool: string; input: Record<string, unknown> }, n: number): Promise<string> => {
      const tool = toolRegistry.resolve(call.tool)!;
      try {
        const res = await tool.execute(call.input, ctx);
        const tag = res.is_error ? 'ERROR' : 'OK';
        if (res.is_error) hadError = true;
        const head = `[${n}] ${tool.name} → ${tag}`;
        const body = typeof res.content === 'string' ? res.content.slice(0, 4000) : JSON.stringify(res.content).slice(0, 4000);
        return `${head}\n${body}`;
      } catch (e) {
        hadError = true;
        return `[${n}] ${call.tool} → ERROR\n${(e as Error).message}`;
      }
    };

    const inFlight: Promise<void>[] = [];
    const queueNext = async (): Promise<void> => {
      if (a.stopOnError && hadError) return;
      const cur = idx++;
      if (cur >= a.calls.length) return;
      const line = await runOne(a.calls[cur], cur + 1);
      results[cur] = line;
      await queueNext();
    };
    for (let i = 0; i < Math.min(concurrency, a.calls.length); i++) inFlight.push(queueNext());
    await Promise.all(inFlight);

    const header = `Batch: ${a.calls.length} calls, ${hadError ? 'some errors' : 'all OK'} (concurrency ${concurrency})`;
    return { content: [header, ...results].join('\n\n'), is_error: hadError && Boolean(a.stopOnError) };
  },
};
