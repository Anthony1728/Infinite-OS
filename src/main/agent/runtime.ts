// Agent runtime — actually runs a subagent in its own context with a
// filtered tool registry. Streams AgentEvents to the main process so the
// right-panel can show live status.

import { v4 as uuid } from 'uuid';
import { getProvider } from '../providers/registry.js';
import { getApiKey } from '../settings/secrets.js';
import { toolRegistry } from '../tools/base.js';
import { checkPermission } from './permissions.js';
import { getAgent } from '../agents/registry.js';
import { runHooks } from './hooks.js';
import { buildSystemPrompt } from './context.js';
import type { AgentEvent, AgentId, AgentRunState, AgentType } from '../agents/types.js';
import type { ContentBlock, Message } from '../../shared/types.js';

type EventSink = (e: AgentEvent) => void;

const activeRuns = new Map<string, AbortController>();
const runStates = new Map<string, AgentRunState>();

export function listRunStates(): AgentRunState[] {
  return Array.from(runStates.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function clearCompletedRuns(): void {
  const now = Date.now();
  for (const [id, s] of runStates) {
    if (s.status !== 'running' && s.status !== 'queued' && s.completedAt && now - s.completedAt > 5 * 60_000) {
      runStates.delete(id);
    }
  }
}

export function getRunState(id: string): AgentRunState | undefined {
  return runStates.get(id);
}

export interface SpawnOpts {
  agentId: AgentId;
  task: string;
  sessionId: string;
  cwd: string;
  model: string;
  provider: string;
  /** Parent history to give the subagent context. */
  parentHistory: Message[];
  sink: EventSink;
  /** When true, run in parallel with other subagents. */
  background?: boolean;
}

/**
 * Spawn a subagent. Returns the run state and a promise that resolves
 * with the agent's final result. Events are pushed to the sink as they
 * happen so the UI can update live.
 */
export function spawnSubagent(opts: SpawnOpts): { state: AgentRunState; done: Promise<string> } {
  const agent = getAgent(opts.agentId);
  const state: AgentRunState = {
    id: uuid(),
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    status: 'queued',
    task: opts.task,
    startedAt: Date.now(),
    toolCallCount: 0,
  };
  runStates.set(state.id, state);
  opts.sink({ type: 'start', run: { ...state } });

  const controller = new AbortController();
  activeRuns.set(state.id, controller);

  const done = runSubagent(state, agent, opts, controller.signal).finally(() => {
    activeRuns.delete(state.id);
  });

  return { state, done };
}

async function runSubagent(
  state: AgentRunState,
  agent: AgentType,
  opts: SpawnOpts,
  signal: AbortSignal,
): Promise<string> {
  state.status = 'running';
  opts.sink({ type: 'start', run: { ...state } });

  const messages: Message[] = [
    {
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text: opts.task }],
      timestamp: Date.now(),
    },
  ];

  const provider = getProvider(opts.provider);
  if (!provider) {
    state.status = 'failed';
    state.error = `Unknown provider: ${opts.provider}`;
    opts.sink({ type: 'fail', runId: state.id, error: state.error });
    return '';
  }
  const apiKey = await getApiKey(opts.provider);

  const tools = toolRegistry
    .asProviderTools()
    .filter((t) => agent.allowedTools.includes(t.name));

  const system = [
    agent.systemPrompt,
    '',
    '# Parent context',
    `You were spawned by the main agent in ${opts.cwd} to handle this task in isolation.`,
    'Focus on your assigned task. Do not spawn your own subagents. Be concise in your final report.',
    '',
    await buildSystemPrompt({ sessionId: opts.sessionId, cwd: opts.cwd, model: opts.model, provider: opts.provider }),
  ].join('\n');

  const MAX_TURNS = agent.maxTurns ?? 30;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) {
      state.status = 'cancelled';
      opts.sink({ type: 'fail', runId: state.id, error: 'Cancelled' });
      return '';
    }

    const stream = provider.streamChat(
      {
        model: opts.model,
        messages,
        system,
        tools,
        stream: true,
        signal,
      },
      apiKey,
    );

    const assistant: Message = {
      id: uuid(),
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
    };
    messages.push(assistant);

    try {
      for await (const chunk of stream) {
        if (signal.aborted) break;
        if (chunk.type === 'text_delta') {
          state.preview = (state.preview ?? '') + chunk.text;
          opts.sink({ type: 'text_delta', runId: state.id, text: chunk.text });
        }
        if (chunk.type === 'tool_use_end') {
          state.toolCallCount++;
          opts.sink({ type: 'tool_call', runId: state.id, toolName: chunk.name });
          const tu: ContentBlock = { type: 'tool_use', id: chunk.id, name: chunk.name, input: chunk.input };
          assistant.content.push(tu);
        }
        if (chunk.type === 'message_end') {
          assistant.stop_reason = chunk.stop_reason as Message['stop_reason'];
        }
        if (chunk.type === 'error') {
          state.status = 'failed';
          state.error = chunk.error;
          opts.sink({ type: 'fail', runId: state.id, error: chunk.error });
          return '';
        }
      }
    } catch (e) {
      state.status = 'failed';
      state.error = (e as Error).message;
      opts.sink({ type: 'fail', runId: state.id, error: state.error });
      return '';
    }

    if (signal.aborted) break;

    // No tool calls → done
    const toolUses = assistant.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (!toolUses.length) break;

    // Execute each tool
    for (const tu of toolUses) {
      if (signal.aborted) break;
      await runHooks('PreToolUse', { tool: tu.name, input: tu.input, agent: agent.id }, { cwd: opts.cwd, sessionId: opts.sessionId });
      const allowed = await checkPermission(tu, { sessionId: opts.sessionId, cwd: opts.cwd });
      if (!allowed) {
        messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: 'Permission denied.', is_error: true }], timestamp: Date.now() });
        continue;
      }
      const tool = toolRegistry.get(tu.name);
      if (!tool) {
        messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: `Unknown tool: ${tu.name}`, is_error: true }], timestamp: Date.now() });
        continue;
      }
      let result;
      try {
        result = await tool.execute(tu.input, { cwd: opts.cwd, abortSignal: signal, sessionId: opts.sessionId, onUpdate: () => {} });
      } catch (e) {
        result = { content: (e as Error).message, is_error: true };
      }
      messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.is_error }], timestamp: Date.now() });
    }
  }

  // Build final result: the last assistant text block
  const last = messages.filter((m) => m.role === 'assistant').pop();
  const textBlocks = last?.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text') ?? [];
  const result = textBlocks.map((b) => b.text).join('\n').trim() || '(no output)';

  state.status = 'completed';
  state.completedAt = Date.now();
  state.result = result;
  opts.sink({ type: 'complete', runId: state.id, result });
  return result;
}

/**
 * Run a batch of subagents in parallel. Resolves when all complete
 * (or fail). Each agent runs in its own context.
 */
export async function spawnBatch(
  tasks: Array<{ agentId: AgentId; task: string }>,
  ctx: { sessionId: string; cwd: string; model: string; provider: string; parentHistory: Message[]; sink: EventSink },
): Promise<Map<AgentId, { result: string; error?: string }>> {
  const out = new Map<AgentId, { result: string; error?: string }>();
  const promises = tasks.map(async (t) => {
    const { done } = spawnSubagent({
      agentId: t.agentId,
      task: t.task,
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      model: ctx.model,
      provider: ctx.provider,
      parentHistory: ctx.parentHistory,
      sink: ctx.sink,
      background: true,
    });
    try {
      const result = await done;
      out.set(t.agentId, { result });
    } catch (e) {
      out.set(t.agentId, { result: '', error: (e as Error).message });
    }
  });
  await Promise.all(promises);
  return out;
}
