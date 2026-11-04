// Agent runtime — actually runs a subagent in its own context with a
// filtered tool registry. Streams AgentEvents to the main process so the
// right-panel can show live status.

import { v4 as uuid } from 'uuid';
import { getProvider } from '../providers/registry.js';
import { toolRegistry, unknownToolMessage, CORE_TOOL_NAMES } from '../tools/base.js';
import { getAgent } from '../agents/registry.js';
import { buildContext, buildSystemPrompt } from './context.js';
import type { AgentActivity, AgentEvent, AgentId, AgentRunState, AgentType } from '../agents/types.js';
import type { ContentBlock, Message } from '../../shared/types.js';
import { isExplicitActionFailure, isUnfulfilledActionPromise, requiresToolExecution } from './completion-guards.js';
import { missingRequiredTaskActions, type SuccessfulToolAction } from './task-coverage.js';
import {
  buildProviderFailoverPlan,
  isTransientStreamFailure,
  backoffForError,
  recordProviderFailure,
  recordProviderSuccess,
  SAME_MODEL_STREAM_RETRIES,
  FAILOVER_CANDIDATE_RETRIES,
  selectNextProviderCandidate,
  createCapabilityTracker,
  recordCapabilityFailure,
  getCapabilityFailureCount,
  CAPABILITY_FAILURE_THRESHOLD,
  type ProviderCandidate,
  type CapabilityFailureType,
} from '../providers/failover.js';
import { selectLocalModelTools } from './local-tool-routing.js';
import { getAutomationDisplayState, restoreInfiniteOsFocus } from '../automation/display-policy.js';
import { buildRecoveryHandoff, type RecoveryHandoffOptions } from './recovery-handoff.js';
import { buildToolRecoveryDirective, toolAttemptSignature, type FailedToolAttempt } from './tool-recovery.js';
import { LOOP_STREAM_STALL_TIMEOUT_MS } from './loop.js';
import { keepPartialAssistant } from './loop.js';
import { executeToolCall, isParallelSafeTool } from './tool-execution.js';
import { StreamCoalescer } from './stream-coalescer.js';
import { ToolCallArgCoalescer } from './tool-arg-coalescer.js';
import { settings } from '../settings/store.js';
import { resolveThinkingPreference } from './thinking-preference.js';

type EventSink = (e: AgentEvent) => void;

const activeRuns = new Map<string, AbortController>();
const runStates = new Map<string, AgentRunState>();
const runSinks = new Map<string, EventSink>();
const supervisorNotices = new Map<string, number>();
const runProgressAt = new Map<string, number>();
const activeStreamControllers = new Map<string, AbortController>();
let supervisorTimer: ReturnType<typeof setInterval> | undefined;
const SUPERVISOR_NOTICE_MS = 20_000;
const SUPERVISOR_RESTART_MS = 45_000;

function superviseRuns(): void {
  const now = Date.now();
  for (const [runId, state] of runStates) {
    if (state.status !== 'running') continue;
    const sink = runSinks.get(runId);
    if (!sink) continue;
    const lastActivity = runProgressAt.get(runId) ?? state.startedAt;
    const quietMs = now - lastActivity;
    const lastNotice = supervisorNotices.get(runId) ?? 0;
    if (quietMs >= SUPERVISOR_RESTART_MS) {
      const streamController = activeStreamControllers.get(runId);
      if (streamController && !streamController.signal.aborted && now - lastNotice >= SUPERVISOR_RESTART_MS) {
        supervisorNotices.set(runId, now);
        activity(state, sink, 'status', 'Supervisor is restarting a stalled provider', `No provider progress for ${Math.round(quietMs / 1000)}s; the task remains active.`);
        streamController.abort(new Error('Supervisor detected a stalled provider stream.'));
      }
    } else if (quietMs >= SUPERVISOR_NOTICE_MS && !lastNotice) {
      supervisorNotices.set(runId, now);
      activity(state, sink, 'status', 'Supervisor is monitoring this run', `No visible progress for ${Math.round(quietMs / 1000)}s; recovery remains armed.`);
    }
  }
}

function startSupervisor(): void {
  if (supervisorTimer) return;
  supervisorTimer = setInterval(superviseRuns, 10_000);
  supervisorTimer.unref?.();
}

function stopSupervisorIfIdle(): void {
  if (activeRuns.size > 0 || !supervisorTimer) return;
  clearInterval(supervisorTimer);
  supervisorTimer = undefined;
}

function activity(state: AgentRunState, sink: EventSink, kind: AgentActivity['kind'], label: string, detail?: string): void {
  if (!label.startsWith('Supervisor')) runProgressAt.set(state.id, Date.now());
  const item: AgentActivity = { id: uuid(), timestamp: Date.now(), kind, label, ...(detail ? { detail: detail.slice(0, 2_000) } : {}) };
  state.activity = [...(state.activity ?? []), item].slice(-100);
  state.preview = [state.preview, `${label}${item.detail ? `: ${item.detail}` : ''}`].filter(Boolean).join('\n').slice(-4_000);
  sink({ type: 'activity', runId: state.id, activity: item });
}

