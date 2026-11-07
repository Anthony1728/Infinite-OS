// The core agentic loop: think → tool_use → tool_result → think → ... → end_turn
// Streams events to the renderer via the event bus so the UI updates live.

import type { Message, ContentBlock } from '../../shared/types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProvider } from '../providers/registry.js';
import { recordUsage } from '../providers/usage-store.js';
import { toolRegistry, unknownToolMessage, CORE_TOOL_NAMES } from '../tools/base.js';
import { buildSystemPrompt, buildContext } from './context.js';
import { DecisionRouter } from '../brain/router.js';
import {
  buildProviderFailoverPlan,
  selectNextProviderCandidate,
  recordProviderFailure,
  recordProviderSuccess,
  isTransientStreamFailure,
  backoffForError,
  classifyError,
  SAME_MODEL_STREAM_RETRIES,
  FAILOVER_CANDIDATE_RETRIES,
  createCapabilityTracker,
  recordCapabilityFailure,
  getCapabilityFailureCount,
  CAPABILITY_FAILURE_THRESHOLD,
  type ProviderCandidate,
  type CapabilityTracker,
  type CapabilityFailureType,
} from '../providers/failover.js';
import { routeForcedBrowserTool } from './browser-routing.js';
import { persistActiveModel } from '../brain/model-switch.js';
import { StreamCoalescer } from './stream-coalescer.js';
import { ToolCallArgCoalescer } from './tool-arg-coalescer.js';
import { executeToolCall, isParallelSafeTool, mapWithConcurrency, PARALLEL_TOOL_CONCURRENCY } from './tool-execution.js';
import { shouldCompact, compactMessages } from './compaction.js';
import { resolveRunBudget } from './run-budget.js';
import { evaluateFileClaims, renderClaimRevisionDirective } from '../engine/run-contract.js';
export { TOOL_EXECUTION_TIMEOUT_MS } from './tool-execution.js';

// Stall timeout for stream consumption: if the provider blocks on reader.read()
// for this long with zero events, abort the fetch and retry (same model first)
// or fail over. 60s because free-tier cold starts and NVIDIA internal retries
// can legitimately take 30-120s of silence on a healthy request. The UI never
// goes static during the wait (provider_start/status events keep it live), and
// a stall no longer abandons the user's selected model on the first slow token.
export let LOOP_STREAM_STALL_TIMEOUT_MS = 60_000;
export const setLoopStallTimeout = (ms: number) => { LOOP_STREAM_STALL_TIMEOUT_MS = ms; };

/** Build a user-facing message when all failover candidates are exhausted. */
function buildExhaustedMessage(
  plan: ProviderCandidate[],
  lastError: string,
  capTracker?: CapabilityTracker,
  candidateErrors?: Array<{ label: string; error: string }>,
): string {
  const triedModels = [...new Set(plan.map((c) => `${c.provider}/${c.model}`))];
  const errorType = classifyError(lastError);

  // Check if any model had capability failures
  const capabilityFailedModels: string[] = [];
  if (capTracker) {
    for (const candidate of plan) {
      const id = `${candidate.provider}:${candidate.model}`;
      const capFailures = capTracker.failures.get(id) ?? 0;
      if (capFailures >= CAPABILITY_FAILURE_THRESHOLD) {
        const types = capTracker.details.get(id) ?? [];
        const typeSummary = types.map((t) => {
          if (t === 'promise_only') return 'promised to act but did not';
          if (t === 'explicit_failure') return 'said it cannot do the task';
          if (t === 'tool_error') return 'its edits introduced errors';
          if (t === 'no_execution') return 'did not use required tools';
          return t;
        }).join('; ');
        capabilityFailedModels.push(`${candidate.provider}/${candidate.model} (${typeSummary})`);
      }
    }
  }

  const header = `All ${triedModels.length} model(s) have been tried and none could complete the request.`;
  const details: string[] = [];

  if (capabilityFailedModels.length > 0) {
    details.push('');
    details.push('CAPABILITY ISSUES (model was not strong enough for the task):');
    for (const m of capabilityFailedModels) {
      details.push(`  - ${m}`);
    }
    details.push('');
    details.push('What this means: The model tried but lacked the skill to complete your request.');
    details.push('This is NOT an API error — the model is overmatched for this type of task.');
    details.push('');
    details.push('RECOMMENDATION: Try a stronger model for this task:');
    details.push('  - For coding: Use Claude Sonnet/Opus, GPT-4o, or Gemini 2.5 Pro');
    details.push('  - For research: Use any model with web search enabled');
    details.push('  - For desktop automation: Ensure the selected model supports tool calls');
  }

  if (errorType === 'rate_limit') {
    details.push('');
    details.push('API ISSUES:');
    details.push('Every provider returned rate-limit (429) errors. The APIs need time to reset their quota windows.');
    details.push('Try again in a few minutes, or add API keys for additional providers to spread the load.');
  } else if (errorType === 'auth' || errorType === 'billing') {
    details.push('');
    details.push('API ISSUES:');
    details.push('API keys are invalid or accounts have no remaining quota.');
    details.push('Check your API keys in Settings > API Keys and ensure each account has balance.');
  } else if (errorType === 'overloaded') {
    details.push('');
    details.push('API ISSUES:');
    details.push('All providers are currently at capacity.');
    details.push('Try again shortly — demand usually drops within a few minutes.');
  } else if (capabilityFailedModels.length === 0) {
    details.push('');
    details.push(`Last error: ${lastError}`);
    details.push('Try again, or check your network connection and API key status.');
  }

  details.push('');
  details.push(`Models tried: ${triedModels.join(', ')}`);
  if (candidateErrors?.length) {
    details.push('');
    details.push('Per-model errors:');
    for (const entry of candidateErrors.slice(0, 6)) {
      details.push(`  - ${entry.label}: ${entry.error}`);
    }
    if (candidateErrors.length > 6) details.push(`  - …and ${candidateErrors.length - 6} more`);
  }
  return `${header}\n${details.join('\n')}`;
}

import { routeForcedResearchTool } from './research-routing.js';
import { isExplicitActionFailure, isUnfulfilledActionPromise, requiresToolExecution } from './completion-guards.js';
import { selectLocalModelTools } from './local-tool-routing.js';
import { buildRecoveryHandoff, type RecoveryHandoffOptions } from './recovery-handoff.js';
import { settings } from '../settings/store.js';
import { learnFromCompletedResponse, learnFromRunOutcome, learnFromToolResult } from './learning-adapter.js';
import { missingRequiredTaskActions, type SuccessfulToolAction } from './task-coverage.js';
import { buildToolRecoveryDirective, toolAttemptSignature, type FailedToolAttempt } from './tool-recovery.js';
import { ProblemTracker } from './problem-tracker.js';
const decisionRouter = new DecisionRouter({ costOptimization: true, fallbackToLocal: true });
const liveInterjections = new Map<string, string[]>();

export { decisionRouter };

export function interjectAgent(sessionId: string, message: string): void {
  const queue = liveInterjections.get(sessionId) ?? [];
  queue.push(message);
  liveInterjections.set(sessionId, queue);
}

function drainInterjections(sessionId: string): string[] {
  const queue = liveInterjections.get(sessionId) ?? [];
  liveInterjections.delete(sessionId);
  return queue;
}

export interface AgentEvent {
  type:
    | 'message_start'
    | 'message_discard'
    | 'text_delta'
    | 'thinking_delta'
    | 'tool_use_start'
    | 'tool_use_delta'
    | 'tool_use_end'
    | 'tool_progress'
    | 'tool_result'
    | 'message_end'
    | 'provider_start'
    | 'provider_status'
    | 'fallback_required'
    | 'error'
    | 'done'
    | 'problem_report';
  [k: string]: unknown;
}

import { resolveThinkingPreference } from './thinking-preference.js';

