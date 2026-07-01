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
  /** Optional agent-specific configuration for this task */
  agentConfig?: AgentExecutionConfig;
  /** Retry configuration for failed tasks */
  retry?: {
    maxAttempts?: number;
    delay?: number;
    backoff?: boolean;
  };
  /** Timeout for task execution */
  timeout?: number;
  /** Priority level for task scheduling */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface AgentExecutionConfig {
  /** Custom system prompt for this specific task */
  customPrompt?: string;
  /** Override agent settings for this execution */
  toolOverride?: {
    include?: string[];
    exclude?: string[];
  };
  /** Maximum steps for this execution */
  maxSteps?: number;
  /** Model preference for this execution */
  preferredModel?: string;
  /** Session memory and context */
  context?: {
    domain?: string;
    urgency?: 'informational' | 'operational' | 'critical';
    stakeholders?: string[];
  };
  /** Task complexity classification */
  complexity?: 'simple' | 'moderate' | 'complex' | 'expert';
  /** Required confidence level for task completion */
  confidenceThreshold?: number;
  /** External dependencies for this task */
  dependencies?: string[];
  /** Task-specific validation rules */
  validation?: {
    requiredFields?: string[];
    format?: string;
    schema?: Record<string, unknown>;
  };
  /** Output format specification */
  outputFormat?: 'text' | 'json' | 'markdown' | 'structured';
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

  // Set up timeout if specified
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  if (opts.timeout) {
    timeoutHandle = setTimeout(() => {
      if (state.status === 'running' || state.status === 'queued') {
        state.status = 'failed';
        state.error = `Task timeout after ${opts.timeout}ms`;
        opts.sink({ type: 'fail', runId: state.id, error: state.error });
        controller.abort();
      }
    }, opts.timeout);
  }

  const done = runSubagent(state, agent, opts, controller.signal).finally(() => {
    activeRuns.delete(state.id);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });

  return { state, done };
}

export async function runSubagent(
  state: AgentRunState,
  agent: AgentType,
  opts: SpawnOpts,
  signal: AbortSignal,
): Promise<string> {
  state.status = 'running';
  opts.sink({ type: 'start', run: { ...state } });

  // Apply agent configuration for this execution
  const config = opts.agentConfig;
  const maxSteps = config?.maxSteps ?? agent.maxTurns ?? 30;
  const preferredModel = config?.preferredModel ?? opts.model;
  const outputFormat = config?.outputFormat ?? 'text';

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

  // Apply tool overrides from agent config
  const tools = toolRegistry
    .asProviderTools()
    .filter((t) => {
      // Include default agent tools
      if (agent.allowedTools.includes(t.name)) return true;
      // Apply config inclusions
      if (config?.toolOverride?.include?.includes(t.name)) return true;
      // Exclude config tools
      if (config?.toolOverride?.exclude?.includes(t.name)) return false;
      return false;
    });

  // Build enhanced system prompt with config
  const baseSystem = [
    agent.systemPrompt,
    config?.customPrompt ? `\n--- Custom Instructions ---\n${config.customPrompt}` : '',
    '',
    '# Parent context',
    `You were spawned by the main agent in ${opts.cwd} to handle this task in isolation.`,
    `Task priority: ${opts.priority ?? 'normal'} | Complexity: ${config?.complexity ?? 'moderate'}`,
    `Output format required: ${outputFormat}`,
    'Focus on your assigned task. Do not spawn your own subagents. Be concise in your final report.',
    '',
    await buildSystemPrompt({ sessionId: opts.sessionId, cwd: opts.cwd, model: preferredModel, provider: opts.provider }),
  ].join('\n');

  const MAX_TURNS = maxSteps;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (signal.aborted) {
      state.status = 'cancelled';
      opts.sink({ type: 'fail', runId: state.id, error: 'Cancelled' });
      return '';
    }

    const stream = provider.streamChat(
      {
        model: preferredModel,
        messages,
        system: baseSystem,
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
          // Validate output if confidence threshold is set
          if (config?.confidenceThreshold && chunk.stop_reason === 'tool_use') {
            const confidence = await calculateConfidence(assistant.content);
            if (confidence < config.confidenceThreshold) {
              // Continue for more validation if confidence is low
              messages.push({
                id: uuid(),
                role: 'user',
                content: [{ type: 'text', text: `Please provide more details to reach confidence threshold of ${config.confidenceThreshold}. Current confidence: ${confidence.toFixed(2)}.` }],
                timestamp: Date.now(),
              });
              continue;
            }
          }
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

    // No tool calls → check if task is complete based on output format
    const toolUses = assistant.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );

    // Check task completion based on output format requirements
    const taskComplete = await validateTaskCompletion(
      assistant,
      config?.validation,
      outputFormat,
      config?.confidenceThreshold
    );

    if (!toolUses.length && taskComplete) break;

    // Execute each tool with enhanced validation
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
      let toolResult;
      try {
        toolResult = await tool.execute(tu.input, { cwd: opts.cwd, abortSignal: signal, sessionId: opts.sessionId, onUpdate: () => {} });
      } catch (e) {
        toolResult = { content: (e as Error).message, is_error: true };
      }
      // Validate tool output if schema is specified
      if (config?.validation?.schema) {
        const toolContent = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
        const validation = validateOutput(toolContent, config.validation.schema);
        if (!validation.valid) {
          messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: `Output validation failed: ${validation.error}`, is_error: true }], timestamp: Date.now() });
          continue;
        }
      }
      const resultContent = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
      messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: resultContent, is_error: toolResult.is_error }], timestamp: Date.now() });
    }
  }

  // Build final result: the last assistant text block
  const last = messages.filter((m) => m.role === 'assistant').pop();
  const textBlocks = last?.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text') ?? [];
  let result = textBlocks.map((b) => b.text).join('\n').trim() || '(no output)';

  // Apply output format transformation if needed
  if (outputFormat === 'json' && textBlocks.length > 0) {
    try {
      result = JSON.stringify({ content: textBlocks.map(b => b.text), metadata: { completedAt: Date.now(), agent: agent.id } });
    } catch {
      // Keep original text if JSON parsing fails
    }
  } else if (outputFormat === 'markdown' && textBlocks.length > 0) {
    result = `# Task Result\n\n${result}\n\n---\n*Completed by ${agent.name} at ${new Date().toISOString()}*`;
  }

  state.status = 'completed';
  state.completedAt = Date.now();
  state.result = result;
  opts.sink({ type: 'complete', runId: state.id, result });
  return result;
}