function summarize(value: unknown): string {
  if (value == null) return '';
  try { return (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 1_000); }
  catch { return String(value).slice(0, 1_000); }
}

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
  if (!agent) {
    throw new Error("Agent not found: " + JSON.stringify(opts.agentId) + ". Check that the agent exists with listAgents().");
  }
  const state: AgentRunState = {
    id: uuid(),
    agentId: opts.agentId,
    sessionId: opts.sessionId,
    status: 'queued',
    task: opts.task,
    startedAt: Date.now(),
    toolCallCount: 0,
    activity: [],
  };
  runStates.set(state.id, state);
  runSinks.set(state.id, opts.sink);
  startSupervisor();
  opts.sink({ type: 'start', run: { ...state } });

  // Welcome event — introduces the agent by name and role so the user
  // knows who is working on their task.
  const agentDef = getAgent(opts.agentId);
  if (agentDef) {
    const roleDesc = opts.agentId === 'auto'
      ? 'your all-purpose assistant'
      : agentDef.description || opts.agentId;
    opts.sink({
      type: 'welcome',
      runId: state.id,
      agentName: agentDef.name || opts.agentId,
      role: roleDesc,
      model: opts.model,
      message: `${agentDef.name || opts.agentId} ready — ${roleDesc}.`,
    });
  }

  const controller = new AbortController();
  activeRuns.set(state.id, controller);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  // There is no implicit whole-task timeout. Complex work may run as long as
  // needed; individual tools, subprocesses, and silent provider streams still
  // have cancellation watchdogs. A caller may opt into a task timeout.
  if (opts.timeout !== undefined && Number.isFinite(opts.timeout) && opts.timeout > 0) {
    timeoutHandle = setTimeout(() => {
      if (state.status === 'running' || state.status === 'queued') {
        state.status = 'failed';
        state.error = `Task timeout after ${Math.round(opts.timeout! / 60_000)} min`;
        opts.sink({ type: 'fail', runId: state.id, error: state.error });
        controller.abort();
      }
    }, opts.timeout);
  }

  const startedDisplayMode = getAutomationDisplayState().mode;
  const done = runSubagentWithRetries(state, agent, opts, controller.signal).finally(() => {
    activeRuns.delete(state.id);
    runSinks.delete(state.id);
    supervisorNotices.delete(state.id);
    runProgressAt.delete(state.id);
    activeStreamControllers.delete(state.id);
    stopSupervisorIfIdle();
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (startedDisplayMode === 'visible') restoreInfiniteOsFocus();
  });

  return { state, done };
}