export interface AgentRunOptions {
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  signal: AbortSignal;
  onEvent: (e: AgentEvent) => void;
  /** Per-run turn ceiling (work-until-done, WhatsApp caps). Wins over the agentMaxTurns setting. */
  maxTurns?: number;
  /** Per-run wall-clock ceiling in ms. Wins over the 15-minute default. */
  wallClockMs?: number;
  /**
   * Called the moment a message is finished with and added to the transcript.
   *
   * This exists because the transcript used to be written only after the whole
   * run returned. If the app restarted — which is exactly what happens when
   * Infinite AI edits its own main-process source — `runAgent` never resolved and
   * every tool call, result and reply it had already produced was lost, leaving a
   * transcript with the user's question and nothing else. Persisting as it goes
   * means a restart costs the user the in-flight turn, not the whole session.
   *
   * Callers persist; the loop just reports. It must not throw.
   */
  onMessage?: (message: Message) => void | Promise<void>;
}

/**
 * A failed turn's partial assistant message keeps its streamed content instead
 * of vanishing (failover used to pop the message and tell the UI to discard
 * it, wiping everything the previous model had already shown). All tool_use
 * blocks are dropped — the message is still last, so no results can exist for
 * them, and orphan tool calls break strict providers. Returns true when
 * anything worth keeping (visible text or media) remains; false means pop +
 * discard as before.
 */
export function keepPartialAssistant(assistant: Message): boolean {
  const content = assistant.content ?? [];
  assistant.content = content.filter((block) => block.type !== 'tool_use');
  return assistant.content.some((block) => {
    if (block.type === 'text') return block.text.trim().length > 0;
    if (block.type === 'tool_result') return false;
    return true;
  });
}

/**
 * Report every message added since the last check, in order.
 *
 * Called at turn boundaries rather than at each `messages.push`, so there is a
 * single place to keep correct and no push site can be forgotten. Persistence
 * failures must not take the run down — the work is already done and the caller
 * still gets it from the returned array.
 */
async function reportNewMessages(
  messages: Message[],
  reportedCount: { value: number },
  opts: AgentRunOptions,
): Promise<void> {
  if (!opts.onMessage) return;
  while (reportedCount.value < messages.length) {
    const message = messages[reportedCount.value++];
    try {
      await opts.onMessage(message);
    } catch (err) {
      console.warn('[loop] streaming a message to the transcript failed:', err);
    }
  }
}

