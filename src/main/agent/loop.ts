// The core agentic loop: think → tool_use → tool_result → think → ... → end_turn
// Streams events to the renderer via the event bus so the UI updates live.

import type { Message, ContentBlock } from '../../shared/types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getProvider } from '../providers/registry.js';
import { toolRegistry, unknownToolMessage } from '../tools/base.js';
import { buildSystemPrompt, buildContext } from './context.js';
import { DecisionRouter } from '../brain/router.js';
import {
  buildProviderFailoverPlan,
  recordProviderFailure,
  recordProviderSuccess,
  selectNextProviderCandidate,
  type ProviderCandidate,
} from '../providers/failover.js';
import { routeForcedBrowserTool } from './browser-routing.js';
import { executeToolCall, isParallelSafeTool } from './tool-execution.js';
export { TOOL_EXECUTION_TIMEOUT_MS } from './tool-execution.js';

// Stall timeout for stream consumption: if the provider blocks on reader.read()
// for this long with zero events, abort the fetch and trigger failover. This
// prevents the agent from hanging indefinitely when the provider goes silent.
// Configurable via setLoopStallTimeout for tests; 10 minutes default.
export let LOOP_STREAM_STALL_TIMEOUT_MS = 10 * 60_000;
export const setLoopStallTimeout = (ms: number) => { LOOP_STREAM_STALL_TIMEOUT_MS = ms; };

import { routeForcedResearchTool } from './research-routing.js';
import { isExplicitActionFailure, isUnfulfilledActionPromise, requiresToolExecution } from './completion-guards.js';
import { selectLocalModelTools } from './local-tool-routing.js';
import { buildRecoveryHandoff, type RecoveryHandoffOptions } from './recovery-handoff.js';
import { settings } from '../settings/store.js';
import { learnFromCompletedResponse, learnFromToolResult } from './learning-adapter.js';
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

export interface AgentRunOptions {
  sessionId: string;
  cwd: string;
  provider: string;
  model: string;
  signal: AbortSignal;
  onEvent: (e: AgentEvent) => void;
}