async function runSubagentWithRetries(
  state: AgentRunState,
  agent: AgentType,
  opts: SpawnOpts,
  signal: AbortSignal,
): Promise<string> {
  const maxAttempts = Math.max(1, Math.trunc(opts.retry?.maxAttempts ?? 3));
  let lastResult = '';
  let previousFailure = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let retryRequested = false;
    const attemptSink: EventSink = (event) => {
      if (event.type === 'fail' && !signal.aborted && attempt < maxAttempts && isRetryableAgentFailure(event.error)) {
        retryRequested = true;
        previousFailure = event.error;
        opts.sink({ type: 'retrying', runId: state.id, attempt: attempt + 1, reason: event.error });
        return;
      }
      opts.sink(event);
    };

    state.status = attempt === 1 ? state.status : 'queued';
    state.error = undefined;
    state.completedAt = undefined;
    const recoveryTask = attempt === 1
      ? opts.task
      : `${opts.task}\n\n[Recovery attempt ${attempt}/${maxAttempts}] The previous attempt failed with: ${previousFailure.slice(0, 1_000)}. Do not repeat the same failed approach. Inspect the current state, choose a materially different authorized method, and verify the result.`;
    try {
      lastResult = await runSubagent(state, agent, { ...opts, task: recoveryTask, sink: attemptSink }, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (signal.aborted || attempt >= maxAttempts || !isRetryableAgentFailure(message)) throw error;
      previousFailure = message;
      retryRequested = true;
      opts.sink({ type: 'retrying', runId: state.id, attempt: attempt + 1, reason: message });
    }
    if (!retryRequested || signal.aborted) return lastResult;

    const delay = opts.retry?.backoff === false
      ? 0
      : Math.min(30_000, (opts.retry?.delay ?? 1_000) * 2 ** (attempt - 1));
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return lastResult;
}

function isRetryableAgentFailure(error: string): boolean {
  if (/permission denied|invalid api key|unauthorized|forbidden|missing credential|cancelled by user|user cancelled/i.test(error)) return false;
  return /cancelled before completion|timed out|timeout|stalled|network|fetch|connection|rate limit|429|5\d\d|provider|no available model|could not complete|unknown error/i.test(error);
}

export async function runSubagent(
  state: AgentRunState,
  agent: AgentType,
  opts: SpawnOpts,
  signal: AbortSignal,
): Promise<string> {
  state.status = 'running';
  opts.sink({ type: 'start', run: { ...state } });
  activity(state, opts.sink, 'status', `${agent.name} started`, `Working in ${opts.cwd}`);

  // Apply agent configuration for this execution
  const config = opts.agentConfig;
  // No implicit step budget: complex tasks may continue until verified
  // completion. A per-run or agent maxSteps/maxTurns remains available when
  // an installation explicitly wants a safety ceiling.
  const maxSteps = config?.maxSteps ?? agent.maxTurns;
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

  const failoverEnabled = settings.get('failoverEnabled') !== false;
  let failoverPlan = await buildProviderFailoverPlan({ provider: opts.provider, model: preferredModel });
  if (!failoverEnabled && failoverPlan.length > 1) {
    failoverPlan = failoverPlan.slice(0, 1);
  }
  if (failoverPlan.length === 0) {
    state.status = 'failed';
    state.error = 'No configured AI provider is available for this agent run.';
    opts.sink({ type: 'fail', runId: state.id, error: state.error });
    return '';
  }
  // Honest routing (mirrors loop.ts): with no saved key the selected provider
  // never makes the plan — fail plainly instead of silently answering from
  // another model, especially when the fallback kill-switch is OFF.
  if (failoverPlan[0].provider !== opts.provider) {
    const selected = getProvider(opts.provider);
    const reason = (selected?.requiresApiKey ?? false)
      ? `No API key saved for ${selected?.label ?? opts.provider} — add one in Settings → Providers${failoverEnabled ? `, or keep chatting on ${failoverPlan[0].label}` : ' and try again (model fallback is OFF)'}.`
      : `${opts.provider}/${preferredModel} is not available${failoverEnabled ? ` — using ${failoverPlan[0].label} instead` : ' and model fallback is OFF'}.`;
    console.warn(`[agent] Subagent selected ${opts.provider}/${preferredModel} unavailable at plan time; starting on ${failoverPlan[0].label}`);
    if (!failoverEnabled) {
      state.status = 'failed';
      state.error = reason;
      opts.sink({ type: 'fail', runId: state.id, error: state.error });
      return '';
    }
    opts.sink({ type: 'provider_status', runId: state.id, status: 'failover', from: `${opts.provider}/${preferredModel}`, to: failoverPlan[0].label, reason });
  }
  let activeCandidate: ProviderCandidate = failoverPlan[0];
  activity(state, opts.sink, 'status', 'Model connected', `${activeCandidate.provider} / ${activeCandidate.model}`);
  let failoverIndex = 0;

  const MAX_TURNS = Number.isFinite(maxSteps) && (maxSteps ?? 0) > 0 ? Math.trunc(maxSteps as number) : 60;
  const WALL_CLOCK_LIMIT_MS = 25 * 60_000;
  const runStartedAt = Date.now();
  let verifiedComplete = false;
  let lastToolBatchHadError = false;
  let intentOnlyRetries = 0;
  // Same-model stream retry budget (mirrors loop.ts): transient hiccups retry
  // on the active candidate before any failover. Reset after every clean turn.
  let sameModelStreamRetries = 0;
  // Failover-candidate retry budget: non-selected models get fewer retries.
  let failoverCandidateRetries = 0;
  // Capability tracker: detects when a model is overmatched for the task.
  const capTracker = createCapabilityTracker();
  let successfulToolExecutions = 0;
  const successfulToolActions: SuccessfulToolAction[] = [];
  const failedAttemptCounts = new Map<string, number>();
  let recoveryContext: Pick<RecoveryHandoffOptions, 'failedProvider' | 'failedModel' | 'stage' | 'failure'> | null = null;
  const providerProgressSeen = new Set<string>();
  // Remote-runtime telemetry (OpenCode's own tool loop) is display-only. The
  // block is synthesized so the transcript can render/persist a live tool
  // card, but its ID is excluded from local execution below: running it again
  // would duplicate every command the remote runtime already performed.
  const remoteTelemetryIds = new Set<string>();
  const remoteTelemetryClosed = new Set<string>();
  const runSystemPrompts = new Map<string, string>();
  // Per-candidate failure log: the exhausted-run error names every model
  // tried and why each failed (mirrors loop.ts) instead of only the last.
  const candidateErrors: Array<{ label: string; error: string }> = [];
  const switchCandidate = (failure: string, assistant: Message, stage: string): boolean => {
    recordProviderFailure(activeCandidate, failure);
    candidateErrors.push({ label: activeCandidate.label, error: failure.slice(0, 220) });
    // Kill-switch (mirrors loop.ts): never leave the selected model.
    if (!failoverEnabled) return false;
    // Every attempt keeps its own bubble: only discard a partial with
    // nothing worth showing, so old streams never vanish mid-run.
    if (messages.at(-1) === assistant && !keepPartialAssistant(assistant)) {
      messages.pop();
      opts.sink({ type: 'message_discard', runId: state.id, message_id: assistant.id });
    }
    const next = selectNextProviderCandidate(failoverPlan, failoverIndex, activeCandidate, failure);
    if (!next) return false;
    recoveryContext = {
      failedProvider: activeCandidate.provider,
      failedModel: activeCandidate.model,
      stage,
      failure,
    };
    failoverIndex = failoverPlan.indexOf(next);
    state.preview = 'Trying another available model…';
    opts.sink({ type: 'provider_status', runId: state.id, status: 'failover', from: activeCandidate.label, to: next.label, reason: failure });
    console.warn(`[agent] Subagent recovering in background: ${activeCandidate.label} -> ${next.label}: ${failure}`);
    activeCandidate = next;
    return true;
  };
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (Date.now() - runStartedAt > WALL_CLOCK_LIMIT_MS) {
      state.status = 'failed';
      state.error = `Run exceeded ${Math.round(WALL_CLOCK_LIMIT_MS / 60000)} min wall-clock limit.`;
      opts.sink({ type: 'fail', runId: state.id, error: state.error });
      return '';
    }
    if (signal.aborted) {
      if ((state.status as AgentRunState['status']) !== 'failed') {
        state.status = 'cancelled';
        state.completedAt = Date.now();
        state.error = 'Cancelled before completion.';
      }
      opts.sink({ type: 'fail', runId: state.id, error: state.error ?? 'Cancelled before completion.' });
      return '';
    }

    const provider = getProvider(activeCandidate.provider);
    if (!provider) {
      state.status = 'failed';
      state.error = `Fallback provider is unavailable: ${activeCandidate.provider}`;
      opts.sink({ type: 'fail', runId: state.id, error: state.error });
      return '';
    }
    const toolsEnabled = providerSupportsTools(activeCandidate.provider, activeCandidate.model);
    const allowAll = agent.allowedTools.includes('*');
    const allowedTools = toolsEnabled
      ? toolRegistry
          .asProviderTools()
          .filter((tool) => {
            if (config?.toolOverride?.exclude?.includes(tool.name)) return false;
            return allowAll || agent.allowedTools.includes(tool.name) || Boolean(config?.toolOverride?.include?.includes(tool.name));
          })
      : [];
    // An agent that declares `'*'` means "no capability restrictions", so it gets
    // the whole registry. This used to be intersected with CORE_TOOL_NAMES, which
    // silently capped every agent at ~37 tools no matter what it declared — so
    // tools an agent genuinely needed (SystemControl, Security, Deploy,
    // BusinessAdvisor, Notifications, Clipboard, …) were simply unreachable and
    // the agent had to give up or fake it. An explicit per-agent allowlist is
    // still honoured exactly as written; only the wildcard is unrestricted.
    const scopedTools = allowAll
      ? allowedTools
      : allowedTools.filter((t) => CORE_TOOL_NAMES.has(t.name));
    const tools = activeCandidate.provider === 'ollama'
      ? selectLocalModelTools(opts.task, scopedTools)
      : scopedTools;
    const systemKey = `${activeCandidate.provider}/${activeCandidate.model}/${tools.map((tool) => tool.name).join(',')}`;
    let baseSystem = runSystemPrompts.get(systemKey);
    if (!baseSystem) baseSystem = [
      agent.systemPrompt,
      config?.customPrompt ? `\n--- Custom Instructions ---\n${config.customPrompt}` : '',
      '',
      '# Parent context',
      `You were spawned by the main agent in ${opts.cwd} to handle this task in isolation.`,
      `Task priority: ${opts.priority ?? 'normal'} | Complexity: ${config?.complexity ?? 'moderate'}`,
      `Output format required: ${outputFormat}`,
      [
        'Focus on your assigned task. Do not spawn your own subagents.',
        'Work independently: inspect the real workspace, make the changes, and verify the result before claiming completion.',
        'If a tool, command, provider, or approach fails, read the error, change the approach, and try a materially different authorized method. Do not repeat an identical failed call.',
        'Use relevant Skills before complex work when they provide a safer or more reliable procedure.',
        'Never claim an action succeeded without observing and validating its result.',
        'Final report format: Outcome; Work completed; Recovery attempts and what failed; Verification performed; Remaining limitations or unresolved items.',
      ].join('\n'),
      '',
      await buildSystemPrompt({
        sessionId: opts.sessionId,
        cwd: opts.cwd,
        model: activeCandidate.model,
        provider: activeCandidate.provider,
        toolsEnabled,
        attachedToolNames: tools.map((tool) => tool.name),
      }),
    ].join('\n');
    if (!runSystemPrompts.has(systemKey)) runSystemPrompts.set(systemKey, baseSystem);

    const recoveryHandoff = recoveryContext
      ? buildRecoveryHandoff({
          originalRequest: opts.task,
          ...(recoveryContext as Pick<RecoveryHandoffOptions, 'failedProvider' | 'failedModel' | 'stage' | 'failure'>),
          successfulToolExecutions,
          messages,
        })
      : null;
    // Local controller so the stall watchdog can actually abort the fetch.
    // Parent abort cascades: user/task abort → stream controller aborts too.
    const subagentStreamController = new AbortController();
    activeStreamControllers.set(state.id, subagentStreamController);
    runProgressAt.set(state.id, Date.now());
    supervisorNotices.delete(state.id);
    const onSubagentParentAbort = () => subagentStreamController.abort();
    signal.addEventListener('abort', onSubagentParentAbort, { once: true });

    const contextMessages = recoveryHandoff
      ? [...messages, recoveryHandoff]
      : messages;
    const stream = provider.streamChat(
      {
        model: activeCandidate.model,
        cwd: opts.cwd,
        messages: await buildContext(contextMessages, {
          cwd: opts.cwd,
          maxTokens: provider.freeModels.find((item) => item.id === activeCandidate.model)?.context_window,
        }),
        system: baseSystem,
        tools,
        stream: true,
        ...resolveThinkingPreference(activeCandidate.provider),
        signal: subagentStreamController.signal,
      },
      activeCandidate.apiKey,
    );

    const assistant: Message = {
      id: uuid(),
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: activeCandidate.model,
      provider: activeCandidate.provider,
    };
    messages.push(assistant);
    let providerFailure = '';
    // Turn boundaries stream exactly like the automatic agent loop so every
    // agent renders identically in the UI.
    opts.sink({ type: 'message_start', runId: state.id, message_id: assistant.id });
    opts.sink({ type: 'provider_start', runId: state.id, message_id: assistant.id, provider: activeCandidate.provider, model: activeCandidate.model, requested_provider: activeCandidate.provider, requested_model: activeCandidate.model, turn });

    // Stall watchdog: mirrors the one in loop.ts, using the local controller
    // so abort() actually kills the fetch connection.
    let streamLastEvent = Date.now();
    const subagentStallInterval = setInterval(() => {
      if (providerFailure) return;
      if (Date.now() - streamLastEvent >= LOOP_STREAM_STALL_TIMEOUT_MS) {
        providerFailure = `Subagent stream stalled (no events for ${Math.round(LOOP_STREAM_STALL_TIMEOUT_MS / 1000)}s)`;
        console.error(`[agent] ${providerFailure} — aborting stream`);
        subagentStreamController.abort();
      }
    }, Math.min(30_000, LOOP_STREAM_STALL_TIMEOUT_MS / 4));

    // Coalesce subagent text deltas into ~50ms frames (same feel as the
    // main loop; parallel agents no longer spam one IPC event per token).
    const deltaCoalescer = new StreamCoalescer({
      onFlush: (text) => opts.sink({ type: "text_delta", runId: state.id, message_id: assistant.id, text }),
    });
    // Stream tool calls as they form (same as the main loop): early name,
    // batched partial-JSON snapshots, final flush before tool_use_end.
    const toolArgCoalescer = new ToolCallArgCoalescer({
      onDelta: ({ id, name, partialJson }) => {
        if (name) opts.sink({ type: "tool_use_start", runId: state.id, message_id: assistant.id, tool_use_id: id, name });
        if (partialJson) opts.sink({ type: "tool_use_delta", runId: state.id, message_id: assistant.id, tool_use_id: id, partial_json: partialJson });
      },
    });
    try {
      for await (const chunk of stream) {
        streamLastEvent = Date.now();
        // Every stream event is provider progress: without this, the
        // supervisor mistakes a long healthy text response for a stall and
        // aborts it at 45s.
        runProgressAt.set(state.id, Date.now());
        if (signal.aborted) break;
        if (chunk.type === 'thinking_delta') {
          // Reasoning belongs on the assistant message (persisted with the
          // answer) and streams live so the user sees progress, not a spinner.
          appendOrCreate(assistant.content, { type: 'thinking', text: chunk.text });
          opts.sink({ type: 'thinking_delta', runId: state.id, message_id: assistant.id, text: chunk.text });
        }
        if (chunk.type === 'text_delta') {
          appendOrCreate(assistant.content, { type: 'text', text: chunk.text });
          state.preview = (state.preview ?? '') + chunk.text;
          deltaCoalescer.push(chunk.text);
        }
        if (chunk.type === 'tool_use_start') {
          toolArgCoalescer.start(chunk.id, chunk.name);
        }
        if (chunk.type === 'tool_use_delta') {
          toolArgCoalescer.delta(chunk.id, chunk.partial_json);
        }
        if (chunk.type === 'tool_use_end') {
          toolArgCoalescer.end(chunk.id, chunk.name);
          state.toolCallCount++;
          opts.sink({ type: 'tool_call', runId: state.id, toolName: chunk.name });
          opts.sink({ type: 'tool_use_end', runId: state.id, message_id: assistant.id, tool_use_id: chunk.id, name: chunk.name, input: chunk.input });
          activity(state, opts.sink, 'tool', `Running ${chunk.name}`, summarize(chunk.input));
          const tu: ContentBlock = { type: 'tool_use', id: chunk.id, name: chunk.name, input: chunk.input };
          assistant.content.push(tu);
        }
        if (chunk.type === 'provider_progress') {
          if (!providerProgressSeen.has(chunk.id)) {
            providerProgressSeen.add(chunk.id);
            state.toolCallCount++;
            opts.sink({ type: 'tool_call', runId: state.id, toolName: chunk.name });
            activity(state, opts.sink, 'tool', `Running ${chunk.name}`, summarize(chunk.input));
            // Synthesize the tool_use block that the transcript renders. The
            // remote runtime has already executed this call, so the ID is
            // marked remote and skipped by the local executor below.
            remoteTelemetryIds.add(chunk.id);
            const progressBlock: ContentBlock = {
              type: 'tool_use',
              id: chunk.id,
              name: chunk.name,
              input: chunk.input ?? {},
            };
            assistant.content.push(progressBlock);
            opts.sink({
              type: 'tool_use_start',
              runId: state.id,
              message_id: assistant.id,
              tool_use_id: chunk.id,
              name: chunk.name,
            });
          }
          if (chunk.status === 'completed' || chunk.status === 'error') {
            // Fill in the final arguments before closing the card so the
            // persisted block carries the command/path the runtime actually ran.
            const progressBlock = assistant.content.find(
              (block): block is Extract<ContentBlock, { type: 'tool_use' }> =>
                block.type === 'tool_use' && block.id === chunk.id,
            );
            if (progressBlock && chunk.input !== undefined) progressBlock.input = chunk.input;
            if (!remoteTelemetryClosed.has(chunk.id)) {
              remoteTelemetryClosed.add(chunk.id);
              opts.sink({
                type: 'tool_use_end',
                runId: state.id,
                message_id: assistant.id,
                tool_use_id: chunk.id,
                name: chunk.name || progressBlock?.name || 'tool',
                input: progressBlock?.input ?? chunk.input ?? {},
              });
            }
          }
          opts.sink({
            type: 'tool_progress',
            runId: state.id,
            tool_use_id: chunk.id,
            name: chunk.name,
            status: chunk.status === 'completed' ? 'completed' : chunk.status === 'error' ? 'error' : 'running',
            ...(chunk.detail ? { detail: chunk.detail } : {}),
          });
          if (chunk.status === 'completed') successfulToolExecutions++;
          if (chunk.status === 'completed') activity(state, opts.sink, 'result', `${chunk.name} completed`, chunk.detail);
          if (chunk.status === 'error') activity(state, opts.sink, 'error', `${chunk.name} failed`, chunk.detail);
          if (chunk.detail) {
            state.preview = `${state.preview ?? ''}\n${chunk.name}: ${chunk.detail}`.slice(-2_000);
          }
        }
        if (chunk.type === 'message_end') {
          assistant.stop_reason = chunk.stop_reason as Message['stop_reason'];
          opts.sink({ type: 'message_end', runId: state.id, message_id: assistant.id, stop_reason: chunk.stop_reason });
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
          // First failure wins (mirrors loop.ts): a watchdog abort surfaces
          // as 'Request cancelled' and must not clobber the stall message.
          if (!providerFailure) providerFailure = chunk.error;
          break;
        }
      }
    } catch (e) {
      if (!providerFailure) providerFailure = (e as Error).message;
    } finally {
      clearInterval(subagentStallInterval);
      deltaCoalescer.dispose();
      toolArgCoalescer.dispose();
      signal.removeEventListener('abort', onSubagentParentAbort);
      if (activeStreamControllers.get(state.id) === subagentStreamController) activeStreamControllers.delete(state.id);
    }

    if (providerFailure) {
      if (signal.aborted) {
        if ((state.status as AgentRunState['status']) !== 'failed') {
          state.status = 'cancelled';
          state.completedAt = Date.now();
          state.error = state.error ?? 'Cancelled before completion.';
        }
        opts.sink({ type: 'fail', runId: state.id, error: state.error ?? 'Cancelled before completion.' });
        return '';
      }
      if (isTransientStreamFailure(providerFailure)) {
        const isSelectedModel = failoverIndex === 0;
        const maxRetries = isSelectedModel ? SAME_MODEL_STREAM_RETRIES : FAILOVER_CANDIDATE_RETRIES;
        const retryCounter = isSelectedModel ? sameModelStreamRetries : failoverCandidateRetries;
        if (retryCounter < maxRetries) {
          // Transient hiccup: stay on the current model and retry with backoff.
          // Announced (not console-only) so the run never looks silently stuck.
          const attempt = retryCounter + 1;
          if (isSelectedModel) sameModelStreamRetries++; else failoverCandidateRetries++;
          // Same bubble rule as failover: keep visible text, drop only empties.
          if (messages.at(-1) === assistant && !keepPartialAssistant(assistant)) {
            messages.pop();
            opts.sink({ type: 'message_discard', runId: state.id, message_id: assistant.id });
          }
          opts.sink({
            type: 'provider_status',
            runId: state.id,
            status: 'retrying',
            provider: activeCandidate.provider,
            model: activeCandidate.model,
            reason: `Attempt ${attempt}/${maxRetries} on ${activeCandidate.label} after: ${providerFailure}`,
          });
          const delayMs = backoffForError(providerFailure, retryCounter);
          console.warn(`[agent] Subagent transient failure on ${activeCandidate.label} (retry ${retryCounter + 1}/${maxRetries}, backoff ${delayMs}ms): ${providerFailure}`);
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
      }
      if (switchCandidate(providerFailure, assistant, 'model response stream')) continue;
      state.status = 'failed';
      candidateErrors.push({ label: activeCandidate.label, error: providerFailure.slice(0, 220) });
      {
        const tried = [...new Set(candidateErrors.map((e) => e.label))];
        const perModel = candidateErrors.slice(0, 6).map((e) => `  - ${e.label}: ${e.error}`).join('\n');
        state.error = `All available models have been tried (${tried.join(', ')}). Last error (${activeCandidate.provider}/${activeCandidate.model}): ${providerFailure}`
          + (perModel ? `\n\nPer-model errors:\n${perModel}${candidateErrors.length > 6 ? `\n  - …and ${candidateErrors.length - 6} more` : ''}` : '');
      }
      opts.sink({ type: 'fail', runId: state.id, error: state.error });
      return '';
    }
    // A clean turn resets the retry budgets.
    sameModelStreamRetries = 0;
    failoverCandidateRetries = 0;

    if (signal.aborted) break;

    // No tool calls → check if task is complete based on output format
    const allToolUses = assistant.content.filter(
      (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    const toolUses = allToolUses.filter((tu) => tu.name?.trim() && !remoteTelemetryIds.has(tu.id));
    const emptyToolUses = allToolUses.filter((tu) => !tu.name?.trim());

    // Emit synthetic errors for empty tool names so the model sees the
    // problem immediately without burning a full execution cycle.
    for (const tu of emptyToolUses) {
      messages.push({
        id: uuid(),
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tu.id, content: 'Error: tool_use block has an empty tool name. Every tool_use block must include a non-empty name field matching one of the registered tool names.', is_error: true }],
        timestamp: Date.now(),
      });
    }

    // Check task completion based on output format requirements
    const taskComplete = await validateTaskCompletion(
      assistant,
      config?.validation,
      outputFormat,
      config?.confidenceThreshold
    );

    const assistantText = assistant.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (!toolUses.length && taskComplete && assistantText && !lastToolBatchHadError) {
      const missingActions = missingRequiredTaskActions(opts.task, successfulToolActions);
      const executionMissing = (requiresToolExecution(opts.task) && successfulToolExecutions === 0) || missingActions.length > 0;
      if (isUnfulfilledActionPromise(opts.task, assistantText) || executionMissing) {
        const capType: CapabilityFailureType = isUnfulfilledActionPromise(opts.task, assistantText) ? 'promise_only' : 'no_execution';
        recordCapabilityFailure(capTracker, activeCandidate, capType);
        const capCount = getCapabilityFailureCount(capTracker, activeCandidate);

        if (capCount >= CAPABILITY_FAILURE_THRESHOLD) {
          const strongerMsg = `Model ${activeCandidate.label} is not capable enough for this task (${capType === 'promise_only' ? 'promised but did not act' : 'did not use tools'}, ${capCount} failures). Switching.`;
          console.warn(`[agent] Subagent capability threshold on ${activeCandidate.label}: ${strongerMsg}`);
          opts.sink({ type: 'provider_status', runId: state.id, status: strongerMsg });
          if (switchCandidate(strongerMsg, assistant, 'capability detection')) {
            intentOnlyRetries = 0;
            failoverCandidateRetries = 0;
            continue;
          }
        }

        if (missingActions.length && !toolsEnabled &&
            switchCandidate(`This model does not support tool calls for the remaining required actions: ${missingActions.join(', ')}.`, assistant, 'compound-action execution')) {
          intentOnlyRetries = 0;
          continue;
        }

        if (intentOnlyRetries < 2) {
          intentOnlyRetries++;
          messages.push({
            id: uuid(),
            role: 'user',
            content: [{ type: 'text', text: '[Execution guard]: Do not narrate future work. Execute the task with tools now, validate it, and report only the verified result.' }],
            timestamp: Date.now(),
          });
          continue;
        }
        if (switchCandidate('The model did not execute the required tool.', assistant, 'required-action execution')) {
          intentOnlyRetries = 0;
          continue;
        }
        state.status = 'failed';
        state.completedAt = Date.now();
        state.error = 'No available model completed the required tool execution.';
        opts.sink({ type: 'fail', runId: state.id, error: state.error });
        return '';
      }
      if (isExplicitActionFailure(opts.task, assistantText)) {
        recordCapabilityFailure(capTracker, activeCandidate, 'explicit_failure');
        const capCount = getCapabilityFailureCount(capTracker, activeCandidate);

        if (capCount >= CAPABILITY_FAILURE_THRESHOLD) {
          const strongerMsg = `Model ${activeCandidate.label} explicitly stated it cannot perform this task (${capCount} times). Switching.`;
          console.warn(`[agent] Subagent capability threshold on ${activeCandidate.label}: ${strongerMsg}`);
          opts.sink({ type: 'provider_status', runId: state.id, status: strongerMsg });
          if (switchCandidate(strongerMsg, assistant, 'capability detection')) {
            intentOnlyRetries = 0;
            failoverCandidateRetries = 0;
            continue;
          }
        }

        if (switchCandidate('The model could not complete the assigned action.', assistant, 'completion verification')) continue;
        state.status = 'failed';
        state.completedAt = Date.now();
        state.error = 'The agent reported that it could not execute the assigned action.';
        opts.sink({ type: 'fail', runId: state.id, error: state.error });
        return '';
      }
      verifiedComplete = true;
      break;
    }
    if (!toolUses.length && lastToolBatchHadError) {
      recordCapabilityFailure(capTracker, activeCandidate, 'tool_error');
      const capCount = getCapabilityFailureCount(capTracker, activeCandidate);

      if (capCount >= CAPABILITY_FAILURE_THRESHOLD) {
        const strongerMsg = `Model ${activeCandidate.label} repeatedly introduced errors in its edits (${capCount} times). Switching.`;
        console.warn(`[agent] Subagent capability threshold on ${activeCandidate.label}: ${strongerMsg}`);
        opts.sink({ type: 'provider_status', runId: state.id, status: strongerMsg });
        if (switchCandidate(strongerMsg, assistant, 'capability detection')) {
          lastToolBatchHadError = false;
          intentOnlyRetries = 0;
          failoverCandidateRetries = 0;
          continue;
        }
      }

      if (switchCandidate('The model did not recover from a failed tool attempt.', assistant, 'tool-result recovery')) continue;
      state.status = 'failed';
      state.completedAt = Date.now();
      state.error = 'The final tool attempt failed and no successful retry was verified.';
      opts.sink({ type: 'fail', runId: state.id, error: state.error });
      return '';
    }

    // Execute each tool with enhanced validation
    let toolBatchHadError = false;
    const batchFailures: FailedToolAttempt[] = [];
    const executeOne = async (tu: Extract<ContentBlock, { type: 'tool_use' }>) => {
      const tool = toolRegistry.get(tu.name);
      if (!tool) {
        const msg = !tu.name?.trim()
          ? 'The model emitted a tool call with an empty tool name. Always include a non-empty tool name in every tool_use block.'
          : unknownToolMessage(tu.name);
        return { tu, tool: null, result: { content: msg, is_error: true } };
      }
      const signature = toolAttemptSignature(tool.name, tu.input);
      const previousFailures = failedAttemptCounts.get(signature) ?? 0;
      if (previousFailures >= 2) {
        return { tu, tool, result: { content: 'This identical tool call already failed twice. Change the arguments, preconditions, or tool family instead of repeating it.', is_error: true } };
      }
        try {
          const result = await executeToolCall({
            tool,
            toolUse: tu,
            sessionId: opts.sessionId,
            cwd: opts.cwd,
            parentSignal: signal,
            onUpdate: (partial) => opts.sink({ type: 'tool_result', runId: state.id, tool_use_id: tu.id, partial: true, content: partial.content }),
          });
          return { tu, tool, result };
      } catch (e) {
        return { tu, tool, result: { content: (e as Error).message, is_error: true } };
      }
    };
    const batchResults = toolUses.every((toolUse) => {
      const tool = toolRegistry.get(toolUse.name);
      return tool ? isParallelSafeTool(tool.name) : false;
    })
      ? await Promise.all(toolUses.map(executeOne))
      : await toolUses.reduce<Promise<Array<Awaited<ReturnType<typeof executeOne>>>>>(
        async (previous, toolUse) => [...await previous, await executeOne(toolUse)],
        Promise.resolve([]),
      );

    for (const { tu, tool, result: toolResult } of batchResults) {
      const canonicalName = tool?.name ?? tu.name;
      const signature = toolAttemptSignature(canonicalName, tu.input);
      const previousFailures = failedAttemptCounts.get(signature) ?? 0;
      // Validate tool output if schema is specified
      if (config?.validation?.schema) {
        const toolContent = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
        const validation = validateOutput(toolContent, config.validation.schema);
        if (!validation.valid) {
          toolBatchHadError = true;
          messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: `Output validation failed: ${validation.error}`, is_error: true }], timestamp: Date.now() });
          continue;
        }
      }
      const resultContent = typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
      if (toolResult.is_error) {
        toolBatchHadError = true;
        if (tool) failedAttemptCounts.set(signature, previousFailures + 1);
        batchFailures.push({ name: canonicalName, input: tu.input, error: resultContent });
      } else {
        successfulToolExecutions++;
        successfulToolActions.push({ name: canonicalName, input: tu.input });
        if (tool) failedAttemptCounts.delete(signature);
      }
      activity(state, opts.sink, toolResult.is_error ? 'error' : 'result', `${tu.name} ${toolResult.is_error ? 'failed' : 'completed'}`, resultContent);
      opts.sink({ type: 'tool_result', runId: state.id, tool_use_id: tu.id, content: resultContent, is_error: toolResult.is_error });
      messages.push({ id: uuid(), role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: resultContent, is_error: toolResult.is_error }], timestamp: Date.now() });
    }
    if (batchFailures.length) {
      messages.push({ id: uuid(), role: 'user', content: [{ type: 'text', text: buildToolRecoveryDirective(batchFailures) }], timestamp: Date.now() });
    }
    lastToolBatchHadError = toolBatchHadError;
  }

  if (!verifiedComplete) {
    // Graceful degrade: if the agent produced any text, treat it as best-effort success
    // instead of hard-failing automations. This keeps Infinite OS feeling smooth.
    const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();
    const lastText = lastAssistant?.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim() ?? '';
    if (lastText && !signal.aborted) {
      state.status = 'completed';
      state.completedAt = Date.now();
      state.result = lastText;
      recordProviderSuccess(activeCandidate);
      activity(state, opts.sink, 'status', `${agent.name} completed (degraded)`, `${state.toolCallCount} tool call${state.toolCallCount === 1 ? '' : 's'}`);
      opts.sink({ type: 'complete', runId: state.id, result: lastText });
      return lastText;
    }
    if (!signal.aborted || (state.status as AgentRunState['status']) !== 'failed') state.status = signal.aborted ? 'cancelled' : 'failed';
    state.completedAt = Date.now();
    if ((state.status as AgentRunState['status']) !== 'failed') {
      state.error = signal.aborted
        ? 'Cancelled before completion.'
        : Number.isFinite(MAX_TURNS)
          ? `Reached the ${MAX_TURNS}-turn safety limit before verified completion.`
          : 'The agent stopped before verified completion.';
    }
    opts.sink({ type: 'fail', runId: state.id, error: state.error ?? 'The agent stopped before verified completion.' });
    return '';
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
  recordProviderSuccess(activeCandidate);
  state.completedAt = Date.now();
  state.result = result;
  activity(state, opts.sink, 'status', `${agent.name} completed`, `${state.toolCallCount} tool call${state.toolCallCount === 1 ? '' : 's'}`);
  opts.sink({ type: 'complete', runId: state.id, result });
  return result;
}