export async function runAgent(
  history: Message[],
  userMessage: Message,
  opts: AgentRunOptions,
): Promise<Message[]> {
  const messages = [...history, userMessage];
  // How much of `messages` the caller has already been told about. The history
  // and the user message are the caller's to record, so the run only reports
  // what it produces itself.
  const reportedCount = { value: history.length + 1 };
  // Failover kill-switch (Settings → Providers): when OFF, only the selected
  // model is ever tried — its real error surfaces instead of a substitution.
  const failoverEnabled = settings.get('failoverEnabled') !== false;
  let failoverPlan = await buildProviderFailoverPlan({ provider: opts.provider, model: opts.model });
  if (!failoverEnabled && failoverPlan.length > 1) {
    failoverPlan = failoverPlan.slice(0, 1);
  }
  if (failoverPlan.length === 0) {
    opts.onEvent({ type: 'fallback_required' });
    return messages;
  }
  // Honest routing: if the selected provider never made the plan (no saved
  // key), say so up front instead of silently answering from another model.
  // This is the "I picked X but Y answered" confusion.
  if (failoverPlan[0].provider !== opts.provider) {
    const { getProvider } = await import('../providers/registry.js');
    const selected = getProvider(opts.provider);
    const needsKey = selected?.requiresApiKey ?? false;
    const reason = needsKey
      ? `No API key saved for ${selected?.label ?? opts.provider} — add one in Settings → Providers${failoverEnabled ? `, or keep chatting on ${failoverPlan[0].label}` : ' and try again (model fallback is OFF)'}.`
      : `${opts.provider}/${opts.model} is not available${failoverEnabled ? ` — using ${failoverPlan[0].label} instead` : ' and model fallback is OFF'}.`;
    opts.onEvent({
      type: 'provider_status',
      status: 'failover',
      from: `${opts.provider}/${opts.model}`,
      to: failoverPlan[0].label,
      reason,
    });
    console.warn(`[agent] Selected ${opts.provider}/${opts.model} unavailable at plan time; starting on ${failoverPlan[0].label}`);
    if (!failoverEnabled) {
      // No silent substitution: surface the real problem as the turn result.
      const errMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: `**${selected?.label ?? opts.provider} is not usable right now.**\n\n${reason}` }],
        timestamp: Date.now(),
      };
      return [...messages, errMsg];
    }
  }
  let activeCandidate: ProviderCandidate = failoverPlan[0];
  let failoverIndex = 0;
  // Sticky auto-switch bookkeeping: what killed the user's explicit selection
  // (first failure only), and whether the recovered model has already been
  // saved as the new active model for this run.
  let selectedModelHardFailure: string | null = null;
  let autoSwitchPersisted = false;
  // Bounded by default so a stuck model cannot loop for hours. The setting
  // remains an explicit opt-in to raise the ceiling; a per-run override
  // (work-until-done, WhatsApp turn caps) wins over both.
  const configuredTurns = settings.get('agentMaxTurns') as number | undefined;
  const budget = resolveRunBudget({
    configuredTurns,
    overrideTurns: opts.maxTurns,
    overrideWallClockMs: opts.wallClockMs,
  });
  const MAX_TURNS = budget.maxTurns;
  const WALL_CLOCK_LIMIT_MS = budget.wallClockMs;
  const MAX_INTENT_ONLY_RETRIES = 2;
  let intentOnlyRetries = 0;
  // Same-model stream retry budget: transient hiccups retry on the active
  // candidate before any failover. Reset after every clean turn.
  let sameModelStreamRetries = 0;
  // Failover-candidate retry budget: non-selected models get fewer retries.
  let failoverCandidateRetries = 0;
  // Empty model output gets one same-model retry — usually a transient glitch.
  let emptyResponseRetries = 0;
  // Capability tracker: detects when a model is overmatched for the task.
  const capTracker = createCapabilityTracker();
  let lastToolBatchHadError = false;
  let successfulToolExecutions = 0;
  let recoveryContext: Pick<RecoveryHandoffOptions, 'failedProvider' | 'failedModel' | 'stage' | 'failure'> | null = null;
  const originalRequest = messageText(userMessage);
  const taskContext = [...history.slice(-6), userMessage]
    .filter((message) => message.role === 'user')
    .map(messageText)
    .join('\n');
  const runStartedAt = Date.now();
  const performanceMetrics = {
    totalToolExecutionMs: 0,
    totalStreamMs: 0,
    toolCalls: 0,
    parallelToolCalls: 0,
    sequentialToolCalls: 0,
    failovers: 0,
    retries: 0,
  };
  const successfulToolNames = new Set<string>();
  const successfulToolActions: SuccessfulToolAction[] = [];
  // Ids of display-only remote-runtime tool calls (synthesized from provider
  // telemetry). They render as cards but must never execute locally.
  const remoteTelemetryIds = new Set<string>();
  // Edit→verify→fix loop (the Claude Code discipline): tracks whether file edits
  // are still unverified. Set on successful Write/Edit, cleared on a passing Verify.
  let editsSinceVerify = false;
  let editsThisRun = false;
  let verifyGuardPrompts = 0;
  let claimRevisionRounds = 0;
  const runSystemPrompts = new Map<string, string>();
  const failedAttemptCounts = new Map<string, number>();
  const problemTracker = new ProblemTracker();
  // Per-candidate failure log for the exhausted-run diagnosis (loop.ts): the
  // final message names every model tried and why each one failed instead of
  // only the last error.
  const candidateErrors: Array<{ label: string; error: string }> = [];

  // Experience learning hook: record exactly one outcome per run, at the
  // terminal event, without threading bookkeeping through every early return.
  // `verified` is mechanically derived (no edits, or Verify ran after the last
  // edit) rather than trusting the model's summary.
  const outcomeRecorded = { value: false };
  const callerOnEvent = opts.onEvent;
  opts = {
    ...opts,
    onEvent: (event) => {
      try {
        if (!outcomeRecorded.value && event.type === 'done' && event.success) {
          outcomeRecorded.value = true;
          learnFromRunOutcome({
            task: originalRequest,
            provider: activeCandidate.provider,
            model: activeCandidate.model,
            outcome: 'success',
            verified: !editsThisRun || !editsSinceVerify,
            tools: [...successfulToolNames],
            durationMs: Date.now() - runStartedAt,
          });
        } else if (!outcomeRecorded.value && event.type === 'fallback_required') {
          outcomeRecorded.value = true;
          learnFromRunOutcome({
            task: originalRequest,
            provider: activeCandidate.provider,
            model: activeCandidate.model,
            outcome: 'failure',
            verified: false,
            tools: [...successfulToolNames],
            durationMs: Date.now() - runStartedAt,
            failure: typeof event.error === 'string' ? event.error : 'The run ended without a verified result.',
          });
        }
      } catch {
        // Learning is advisory; it must never break the run's terminal event.
      }
      callerOnEvent(event);
    },
  };

  // ── Autonomous Agent Architecture: Prompt Architect → Critic → Execution Brief ──
  // For non-trivial objectives, derive a compact execution brief once per run.
  // Trivial greetings skip this to stay fast.
  let executionBrief: import('./execution-brief.js').ExecutionBrief | null = null;
  let criticReport: import('./prompt-critic.js').CriticReport | null = null;
  const isSignificantTask = originalRequest.trim().length >= 24;
  if (isSignificantTask) {
    try {
      const { architectBrief } = await import('./prompt-architect.js');
      const { critiqueBrief, applyPatch } = await import('./prompt-critic.js');
      const brief = architectBrief(originalRequest, { cwd: opts.cwd, model: opts.model, provider: opts.provider });
      const report = critiqueBrief(brief);
      const patched = report.patch && Object.keys(report.patch).length ? applyPatch(brief, report.patch) : brief;
      executionBrief = patched;
      criticReport = report;
      if (report.issues.length) {
        const warn = report.issues.filter((i) => i.severity !== 'info').map((i) => `${i.severity}: ${i.message}`).join(' | ');
        if (warn) console.log(`[architect] Critic: ${report.verdict} — ${warn}`);
      }
    } catch (e) {
      console.warn('[architect] Brief generation failed, using fallback:', (e as Error).message);
    }
  }


  const switchCandidate = (failure: string, assistant: Message, stage: string): boolean => {
    recordProviderFailure(activeCandidate, failure);
    candidateErrors.push({ label: activeCandidate.label, error: failure.slice(0, 220) });
    // Remember why the USER'S selection died — only a hard failure (dead key,
    // quota, retired model) earns a persistent auto-switch. A transient blip
    // (timeout, 5xx) recovers in-run and must never silently replace the model
    // the user picked.
    if (
      !selectedModelHardFailure
      && activeCandidate.provider === opts.provider
      && activeCandidate.model === opts.model
    ) {
      selectedModelHardFailure = failure;
    }
    // Kill-switch: never leave the selected model. The caller surfaces the
    // real error instead of substituting another model.
    if (!failoverEnabled) return false;
    if (messages.at(-1) === assistant && !keepPartialAssistant(assistant)) {
      messages.pop();
      opts.onEvent({ type: 'message_discard', message_id: assistant.id });
    }
    const remaining = failoverPlan.slice(failoverIndex + 1);
    const needsNativeTools = /remaining required (?:desktop )?actions?|does not support tool|did not execute the required tool/i.test(failure);
    const next = (needsNativeTools
      ? remaining.find((candidate) => providerSupportsTools(candidate.provider, candidate.model))
      : undefined) ?? selectNextProviderCandidate(failoverPlan, failoverIndex, activeCandidate, failure);
    if (!next) return false;
    recoveryContext = {
      failedProvider: activeCandidate.provider,
      failedModel: activeCandidate.model,
      stage,
      failure,
    };
    failoverIndex = failoverPlan.indexOf(next);
    // The user must see WHY their selected model is being left: the real
    // provider error travels in `reason` (the UI renders it). A switch
    // without a reason looks like the selection was never tried.
    opts.onEvent({
      type: 'provider_status',
      status: 'failover',
      from: activeCandidate.label,
      to: next.label,
      reason: failure,
    });
    console.warn(`[agent] Recovering in background: ${activeCandidate.label} -> ${next.label}: ${failure}`);
    performanceMetrics.failovers++;
    activeCandidate = next;
    return true;
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Flush anything the previous turn produced before starting the next one.
    // Reported from here rather than at each `messages.push` so no push site can
    // be missed — the transcript is written as work completes, not only when the
    // whole run returns, so a restart mid-run keeps what was already done.
    await reportNewMessages(messages, reportedCount, opts);
    if (Date.now() - runStartedAt > WALL_CLOCK_LIMIT_MS) {
      opts.onEvent({ type: 'error', error: `Run exceeded ${Math.round(WALL_CLOCK_LIMIT_MS / 60000)} min wall-clock limit. Stopping and reporting.` });
      opts.onEvent({ type: 'fallback_required', error: `Wall-clock limit (${Math.round(WALL_CLOCK_LIMIT_MS / 60000)} min)` });
      break;
    }
    problemTracker.setTurn(turn);
    if (opts.signal.aborted) break;

    // Auto-compaction: before building this turn's request, summarize old
    // turns when history approaches the model's context window. Long tool-heavy
    // runs (the ones that matter) no longer silently lose their oldest context.
    if (turn > 0 && providerSupportsTools(activeCandidate.provider, activeCandidate.model)) {
      try {
        const contextBudget = getProvider(activeCandidate.provider)?.freeModels.find((item) => item.id === activeCandidate.model)?.context_window ?? 64_000;
        if (shouldCompact(messages, contextBudget)) {
          const summarize = async (prompt: string): Promise<string> => {
            const { getProvider: getProviderForSummarizer } = await import('../providers/registry.js');
            // Local-first: the summarizer is a background chore — prefer a free
            // local model when Ollama has one, then the active candidate.
            const { listOllamaModels } = await import('../ollama/utils.js');
            const localModels = await listOllamaModels().catch(() => []);
            let summarizerProvider = getProvider(activeCandidate.provider);
            let summarizerModel = activeCandidate.model;
            if (localModels.length > 0) {
              const local = getProviderForSummarizer('ollama');
              if (local) {
                summarizerProvider = local;
                summarizerModel = localModels[0].id;
              }
            }
            const collected: string[] = [];
            if (!summarizerProvider) throw new Error('summarizer provider unavailable');
            const stream = summarizerProvider.streamChat({
              model: summarizerModel,
              cwd: opts.cwd,
              messages: [{ id: 'compaction', role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }],
              system: 'You compress agent-work transcripts into structured handoff notes. Keep file paths, commands, error messages, and decisions exact. No preamble — only the requested sections.',
              stream: true,
              signal: opts.signal,
            }, activeCandidate.apiKey);
      for await (const chunk of stream) {
              if (chunk.type === 'text_delta') collected.push(chunk.text);
              if (chunk.type === 'error') throw new Error(chunk.error);
            }
            return collected.join('');
          };
          const result = await compactMessages({ messages, contextTokenBudget: contextBudget, originalRequest, summarize, onEvent: (detail) => opts.onEvent({ type: 'provider_status', status: detail }) });
          if (result) {
            // Replace history in place: the array identity is shared with the
            // caller, so splice instead of reassigning.
            messages.splice(0, messages.length, ...result.messages);
            console.log(`[agent] Compacted context: ${result.stats.originalMessages} → ${result.stats.compactedMessages} messages (summarized ${result.stats.summarizedTurns} turns)`);
          }
        }
      } catch (e) {
        // Compaction is best-effort; a failure must never kill the run.
        console.warn('[agent] Compaction skipped:', (e as Error).message);
      }
    }

    const activeProvider = getProvider(activeCandidate.provider);
    if (!activeProvider) {
      recordProviderFailure(activeCandidate, 'Provider unavailable');
      const placeholder: Message = { id: crypto.randomUUID(), role: 'assistant', content: [], timestamp: Date.now() };
      if (switchCandidate('Provider unavailable', placeholder, 'provider selection')) continue;
  opts.onEvent({ type: 'fallback_required' });
      return messages;
    }
    const activeToolsEnabled = providerSupportsTools(activeCandidate.provider, activeCandidate.model);
    const allActiveTools = activeToolsEnabled ? toolRegistry.asProviderTools() : [];
    const requestContext = [...history.slice(-6), userMessage].map(messageText).join('\n');
    // CORE TOOL SET — ~24 essential tools sent every turn. Cuts ~15k tokens vs 50.
    // Non-core tools (CodeReview, Regex, CSV, etc.) are available via Agent spawning.
    // Canonical list lives in tools/base.ts (CORE_TOOL_NAMES) so renames can't orphan tools.
    const CORE_TOOL_SET = CORE_TOOL_NAMES;
    // Dynamic tool selection: on the first turn, prefer the brief's tool hints if present
    // (already a filtered, task-aware set). Fall back to CORE set after that.
    let activeTools: ReturnType<typeof toolRegistry.asProviderTools>;
    if (activeCandidate.provider === 'ollama') {
      activeTools = selectLocalModelTools(requestContext, allActiveTools);
    } else if (turn === 0 && executionBrief?.toolHints.length) {
      const hintSet = new Set(executionBrief.toolHints);
      const hinted = allActiveTools.filter((t) => hintSet.has(t.name));
      activeTools = hinted.length >= 6 ? hinted : allActiveTools.filter((t) => CORE_TOOL_SET.has(t.name));
    } else {
      activeTools = allActiveTools.filter((t) => CORE_TOOL_SET.has(t.name));
    }
    const systemKey = `${activeCandidate.provider}/${activeCandidate.model}/${activeTools.map((tool) => tool.name).join(',')}`;
    let activeSystem = runSystemPrompts.get(systemKey);
    if (!activeSystem) {
      let systemText = await buildSystemPrompt({
        ...opts,
        provider: activeCandidate.provider,
        model: activeCandidate.model,
        toolsEnabled: activeToolsEnabled,
        attachedToolNames: activeTools.map((tool) => tool.name),
      });
      // Inject the execution brief + critic notes as high-priority task context
      if (executionBrief) {
        const { renderDynamicBriefBlock } = await import('./dynamic-context.js');
        const briefBlock = renderDynamicBriefBlock(executionBrief);
        systemText += `\n\n${briefBlock}`;
        // Surface critic warnings so the model self-corrects before acting
        const warnings = criticReport?.issues.filter((i) => i.severity === 'warn') ?? [];
        if (warnings.length) {
          systemText += `\n\n[Critic notes — address before executing]\n` + warnings.map((w) => `- ${w.message} — ${w.fix}`).join('\n');
        }
      }
      activeSystem = systemText;
      runSystemPrompts.set(systemKey, activeSystem);
    }
    for (const update of drainInterjections(opts.sessionId)) {
      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: `[User update while you were working]: ${update}` }],
        timestamp: Date.now(),
      });
    }

    const forcedTool = turn === 0 ? forcedToolForRequest(userMessage, history) : null;
    const assistant: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: [],
      timestamp: Date.now(),
      model: activeCandidate.model,
      provider: activeCandidate.provider,
      requested_model: opts.model,
      requested_provider: opts.provider,
    };
    messages.push(assistant);
    opts.onEvent({ type: 'message_start', message_id: assistant.id });
    // Surface real progress to the UI BEFORE we touch the network so the user
    // never stares at a static "Thinking…" bubble with no signal.
    opts.onEvent({
      type: 'provider_start',
      message_id: assistant.id,
      provider: activeCandidate.provider,
      model: activeCandidate.model,
      requested_provider: opts.provider,
      requested_model: opts.model,
      turn,
    });
    let providerFailure = '';

    if (forcedTool) {
      const block: ContentBlock = { type: 'tool_use', id: crypto.randomUUID(), name: forcedTool.name, input: forcedTool.input };
      assistant.content.push(block);
      assistant.stop_reason = 'tool_use';
      opts.onEvent({ type: 'tool_use_start', message_id: assistant.id, tool_use_id: block.id, name: block.name });
      opts.onEvent({ type: 'tool_use_end', message_id: assistant.id, tool_use_id: block.id, name: block.name, input: block.input });
      opts.onEvent({ type: 'message_end', message_id: assistant.id, stop_reason: 'tool_use' });
    } else {

    // Rebuild the checkpoint on every continuation turn so it includes tool
    // results produced after the original provider switch.
    const recoveryHandoff = recoveryContext
      ? buildRecoveryHandoff({
          originalRequest,
          ...(recoveryContext as Pick<RecoveryHandoffOptions, 'failedProvider' | 'failedModel' | 'stage' | 'failure'>),
          successfulToolExecutions,
          messages: messages.slice(0, -1),
        })
      : null;
    // Stall watchdog: create a local AbortController so we can actually abort
    // the fetch (.abort() kills the connection, unlike dispatchEvent which only
    // fires listeners). Parent abort cascades: user abort → controller aborts.
    const streamController = new AbortController();
    const onParentAbort = () => streamController.abort();
    opts.signal.addEventListener('abort', onParentAbort, { once: true });
    const streamStartTime = Date.now();
    // Local models are free but slow to cold-start and eval long prompts —
    // give Ollama 4x the stall budget instead of killing its first answer.
    const stallBudgetMs = activeCandidate.provider === 'ollama' ? 240_000 : LOOP_STREAM_STALL_TIMEOUT_MS;

    const stream = activeProvider.streamChat(
      {
        model: activeCandidate.model,
        cwd: opts.cwd,
        messages: await buildContext(
          recoveryHandoff ? [...messages.slice(0, -1), recoveryHandoff] : messages.slice(0, -1),
          { cwd: opts.cwd, maxTokens: activeProvider.freeModels.find((item) => item.id === activeCandidate.model)?.context_window },
        ),
        system: activeSystem,
        tools: activeTools,
        stream: true,
        signal: streamController.signal,
        ...resolveThinkingPreference(activeCandidate.provider),
      },
      activeCandidate.apiKey,
    );

    const pendingToolCalls: Map<string, { name: string; json: string }> = new Map();
    // Coalesce tiny text deltas into ~50ms frames: the first token still
    // lands instantly, but fast streams stop re-rendering the UI per token.
    const deltaCoalescer = new StreamCoalescer({
      onFlush: (text) => opts.onEvent({ type: "text_delta", message_id: assistant.id, text }),
    });
    // Stream tool calls AS THEY FORM: name announced early, partial input JSON
    // batched into ~40ms frames (snapshot semantics) so the renderer's card
    // grows live instead of appearing fully-formed after the call completes.
    const toolArgCoalescer = new ToolCallArgCoalescer({
      onDelta: ({ id, name, partialJson }) => {
        if (name) opts.onEvent({ type: "tool_use_start", message_id: assistant.id, tool_use_id: id, name });
        if (partialJson) opts.onEvent({ type: "tool_use_delta", message_id: assistant.id, tool_use_id: id, partial_json: partialJson });
      },
    });

    let streamLastEvent = Date.now();
    let streamStallInterval: ReturnType<typeof setInterval> | undefined;

    try {
      streamStallInterval = setInterval(() => {
        if (providerFailure) return;
        if (Date.now() - streamLastEvent >= stallBudgetMs) {
          providerFailure = `Agent stream stalled (no events for ${Math.round(stallBudgetMs / 1000)}s)`;
          console.error(`[agent] ${providerFailure} — aborting stream`);
          streamController.abort();
        }
      }, Math.min(30_000, stallBudgetMs / 4));

      for await (const chunk of stream) {
        streamLastEvent = Date.now();
        if (opts.signal.aborted) break;
        switch (chunk.type) {
          case 'text_delta':
            appendOrCreate(assistant.content, { type: 'text', text: chunk.text });
            deltaCoalescer.push(chunk.text);
            break;
          case 'thinking_delta':
            // The model's reasoning, kept in its own block so the UI can show it
            // separately from the answer and so it is never replayed to the model
            // on the next turn. Stored on the same assistant message that will
            // carry the answer, which is what makes it survive a reload.
            appendOrCreate(assistant.content, { type: 'thinking', text: chunk.text });
            // Forwarded live so the user watches the reasoning arrive, which is
            // what turns a minute of silence into visible progress.
            opts.onEvent({ type: 'thinking_delta', message_id: assistant.id, text: chunk.text });
            break;
          case 'tool_use_start':
            pendingToolCalls.set(chunk.id, { name: chunk.name, json: '' });
            toolArgCoalescer.start(chunk.id, chunk.name);
            break;
          case 'tool_use_delta': {
            const existing = pendingToolCalls.get(chunk.id);
            if (existing) {
              existing.json += chunk.partial_json;
            } else {
              pendingToolCalls.set(chunk.id, { name: '', json: chunk.partial_json });
            }
            const tracked = pendingToolCalls.get(chunk.id)!;
            toolArgCoalescer.delta(chunk.id, tracked.json, tracked.name);
            break;
          }
          case 'tool_use_end': {
            const pending = pendingToolCalls.get(chunk.id);
            const name = pending?.name ?? chunk.name ?? '';
            const jsonStr = pending?.json ?? '';
            let parsed: unknown = {};
            try { parsed = JSON.parse(jsonStr); } catch { /* leave as {} */ }
            if (pending) {
              pending.name = name;
            }
            const block: ContentBlock = { type: 'tool_use', id: chunk.id, name, input: parsed };
            assistant.content.push(block);
            pendingToolCalls.delete(chunk.id);
            toolArgCoalescer.end(chunk.id, name);
            opts.onEvent({ type: 'tool_use_end', message_id: assistant.id, tool_use_id: chunk.id, name, input: parsed });
            break;
          }
          case 'provider_progress':
            if (chunk.status === 'completed') successfulToolExecutions++;
            // Remote-runtime telemetry (OpenCode local loop) is display-only:
            // synthesize content blocks so each remote tool call renders a
            // live ToolCallCard, but NEVER execute them locally (the runtime
            // already ran them — see the remoteTelemetryIds exclusion below).
            {
              const tid = typeof chunk.id === 'string' && chunk.id ? chunk.id : '';
              const tname = typeof chunk.name === 'string' && chunk.name ? chunk.name : '';
              if (tid && tname && !remoteTelemetryIds.has(tid) && !pendingToolCalls.has(tid)) {
                remoteTelemetryIds.add(tid);
                const block: ContentBlock = { type: 'tool_use', id: tid, name: tname, input: chunk.input ?? {} };
                assistant.content.push(block);
                opts.onEvent({ type: 'tool_use_start', message_id: assistant.id, tool_use_id: tid, name: tname });
              }
              if (tid && remoteTelemetryIds.has(tid) && (chunk.status === 'completed' || chunk.status === 'error')) {
                opts.onEvent({ type: 'tool_use_end', message_id: assistant.id, tool_use_id: tid, name: tname || chunk.name, input: chunk.input ?? {} });
              }
            }
            opts.onEvent({
              type: 'tool_progress',
              tool_use_id: chunk.id,
              name: chunk.name,
              status: chunk.status,
              input: chunk.input,
              detail: chunk.detail,
            });
            break;
          case 'provider_status':
            // Surface a real, provider-specific status to the UI so the user
            // can see "Connecting to OpenRouter/Llama 3.3 70B" instead of a
            // frozen "Thinking…" bubble.
            opts.onEvent({
              type: 'provider_status',
              status: chunk.status,
              provider: chunk.provider,
              model: chunk.model,
              from: chunk.from,
              to: chunk.to,
              reason: chunk.reason,
            });
            break;
          case 'message_end':
            assistant.stop_reason = chunk.stop_reason as Message['stop_reason'];
            assistant.usage = chunk.usage;
            // Record what this response actually cost. Providers already report
            // usage per response and the pricing table knows how to turn it
            // into money; nothing was doing that, so the numbers were captured
            // and discarded.
            recordUsage(chunk.usage, activeCandidate.provider, activeCandidate.model);
            opts.onEvent({ type: 'message_end', message_id: assistant.id, stop_reason: chunk.stop_reason, usage: chunk.usage });
            break;
          case 'error':
            console.error(`[agent] Stream error: ${chunk.error}`);
            // First failure wins: the stall watchdog sets providerFailure
            // BEFORE aborting, and the abort then surfaces as a bare
            // 'Request cancelled' chunk — it must never clobber the real
            // stall message, or every stall burns the whole failover plan
            // under a meaningless last error.
            if (!providerFailure) providerFailure = chunk.error;
            break;
        }
        if (providerFailure) break;
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      console.error('[agent] Stream loop error:', error.message);
      if (!providerFailure) providerFailure = error.message;
    } finally {
      if (streamStallInterval) clearInterval(streamStallInterval);
      deltaCoalescer.dispose();
      toolArgCoalescer.dispose();
      opts.signal.removeEventListener('abort', onParentAbort);
      performanceMetrics.totalStreamMs += Date.now() - streamStartTime;
    }
    }

    if (providerFailure) {
      decisionRouter.recordTask(activeCandidate.model, false);
      const isSelectedModel = failoverIndex === 0;
      const maxRetries = isSelectedModel ? SAME_MODEL_STREAM_RETRIES : FAILOVER_CANDIDATE_RETRIES;
      const retryCounter = isSelectedModel ? sameModelStreamRetries : failoverCandidateRetries;
      if (isTransientStreamFailure(providerFailure) && retryCounter < maxRetries) {
        // Transient hiccup (stall, 5xx, network blip, overload, rate limit):
        // stay on the current model and retry with an appropriate backoff.
        // The retry is announced (not console-only) so "Calling X…" never
        // looks stuck and the user sees the model genuinely being retried.
        const attempt = retryCounter + 1;
        if (isSelectedModel) sameModelStreamRetries++; else failoverCandidateRetries++;
        performanceMetrics.retries++;
        opts.onEvent({
          type: 'provider_status',
          status: 'retrying',
          provider: activeCandidate.provider,
          model: activeCandidate.model,
          reason: `Attempt ${attempt}/${maxRetries} on ${activeCandidate.label} after: ${providerFailure}`,
        });
        if (messages.at(-1) === assistant && !keepPartialAssistant(assistant)) {
          messages.pop();
          opts.onEvent({ type: 'message_discard', message_id: assistant.id });
        }
        const delayMs = backoffForError(providerFailure, retryCounter);
        console.warn(`[agent] Transient failure on ${activeCandidate.label} (retry ${retryCounter + 1}/${maxRetries}, backoff ${delayMs}ms): ${providerFailure}`);
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      if (switchCandidate(providerFailure, assistant, 'model response stream')) continue;
      // All candidates exhausted — the full diagnosis (models tried + last
      // error) travels on the event so the UI shows the real problem
      // instead of silently substituting another answer.
      const errorMsg = buildExhaustedMessage(failoverPlan, providerFailure, capTracker, candidateErrors);
      opts.onEvent({ type: 'provider_status', status: errorMsg });
      opts.onEvent({ type: 'fallback_required', error: errorMsg });
      return messages;
    }
    // A clean turn resets the retry budgets.
    sameModelStreamRetries = 0;
    failoverCandidateRetries = 0;

    if (opts.signal.aborted) break;

    // If no tool calls → done
    const allToolUses = assistant.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    // Display-only remote telemetry never executes locally (already ran remotely).
    const toolUses = allToolUses.filter((tu) => tu.name?.trim() && !remoteTelemetryIds.has(tu.id));
    const emptyToolUses = allToolUses.filter((tu) => !tu.name?.trim());

    // Emit synthetic errors for empty tool names so the model sees the
    // problem immediately without burning a full execution cycle.
    for (const tu of emptyToolUses) {
      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: tu.id, content: 'Error: tool_use block has an empty tool name. Every tool_use block must include a non-empty name field matching one of the registered tool names.', is_error: true }],
        timestamp: Date.now(),
      });
      opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, content: 'Error: empty tool name', is_error: true });
    }

    if (!toolUses.length) {
      // Edit→verify→fix guard: never finish a run with unverified file edits.
      // Bounded (2 prompts) so a stubborn model still terminates via MAX_TURNS.
      if (editsSinceVerify && verifyGuardPrompts < 2) {
        verifyGuardPrompts++;
        performanceMetrics.retries++;
        messages.push({
          id: crypto.randomUUID(),
          role: 'user',
          content: [{
            type: 'text',
            text: '[Verification guard]: You modified files this run but have not run the Verify tool since the last edit. Run Verify now (quick checks first), fix every failure, and re-run it until green. Only then write your final summary. If the workspace has no supported checks, say so explicitly and finish.',
          }],
          timestamp: Date.now(),
        });
        continue;
      }
      // Harness-enforced: after the reminder budget is exhausted, a run that
      // still ends with unverified edits is a FAILURE — not a success with a
      // footnote. The user sees exactly why; the next attempt (automation
      // retry, recovery attempt) starts knowing the rule is real.
      if (editsSinceVerify) {
        opts.onEvent({ type: 'error', error: 'Run ended with UNVERIFIED file edits — the model never ran the Verify tool after its last Edit/Write despite two reminders. The changes are on disk but unvalidated; review or re-run.' });
        opts.onEvent({ type: 'fallback_required', error: 'Unverified file edits: Verify was not run after the last edit.' });
        return messages;
      }

      // Run contract: file-claim verification. The final answer must not
      // claim writes that never happened — the real eval failure (a model
      // saying "Created ... verified" with zero writes) is caught HERE, in
      // the engine, before verified completion. One revision round carries
      // the exact missing paths; a repeat offender fails the run honestly.
      const assistantTextForClaims = assistant.content
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join(' ');
      if (assistantTextForClaims.trim()) {
        const claims = evaluateFileClaims(assistantTextForClaims, opts.cwd);
        if (claims.missing.length > 0) {
          if (claimRevisionRounds < 1) {
            claimRevisionRounds++;
            performanceMetrics.retries++;
            messages.push({
              id: crypto.randomUUID(),
              role: 'user',
              content: [{ type: 'text', text: renderClaimRevisionDirective(claims.missing) }],
              timestamp: Date.now(),
            });
            opts.onEvent({ type: 'provider_status', status: 'working', detail: `File-claim check failed (${claims.missing.length} phantom path(s)) — revision requested` });
            continue;
          }
          // Revision budget exhausted with phantom claims intact: honest failure.
          opts.onEvent({ type: 'error', error: `Run claimed ${claims.missing.length} file(s) that do not exist on disk after a revision round: ${claims.missing.join('; ').slice(0, 300)}. Refusing verified completion.` });
          opts.onEvent({ type: 'fallback_required', error: 'File-claim verification failed: the delivery includes files that do not exist.' });
          return messages;
        }
      }
      const updates = drainInterjections(opts.sessionId);
      if (updates.length > 0) {
        for (const update of updates) {
          messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: `[User update before completion]: ${update}` }],
            timestamp: Date.now(),
          });
        }
        continue;
      }
      const assistantText = assistant.content
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join(' ');
      const missingActions = missingRequiredTaskActions(originalRequest, successfulToolActions);
      const executionMissing = (requiresToolExecution(originalRequest) && successfulToolExecutions === 0) || missingActions.length > 0;
      if (isUnfulfilledActionPromise(originalRequest, assistantText) || executionMissing) {
        // Track this as a capability failure — the model promised but didn't deliver.
        const capType: CapabilityFailureType = isUnfulfilledActionPromise(originalRequest, assistantText) ? 'promise_only' : 'no_execution';
        recordCapabilityFailure(capTracker, activeCandidate, capType);
        const capCount = getCapabilityFailureCount(capTracker, activeCandidate);
        const capLabel = capType === 'promise_only' ? 'promised to act but did not' : 'did not use required tools';

        if (capCount >= CAPABILITY_FAILURE_THRESHOLD) {
          // This model is overmatched — skip it and try a stronger one.
          const strongerMsg = `Model ${activeCandidate.label} is not capable enough for this task (${capLabel}, ${capCount} consecutive failures). Switching to a stronger model.`;
          console.warn(`[agent] Capability threshold reached on ${activeCandidate.label}: ${strongerMsg}`);
          opts.onEvent({ type: 'provider_status', status: strongerMsg });
          if (switchCandidate(strongerMsg, assistant, 'capability detection')) {
            intentOnlyRetries = 0;
            failoverCandidateRetries = 0;
            continue;
          }
        }

        if (missingActions.length && !activeToolsEnabled &&
            switchCandidate(`This model does not support tool calls for the remaining required desktop actions: ${missingActions.join(', ')}.`, assistant, 'compound-action execution')) {
          intentOnlyRetries = 0;
          continue;
        }
        if (intentOnlyRetries < MAX_INTENT_ONLY_RETRIES) {
          intentOnlyRetries++;
          performanceMetrics.retries++;
          if (messages.at(-1) === assistant && !keepPartialAssistant(assistant)) {
            messages.pop();
            opts.onEvent({ type: 'message_discard', message_id: assistant.id });
          }
          messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{ type: 'text', text: `[Execution guard]: The request is not complete.${missingActions.length ? ` Remaining required actions: ${missingActions.join('; ')}.` : ' No required tool was called.'} Continue now with the real tools, observe every result, and only finish after verification.` }],
            timestamp: Date.now(),
          });
          continue;
        }
        if (switchCandidate('The model did not execute the required tool.', assistant, 'required-action execution')) {
          intentOnlyRetries = 0;
          continue;
        }
        opts.onEvent({ type: 'fallback_required', error: `${activeCandidate.label} did not execute the required tool for this task.` });
        return messages;
      }
      if (isExplicitActionFailure(originalRequest, assistantText)) {
        // Track this as a capability failure — the model explicitly said it can't.
        recordCapabilityFailure(capTracker, activeCandidate, 'explicit_failure');
        const capCount = getCapabilityFailureCount(capTracker, activeCandidate);

        if (capCount >= CAPABILITY_FAILURE_THRESHOLD) {
          const strongerMsg = `Model ${activeCandidate.label} explicitly stated it cannot perform this task (${capCount} times). Switching to a stronger model.`;
          console.warn(`[agent] Capability threshold reached on ${activeCandidate.label}: ${strongerMsg}`);
          opts.onEvent({ type: 'provider_status', status: strongerMsg });
          if (switchCandidate(strongerMsg, assistant, 'capability detection')) {
            intentOnlyRetries = 0;
            failoverCandidateRetries = 0;
            continue;
          }
        }

        if (switchCandidate('The model could not complete the requested action.', assistant, 'completion verification')) continue;
        opts.onEvent({ type: 'fallback_required', error: `${activeCandidate.label} could not complete the requested action.` });
        return messages;
      }
      if (!assistantText.trim()) {
        if (emptyResponseRetries < 1) {
          // An empty turn is usually a transient glitch, not a dead model —
          // retry the selected model once before failing over.
          emptyResponseRetries++;
          performanceMetrics.retries++;
          if (messages.at(-1) === assistant && !keepPartialAssistant(assistant)) {
            messages.pop();
            opts.onEvent({ type: 'message_discard', message_id: assistant.id });
          }
          continue;
        }
        if (switchCandidate('The model returned no usable response.', assistant, 'final-answer generation')) continue;
        opts.onEvent({ type: 'fallback_required', error: `${activeCandidate.label} returned no usable response.` });
        return messages;
      }
      if (lastToolBatchHadError) {
        // Track this as a capability failure — the model's edits introduced errors.
        recordCapabilityFailure(capTracker, activeCandidate, 'tool_error');
        const capCount = getCapabilityFailureCount(capTracker, activeCandidate);

        if (capCount >= CAPABILITY_FAILURE_THRESHOLD) {
          const strongerMsg = `Model ${activeCandidate.label} repeatedly introduced errors in its edits (${capCount} times). Switching to a more capable model.`;
          console.warn(`[agent] Capability threshold reached on ${activeCandidate.label}: ${strongerMsg}`);
          opts.onEvent({ type: 'provider_status', status: strongerMsg });
          if (switchCandidate(strongerMsg, assistant, 'capability detection')) {
            lastToolBatchHadError = false;
            intentOnlyRetries = 0;
            failoverCandidateRetries = 0;
            continue;
          }
        }

        if (switchCandidate('The model did not recover from a failed tool attempt.', assistant, 'tool-result recovery')) continue;
        opts.onEvent({ type: 'fallback_required', error: `${activeCandidate.label} did not recover from a failed tool attempt.` });
        return messages;
      }
      decisionRouter.recordTask(activeCandidate.model, true);
      recordProviderSuccess(activeCandidate);

      // Sticky auto-switch: the run had to leave the selected model because of
      // a hard failure, and this candidate just answered for real. Save it as
      // THE active model so the next turn — especially a phone turn that reads
      // settings directly — starts on the working model instead of
      // re-discovering the dead one. Opt out with Settings → autoSwitchModel.
      const switchedAway = activeCandidate.provider !== opts.provider || activeCandidate.model !== opts.model;
      const earnedSwitch = Boolean(selectedModelHardFailure) && !isTransientStreamFailure(selectedModelHardFailure ?? '');
      // Evaluation runs must never rewrite the user's active provider/model;
      // their failover is benchmark noise, not a preference change.
      if (
        switchedAway &&
        earnedSwitch &&
        !autoSwitchPersisted &&
        process.env.INFINITE_EVAL !== '1' &&
        settings.get('autoSwitchModel') !== false
      ) {
        autoSwitchPersisted = true;
        const from = `${opts.provider}/${opts.model}`;
        const reason = `Auto-switched: ${from} failed (${(selectedModelHardFailure ?? '').slice(0, 180)}) and ${activeCandidate.label} answered. Saved as the active model so the next turn starts here.`;
        void persistActiveModel(activeCandidate.provider, activeCandidate.model, opts.cwd)
          .catch((e) => console.warn('[agent] Auto-switch persistence failed:', (e as Error).message));
        opts.onEvent({
          type: 'provider_status',
          status: 'failover',
          from,
          to: activeCandidate.label,
          reason,
          // Renderer adoption: mark it sticky + carry ids so the UI can update
          // its own saved selection instead of reverting at next launch.
          sticky: true,
          provider: activeCandidate.provider,
          model: activeCandidate.model,
        });
        console.warn(`[agent] Sticky auto-switch saved: ${from} -> ${activeCandidate.provider}/${activeCandidate.model}`);
      }
      
      // Log performance metrics
      const totalRunMs = Date.now() - runStartedAt;
      console.log(`[agent] Run completed in ${totalRunMs}ms. Tools: ${performanceMetrics.toolCalls} (${performanceMetrics.parallelToolCalls} parallel, ${performanceMetrics.sequentialToolCalls} sequential). Stream: ${performanceMetrics.totalStreamMs}ms. Failovers: ${performanceMetrics.failovers}`);
      
      learnFromCompletedResponse({
        request: originalRequest,
        taskContext,
        response: assistantText,
        provider: activeCandidate.provider,
        model: activeCandidate.model,
        durationMs: Date.now() - runStartedAt,
        successfulTools: [...successfulToolNames],
      });
      // Report and auto-fix any tool failures encountered during the run.
      if (problemTracker.hasFailures()) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await problemTracker.reportAndFix(opts.onEvent as any, originalRequest);
      }
      opts.onEvent({ type: 'done', success: true });
      return messages;
    }

    // Execute tool calls — independent calls run in parallel for speed.
    // The model generates all tool_use blocks in a single turn without
    // observing intermediate results, so they are independent by construction.
    // Fan-out collapses N×latency to 1× for multi-tool turns.
    let toolBatchHadError = false;
    const batchFailures: FailedToolAttempt[] = [];

    // Tell the user what the agent is about to do, e.g. "Running 2 tools…"
    const toolCount = toolUses.length;
    if (toolCount > 0) {
      opts.onEvent({
        type: 'provider_status',
        status: 'working',
        detail: toolCount === 1
          ? `Executing ${toolUses[0]?.name ?? 'tool'}…`
          : `Executing ${toolCount} tools…`,
      });
    }

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
            parentSignal: opts.signal,
            onUpdate: (partial) => opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, partial: true, content: partial.content }),
          });
          return { tu, tool, result };
        } catch (e) {
          return { tu, tool, result: { content: (e as Error).message, is_error: true } };
        }
    };
    // Partition tool calls: parallel-safe tools run concurrently, unsafe ones run sequentially.
    // This avoids the all-or-nothing fallback where one unsafe tool forces everything sequential.
    const parallelBatch: typeof toolUses = [];
    const sequentialBatch: typeof toolUses = [];
    for (const tu of toolUses) {
      const tool = toolRegistry.get(tu.name);
      if (tool && isParallelSafeTool(tool.name)) {
        parallelBatch.push(tu);
      } else {
        sequentialBatch.push(tu);
      }
    }
    // Both chains start now and are awaited together. Waiting for the parallel
    // fan-out to drain before starting the sequential chain meant a mixed turn
    // paid the full duration of its slowest read-only tool before the first
    // Write or Bash even began. The model emits a whole batch without seeing
    // any of its results, so nothing in the sequential chain can depend on a
    // parallel result from the same turn — the same independence that justifies
    // fanning out in the first place. Order inside the sequential chain is
    // preserved, results are merged back into the model's order below, and the
    // fan-out is capped so a burst of searches cannot stampede a provider.
    const parallelRun = parallelBatch.length > 0
      ? mapWithConcurrency(parallelBatch, PARALLEL_TOOL_CONCURRENCY, executeOne)
      : Promise.resolve([]);
    const sequentialRun = (async () => {
      const results: Awaited<ReturnType<typeof executeOne>>[] = [];
      for (const tu of sequentialBatch) {
        results.push(await executeOne(tu));
      }
      return results;
    })();
    const [parallelResults, sequentialResults] = await Promise.all([parallelRun, sequentialRun]);
    
    // Track performance metrics
    performanceMetrics.toolCalls += toolUses.length;
    performanceMetrics.parallelToolCalls += parallelBatch.length;
    performanceMetrics.sequentialToolCalls += sequentialBatch.length;
    // Merge results preserving original order
    const resultOrder = new Map<string, number>();
    toolUses.forEach((tu, i) => resultOrder.set(tu.id, i));
    const allResults = [...parallelResults, ...sequentialResults];
    const batchResults = allResults.sort((a, b) => (resultOrder.get(a.tu.id) ?? 0) - (resultOrder.get(b.tu.id) ?? 0));

    // Process results in original order for deterministic message sequencing.
    for (const { tu, tool, result } of batchResults) {
      const canonicalName = tool?.name ?? tu.name;
      const signature = toolAttemptSignature(canonicalName, tu.input);
      const resultText = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      if (result.is_error) {
        toolBatchHadError = true;
        if (tool) {
          failedAttemptCounts.set(signature, (failedAttemptCounts.get(signature) ?? 0) + 1);
          batchFailures.push({ name: canonicalName, input: tu.input, error: resultText });
          problemTracker.trackFailure(canonicalName, tu.input, resultText);
        }
      } else {
        if (tool) {
          failedAttemptCounts.delete(signature);
        }
        successfulToolExecutions++;
        successfulToolNames.add(canonicalName);
        successfulToolActions.push({ name: canonicalName, input: tu.input });
        // Edit→verify→fix bookkeeping.
        if (canonicalName === 'Verify') editsSinceVerify = false;
        else if (canonicalName === 'Write' || canonicalName === 'Edit') editsSinceVerify = true;
        if (canonicalName === 'Write' || canonicalName === 'Edit') editsThisRun = true;
        learnFromToolResult({
          request: originalRequest,
          taskContext,
          tool: canonicalName,
          input: tu.input,
          output: result.content,
        });
      }

      messages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.is_error,
          // Third-party output (web pages, MCP replies, files) can carry
          // injected instructions. Marking it lets buildContext wrap it in
          // an explicit "untrusted data" frame so the model cannot mistake
          // it for a directive from the user.
          untrusted: UNTRUSTED_TOOL_NAMES.has(canonicalName),
        }],
        timestamp: Date.now(),
      });
      opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.is_error });
    }
    // PostToolUse auto-Verify: when a batch edited files, run the Verify tool
    // HARNESS-SIDE and feed the result back as a user note, so failures
    // surface on the very next turn instead of whenever the model decides to
    // check (or never — the old failure mode). Runs only when the model did
    // not already call Verify in the same batch; the injected result is a
    // user message, never an orphan tool_result (strict providers reject
    // results without a matching tool_use).
    const batchEditedFiles = batchResults.some(({ tool, result }) =>
      !result.is_error && (tool?.name === 'Write' || tool?.name === 'Edit'));
    const modelVerifiedThisBatch = toolUses.some((tu) => tu.name === 'Verify');
    if (batchEditedFiles && !modelVerifiedThisBatch) {
      const verifyTool = toolRegistry.get('Verify');
      if (verifyTool) {
        opts.onEvent({ type: 'provider_status', status: 'working', detail: 'Auto-verifying edits…' });
        const verifyId = crypto.randomUUID();
        try {
          const verifyResult = await executeToolCall({
            tool: verifyTool,
            toolUse: { type: 'tool_use', id: verifyId, name: 'Verify', input: {} },
            sessionId: opts.sessionId,
            cwd: opts.cwd,
            parentSignal: opts.signal,
            onUpdate: () => { /* verify progress stays off the transcript */ },
          });
          const verifyText = typeof verifyResult.content === 'string' ? verifyResult.content : JSON.stringify(verifyResult.content);
          performanceMetrics.toolCalls++;
          successfulToolExecutions++;
          successfulToolNames.add('Verify');
          if (!verifyResult.is_error) editsSinceVerify = false; // harness-verified counts
          messages.push({
            id: crypto.randomUUID(),
            role: 'user',
            content: [{
              type: 'text',
              text: `[Harness auto-Verify after your edits — ${verifyResult.is_error ? 'FAILED' : 'ran'}]:\n${verifyText.slice(0, 4_000)}`,
            }],
            timestamp: Date.now(),
          });
          opts.onEvent({ type: 'provider_status', status: 'working', detail: verifyResult.is_error ? 'Auto-verify FAILED — fixing required' : 'Auto-verify passed' });
        } catch (verifyErr) {
          // Verify tool timeout/abort must never kill the run — the end-of-run
          // guard still applies.
          console.warn('[agent] auto-Verify failed:', (verifyErr as Error).message);
        }
      }
    }
    if (batchFailures.length) {
      messages.push({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: buildToolRecoveryDirective(batchFailures) }], timestamp: Date.now() });
    }
    lastToolBatchHadError = toolBatchHadError;
  }

  // Report failures on abort or fallback exit too.
  if (problemTracker.hasFailures()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await problemTracker.reportAndFix(opts.onEvent as any, originalRequest);
  }
  if (opts.signal.aborted) opts.onEvent({ type: 'done', success: false });
  else opts.onEvent({ type: 'fallback_required' });
  return messages;
}