export async function runAgent(
  history: Message[],
  userMessage: Message,
  opts: AgentRunOptions,
): Promise<Message[]> {
  const messages = [...history, userMessage];
  const failoverPlan = await buildProviderFailoverPlan({ provider: opts.provider, model: opts.model });
  if (failoverPlan.length === 0) {
    opts.onEvent({ type: 'fallback_required' });
    return messages;
  }
  let activeCandidate: ProviderCandidate = failoverPlan[0];
  let failoverIndex = 0;
  // Bounded by default so a stuck model cannot loop for hours. The setting
  // remains an explicit opt-in to raise the ceiling.
  const configuredTurns = settings.get('agentMaxTurns') as number | undefined;
  const MAX_TURNS = typeof configuredTurns === 'number' && Number.isFinite(configuredTurns) && configuredTurns > 0
    ? Math.trunc(configuredTurns)
    : 60;
  const WALL_CLOCK_LIMIT_MS = 25 * 60_000;
  const MAX_INTENT_ONLY_RETRIES = 2;
  let intentOnlyRetries = 0;
  let lastToolBatchHadError = false;
  let successfulToolExecutions = 0;
  let recoveryContext: Pick<RecoveryHandoffOptions, 'failedProvider' | 'failedModel' | 'stage' | 'failure'> | null = null;
  const originalRequest = messageText(userMessage);
  const taskContext = [...history.slice(-6), userMessage]
    .filter((message) => message.role === 'user')
    .map(messageText)
    .join('\n');
  const runStartedAt = Date.now();
  const successfulToolNames = new Set<string>();
  const successfulToolActions: SuccessfulToolAction[] = [];
  const runSystemPrompts = new Map<string, string>();
  const failedAttemptCounts = new Map<string, number>();
  const problemTracker = new ProblemTracker();


  const switchCandidate = (failure: string, assistant: Message, stage: string): boolean => {
    recordProviderFailure(activeCandidate, failure);
    if (messages.at(-1) === assistant) messages.pop();
    opts.onEvent({ type: 'message_discard', message_id: assistant.id });
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
    opts.onEvent({
      type: 'provider_status',
      status: 'failover',
      from: activeCandidate.label,
      to: next.label,
    });
    console.warn(`[agent] Recovering in background: ${activeCandidate.label} -> ${next.label}: ${failure}`);
    activeCandidate = next;
    return true;
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (Date.now() - runStartedAt > WALL_CLOCK_LIMIT_MS) {
      opts.onEvent({ type: 'error', error: `Run exceeded ${Math.round(WALL_CLOCK_LIMIT_MS / 60000)} min wall-clock limit. Stopping and reporting.` });
      opts.onEvent({ type: 'fallback_required', error: `Wall-clock limit (${Math.round(WALL_CLOCK_LIMIT_MS / 60000)} min)` });
      break;
    }
    problemTracker.setTurn(turn);
    if (opts.signal.aborted) break;

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
    const activeTools = activeCandidate.provider === 'ollama'
      ? selectLocalModelTools(requestContext, allActiveTools)
      : allActiveTools;
    const systemKey = `${activeCandidate.provider}/${activeCandidate.model}/${activeTools.map((tool) => tool.name).join(',')}`;
    let activeSystem = runSystemPrompts.get(systemKey);
    if (!activeSystem) {
      activeSystem = await buildSystemPrompt({
        ...opts,
        provider: activeCandidate.provider,
        model: activeCandidate.model,
        toolsEnabled: activeToolsEnabled,
        attachedToolNames: activeTools.map((tool) => tool.name),
      });
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
      },
      activeCandidate.apiKey,
    );

    const pendingToolCalls: Map<string, { name: string; json: string }> = new Map();

    let streamLastEvent = Date.now();
    let streamStallInterval: ReturnType<typeof setInterval> | undefined;

    try {
      streamStallInterval = setInterval(() => {
        if (providerFailure) return;
        if (Date.now() - streamLastEvent >= LOOP_STREAM_STALL_TIMEOUT_MS) {
          providerFailure = `Agent stream stalled (no events for ${Math.round(LOOP_STREAM_STALL_TIMEOUT_MS / 60_000)} min)`;
          console.error(`[agent] ${providerFailure} — aborting stream`);
          streamController.abort();
        }
      }, Math.min(30_000, LOOP_STREAM_STALL_TIMEOUT_MS / 4));

      for await (const chunk of stream) {
        streamLastEvent = Date.now();
        if (opts.signal.aborted) break;
        switch (chunk.type) {
          case 'text_delta':
            appendOrCreate(assistant.content, { type: 'text', text: chunk.text });
            opts.onEvent({ type: 'text_delta', message_id: assistant.id, text: chunk.text });
            break;
          case 'tool_use_start':
            pendingToolCalls.set(chunk.id, { name: chunk.name, json: '' });
            opts.onEvent({ type: 'tool_use_start', message_id: assistant.id, tool_use_id: chunk.id, name: chunk.name });
            break;
          case 'tool_use_delta': {
            const existing = pendingToolCalls.get(chunk.id);
            if (existing) {
              existing.json += chunk.partial_json;
            } else {
              pendingToolCalls.set(chunk.id, { name: '', json: chunk.partial_json });
            }
            opts.onEvent({ type: 'tool_use_delta', message_id: assistant.id, tool_use_id: chunk.id, partial_json: chunk.partial_json });
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
            opts.onEvent({ type: 'tool_use_end', message_id: assistant.id, tool_use_id: chunk.id, name, input: parsed });
            break;
          }
          case 'provider_progress':
            if (chunk.status === 'completed') successfulToolExecutions++;
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
            opts.onEvent({ type: 'message_end', message_id: assistant.id, stop_reason: chunk.stop_reason, usage: chunk.usage });
            break;
          case 'error':
            console.error(`[agent] Stream error: ${chunk.error}`);
            providerFailure = chunk.error;
            break;
        }
        if (providerFailure) break;
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      console.error('[agent] Stream loop error:', error.message);
      providerFailure = error.message;
    } finally {
      if (streamStallInterval) clearInterval(streamStallInterval);
      opts.signal.removeEventListener('abort', onParentAbort);
    }
    }

    if (providerFailure) {
      decisionRouter.recordTask(activeCandidate.model, false);
      if (switchCandidate(providerFailure, assistant, 'model response stream')) continue;
      opts.onEvent({ type: 'fallback_required' });
      return messages;
    }

    if (opts.signal.aborted) break;

    // If no tool calls → done
    const allToolUses = assistant.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    const toolUses = allToolUses.filter((tu) => tu.name?.trim());
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
        if (missingActions.length && !activeToolsEnabled &&
            switchCandidate(`This model does not support tool calls for the remaining required desktop actions: ${missingActions.join(', ')}.`, assistant, 'compound-action execution')) {
          intentOnlyRetries = 0;
          continue;
        }
        if (intentOnlyRetries < MAX_INTENT_ONLY_RETRIES) {
          intentOnlyRetries++;
          if (messages.at(-1) === assistant) messages.pop();
          opts.onEvent({ type: 'message_discard', message_id: assistant.id });
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
        opts.onEvent({ type: 'fallback_required' });
        return messages;
      }
      if (isExplicitActionFailure(originalRequest, assistantText)) {
        if (switchCandidate('The model could not complete the requested action.', assistant, 'completion verification')) continue;
        opts.onEvent({ type: 'fallback_required' });
        return messages;
      }
      if (!assistantText.trim()) {
        if (switchCandidate('The model returned no usable response.', assistant, 'final-answer generation')) continue;
        opts.onEvent({ type: 'fallback_required' });
        return messages;
      }
      if (lastToolBatchHadError) {
        if (switchCandidate('The model did not recover from a failed tool attempt.', assistant, 'tool-result recovery')) continue;
        opts.onEvent({ type: 'fallback_required' });
        return messages;
      }
      decisionRouter.recordTask(activeCandidate.model, true);
      recordProviderSuccess(activeCandidate);
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
    const parallelResults = parallelBatch.length > 0 ? await Promise.all(parallelBatch.map(executeOne)) : [];
    const sequentialResults: Awaited<ReturnType<typeof executeOne>>[] = [];
    for (const tu of sequentialBatch) {
      sequentialResults.push(await executeOne(tu));
    }
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
        content: [{ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.is_error }],
        timestamp: Date.now(),
      });
      opts.onEvent({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.is_error });
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
    return { name: 'Computer', input: { action: 'visual_observe' } };
  }
  return null;
}

function providerSupportsTools(providerId: string, model: string): boolean {
  const provider = getProvider(providerId);
  if (!provider) return false;
  const knownModel = provider.freeModels.find((item) => item.id === model);
  return knownModel?.supports_tools !== false;
}

function appendOrCreate(blocks: ContentBlock[], block: ContentBlock) {
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'text' && block.type === 'text') {
    last.text += block.text;
  } else {
    blocks.push(block);
  }
}