export function abortSubagent(runId: string): boolean {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  const state = runStates.get(runId);
  if (state && (state.status === 'queued' || state.status === 'running')) {
    state.status = 'cancelled';
    state.completedAt = Date.now();
    state.error = 'Cancelled by user.';
  }
  controller.abort();
  return true;
}

export function abortSessionRuns(sessionId: string): number {
  let n = 0;
  for (const [runId, state] of runStates) {
    if (state.sessionId === sessionId && (state.status === 'queued' || state.status === 'running')) {
      abortSubagent(runId);
      activeStreamControllers.get(runId)?.abort(new Error('Session aborted by user.'));
      n++;
    }
  }
  // Also abort stream controllers that may not have a runState yet
  for (const [runId, ctrl] of activeStreamControllers) {
    const st = runStates.get(runId);
    if (!st || st.sessionId === sessionId) {
      try { ctrl.abort(new Error('Session aborted by user.')); } catch { /* already aborted */ }
    }
  }
  return n;
}

/**
 * Stop every in-flight agent turn. Used by the browser bridge's Emergency Stop:
 * the extension tells the app the user hit stop, and any run that is currently
 * driving the browser has to be cancelled — otherwise the AI keeps clicking
 * after the user believes everything has halted.
 */
export function abortAllRuns(reason = 'Stopped by user.'): number {
  let n = 0;
  for (const [runId, state] of runStates) {
    if (state.status === 'queued' || state.status === 'running') {
      abortSubagent(runId);
      activeStreamControllers.get(runId)?.abort(new Error(reason));
      n++;
    }
  }
  for (const [, ctrl] of activeStreamControllers) {
    try { ctrl.abort(new Error(reason)); } catch { /* already aborted */ }
  }
  return n;
}