/**
 * Tools whose output is third-party content the model must treat as data.
 * Web pages, browser snapshots, MCP replies, and files read from disk can
 * all carry prompt-injection payloads; marking them lets the framing layer
 * in buildContext warn the model without re-reading every tool's source.
 */
const UNTRUSTED_TOOL_NAMES = new Set([
  'WebFetch', 'WebSearch', 'Browser', 'browser_extension', 'Operator',
  'Read', 'Glob', 'Grep', 'Knowledge', 'ConversationSearch',
]);

function messageText(message: Message): string {
  return message.content
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
}

function forcedToolForRequest(message: Message, history: Message[]): { name: string; input: Record<string, unknown> } | null {
  const text = messageText(message).trim();
  if (/(?:install|set up|setup).{0,40}(?:chrome|edge|browser)\s+extension|(?:chrome|edge|browser)\s+extension.{0,40}(?:install|set up|setup)/i.test(text)) {
    return { name: 'browser_extension', input: { action: 'prepare_install' } };
  }
  const forcedBrowserTool = routeForcedBrowserTool(text);
  if (forcedBrowserTool) return forcedBrowserTool;
  const forcedResearchTool = routeForcedResearchTool(text);
  if (forcedResearchTool) return forcedResearchTool;
  const desktopApp = text.match(/\b(?:open|launch|start|run)\b[\s\S]{0,80}\b(notepad|word|excel|powerpoint|paint|calculator|cmd|terminal|powershell|vscode|code)\b/i)?.[1]?.toLowerCase();
  if (desktopApp) {
    const appNames: Record<string, string> = {
      notepad: 'notepad', word: 'winword', excel: 'excel', powerpoint: 'powerpnt', paint: 'mspaint',
      calculator: 'calc', cmd: 'cmd', terminal: 'cmd', powershell: 'powershell', vscode: 'code', code: 'code',
    };
    return { name: 'Computer', input: { action: 'launch_app', app: appNames[desktopApp] ?? desktopApp } };
  }
  const asksForAudit = /\b(self[- ]?improv(?:e|ement)|health audit|codebase audit)\b/i.test(text) &&
    /\b(run|start|perform|inspect|audit|fix)\b/i.test(text);
  if (asksForAudit) return { name: 'SelfImprove', input: { action: 'audit' } };

  const recentUserContext = history.slice(-8).filter((item) => item.role === 'user').map(messageText).join(' ');
  const computerContext = /\b(computer|pc|desktop|screen|mouse|keyboard|click|type|file explorer)\b/i.test(`${recentUserContext} ${text}`);
  if (/^(?:my\s+)?pictures(?:\s+folder)?[.!]?$/i.test(text) && computerContext) {
    return { name: 'Computer', input: { action: 'launch_app', app: join(homedir(), 'Pictures') } };
  }
  const asksForPhysicalControl = /\b(?:use|using|control|move|with)\b[\s\S]{0,80}\b(?:mouse|keyboard|computer|pc|desktop|screen)\b|\b(?:mouse|keyboard)\b[\s\S]{0,80}\b(?:use|control|move|click|type)\b/i.test(text);
  const affirmativeContinuation = /^(?:yes|yes anything|anything|go ahead|continue|do it)[.!]?$/i.test(text) && computerContext;
  if (asksForPhysicalControl || affirmativeContinuation) {
    // Infinite OS vector-first rule: PCLiveMap is 50x faster than screenshots. Computer visual_observe only when vectors cannot see.
    return { name: 'PCLiveMap', input: { action: 'live' } };
  }
  return null;
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
  // Consecutive blocks of the same kind merge, so a streamed answer (or a
  // streamed reasoning trace) is one block rather than thousands of fragments.
  // Without this a long trace would blow the transcript up with one block per
  // chunk, and every later turn would pay to re-read them.
  if (last && last.type === 'text' && block.type === 'text') {
    last.text += block.text;
    return;
  }
  if (last && last.type === 'thinking' && block.type === 'thinking') {
    last.text += block.text;
    return;
  }
  blocks.push(block);
}