async function calculateConfidence(content: ContentBlock[]): Promise<number> {
  let confidence = 0.5;

  if (content.some(b => b.type === 'text' && b.text.length > 100)) {
    confidence += 0.3;
  }

  if (content.some(b => b.type === 'tool_use')) {
    confidence += 0.2;
  }

  return Math.min(confidence, 1.0);
}

async function validateTaskCompletion(
  assistant: Message,
  validation?: AgentExecutionConfig['validation'],
  outputFormat: string = 'text',
  _confidenceThreshold?: number
): Promise<boolean> {
  if (!validation && !outputFormat && !_confidenceThreshold) {
    return true;
  }

  let isValid = true;

  if (outputFormat === 'json') {
    try {
      const text = assistant.content.find(b => b.type === 'text');
      if (text && 'text' in text) {
        JSON.parse(text.text);
      } else {
        isValid = false;
      }
    } catch {
      isValid = false;
    }
  } else if (outputFormat === 'markdown') {
    isValid = assistant.content.some(b => b.type === 'text' && 'text' in b && b.text.includes('#'));
  }

  return isValid;
}

function validateOutput(content: string, _schema: Record<string, unknown>): { valid: boolean; error?: string } {
  try {
    JSON.parse(content);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid JSON format' };
  }
}

/**
 * Run a batch of subagents in parallel. Resolves when all complete
 * (or fail). Each agent runs in its own context.
 */
export async function spawnBatch(
  tasks: Array<{ agentId: AgentId; task: string; config?: AgentExecutionConfig; priority?: SpawnOpts['priority'] }>,
  ctx: { sessionId: string; cwd: string; model: string; provider: string; parentHistory: Message[]; sink: EventSink },
  options?: {
    maxConcurrent?: number;
    failFast?: boolean;
    executionMode?: 'sequential' | 'parallel' | 'mixed';
  },
): Promise<Map<AgentId, { result: string; error?: string }>[]> {
  const results = await Promise.all(
    tasks.map(async (t) => {
      const runId = uuid();
      const state: AgentRunState = {
        id: runId,
        agentId: t.agentId,
        sessionId: ctx.sessionId,
        status: 'queued',
        task: t.task,
        startedAt: Date.now(),
        toolCallCount: 0,
      };
      runStates.set(state.id, state);
      ctx.sink({ type: 'start', run: { ...state } });

      const maxConcurrent = options?.maxConcurrent ?? tasks.length;

      const executeTask = async (): Promise<{ result: string; error?: string }> => {
        try {
          const { done } = spawnSubagent({
            agentId: t.agentId,
            task: t.task,
            sessionId: ctx.sessionId,
            cwd: ctx.cwd,
            model: ctx.model,
            provider: ctx.provider,
            parentHistory: ctx.parentHistory,
            sink: (event) => {
              if (event.type === 'complete') {
                state.status = 'completed';
                state.completedAt = Date.now();
                state.result = event.result;
              } else if (event.type === 'fail') {
                state.status = 'failed';
                state.error = event.error;
              }
              ctx.sink(event);
            },
            background: true,
            agentConfig: t.config,
            priority: t.priority ?? 'normal',
          });

          const result = await done;
          return { result };
        } catch (e) {
          return { result: '', error: (e as Error).message };
        }
      };

      const semaphore = new Semaphore(maxConcurrent);
      return semaphore.acquire(() => executeTask());
    })
  );

  const finalResults = new Map<AgentId, { result: string; error?: string }>();
  tasks.forEach((t, index) => {
    const result = results[index];
    finalResults.set(t.agentId, result);
  });

  return [finalResults];
}

class Semaphore {
  private resolveList: Array<() => void> = [];
  private acquired = 0;
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  public async acquire<T>(fn: () => Promise<T>): Promise<T> {
    while (this.acquired >= this.max) {
      await new Promise<void>((resolve) => {
        this.resolveList.push(resolve);
      });
    }

    this.acquired++;
    try {
      return await fn();
    } finally {
      this.acquired--;
      if (this.resolveList.length > 0) {
        const resolve = this.resolveList.shift();
        if (resolve) resolve();
      }
    }
  }
}