function providerSupportsTools(providerId: string, model: string): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  const knownModel = provider.freeModels.find((item) => item.id === model);
  // Opt-out semantics: a model is tool-less only when its catalog explicitly
  // says so. Unknown/custom/gateway models are OpenAI-compatible by definition
  // of their provider adapter, so they keep tools (fixes custom endpoints and
  // key-metered catalogs silently losing the entire tool loop).
  return knownModel ? knownModel.supports_tools !== false : true;
}

function appendOrCreate(blocks: ContentBlock[], block: ContentBlock) {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text' && block.type === 'text') {
    last.text += block.text;
  } else {
    blocks.push(block);
  }
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

  if (validation?.schema) {
    const text = assistant.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    const parsed = parseJson(text);
    const schemaResult = parsed.ok ? validateJsonSchema(parsed.value, validation.schema) : { valid: false, error: 'Final response is not valid JSON.' };
    if (!schemaResult.valid) isValid = false;
  }

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
  const parsed = parseJson(content);
  if (!parsed.ok) return { valid: false, error: 'Invalid JSON format' };
  return validateJsonSchema(parsed.value, _schema);
}

function parseJson(content: string): { ok: true; value: unknown } | { ok: false } {
  try { return { ok: true, value: JSON.parse(content) }; }
  catch { return { ok: false }; }
}

function validateJsonSchema(value: unknown, schema: Record<string, unknown>, path = '$'): { valid: boolean; error?: string } {
  const type = schema.type;
  if (typeof type === 'string') {
    const validType = type === 'object' ? typeof value === 'object' && value !== null && !Array.isArray(value)
      : type === 'array' ? Array.isArray(value)
        : type === 'null' ? value === null
          : typeof value === type;
    if (!validType) return { valid: false, error: `${path} must be ${type}.` };
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    return { valid: false, error: `${path} must match one of the allowed values.` };
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const required of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof required === 'string' && !(required in object)) return { valid: false, error: `${path}.${required} is required.` };
    }
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in object) {
          const result = validateJsonSchema(object[key], childSchema, `${path}.${key}`);
          if (!result.valid) return result;
        }
      }
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    for (let index = 0; index < value.length; index++) {
      const result = validateJsonSchema(value[index], schema.items as Record<string, unknown>, `${path}[${index}]`);
      if (!result.valid) return result;
    }
  }
  return { valid: true };
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
  const requestedConcurrency = options?.executionMode === 'sequential'
    ? 1
    : options?.maxConcurrent ?? (tasks.length || 1);
  const maxConcurrent = Math.max(1, Math.trunc(requestedConcurrency));
  const semaphore = new Semaphore(maxConcurrent);
  let stopStarting = false;
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
      // Batch-queue entry is not added to global runStates — the inner
      // spawnSubagent registers the real run; this avoids double entries
      // and ensures abort/clear target the correct run.
      ctx.sink({ type: 'start', run: { ...state } });

      const executeTask = async (): Promise<{ result: string; error?: string }> => {
        if (stopStarting) return { result: '', error: 'Batch stopped after an earlier task failed.' };
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
          if (state.status === 'failed' || state.error) {
            return { result: '', error: state.error ?? 'Subagent failed before completion.' };
          }
          return { result };
        } catch (e) {
          return { result: '', error: (e as Error).message };
        }
      };

      const result = await semaphore.acquire(() => executeTask());
      if (options?.failFast && result.error) stopStarting = true;
      return result;
    })
  );

  const finalResults = new Map<AgentId, { result: string; error?: string }>();
  const seen = new Map<AgentId, number>();
  tasks.forEach((t, index) => {
    const result = results[index];
    const count = seen.get(t.agentId) ?? 0;
    seen.set(t.agentId, count + 1);
    const key = count === 0 ? t.agentId : `${t.agentId}:${count}` as AgentId;
    // Keep first result under bare key; duplicates get suffixed so nothing is lost.
    if (count === 0) finalResults.set(t.agentId, result);
    finalResults.set(key, result);
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

