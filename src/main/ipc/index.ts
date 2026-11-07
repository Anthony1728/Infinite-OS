// IPC handler registration — wires every channel declared in shared/ipc.ts to a main-process function.

import { ipcMain, BrowserWindow, dialog, shell, clipboard, app } from 'electron';
import { isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { IPC } from '../../shared/ipc.js';
import { settings } from '../settings/store.js';
import { deleteApiKey, setApiKey, hasApiKey, getApiKey } from '../settings/secrets.js';
import { listProviders, getProvider, providerRegistry } from '../providers/registry.js';
import { toolRegistry } from '../tools/base.js';
import { actionAuditLog } from '../audit/action-log.js';
import { listServers as listMcpServers, connect as mcpConnect, disconnect as mcpDisconnect, getStatus as mcpGetStatus, listTools as mcpListTools } from '../mcp/manager.js';
import * as sessionStore from '../session/store.js';
import { markRunStarted, clearRunMarker, findInterruptedRuns } from '../agent/resume.js';
import { writeResumeQueue, consumeResumeQueue, type ResumeEntry } from '../agent/resume-queue.js';
import { isContinuationRequest, buildTaskLedger, renderLedgerContext } from '../agent/task-ledger.js';
import { interjectAgent, runAgent } from '../agent/loop.js';
import { UNTIL_DONE_MAX_TURNS, UNTIL_DONE_WALL_CLOCK_MS } from '../agent/run-budget.js';
import { respondToPermission } from '../agent/permission-prompt.js';
import { resolveUserQuestions } from '../agent/question-prompt.js';
import {
  setPlanMode,
  resolveExitPlan,
  getPendingExitPlan,
} from '../agent/plan-mode.js';
import { setPlanModeEmitter } from '../agent/plan-mode-events.js';
import { setTodoEmitter } from '../agent/todo-store.js';
import {
  setBackgroundTaskEmitter,
  startBackgroundTask,
  finishBackgroundTask,
  listBackgroundTasks,
} from '../agent/background-tasks.js';
import { listAgents } from '../agents/registry.js';
import {
  listCustomAgents,
  createCustomAgent,
  getCustomAgent,
  updateCustomAgent,
  deleteCustomAgent,
} from '../agents/custom-store.js';
import * as memoryStore from '../memory/store.js';
import { getEvaluationReport, listEvaluationReports } from '../evaluation/harness.js';
import { evalFixtures, listEvalSuites } from '../evaluation/fixtures.js';
import { abortSubagent, listRunStates, spawnSubagent, clearCompletedRuns } from '../agent/runtime.js';
import type { AgentId } from '../agents/types.js';
import { v4 as uuid } from 'uuid';
import type { Message } from '../../shared/types.js';
import { collectSystemMetrics } from '../system/metrics.js';
import { osPush, osPushStatus } from '../github/push.js';
import { registerBrainIpc } from './brain.js';
import { registerBrowserIpc } from './browser.js';
import { registerBridgeIpc } from './bridge.js';
import { registerAutomationIpc } from './automation.js';
import { registerWorkersIpc } from './workers.js';
import { registerWebsiteIpc } from './website.js';
import { registerAppIpc } from './app.js';
import { registerBusinessIpc } from './business.js';
import { registerPluginIpc } from './plugin.js';
import { registerCloudIpc } from './cloud.js';
import { registerMultiAgentIpc } from './multi-agent.js';
import { registerRemoteIpc } from './remote.js';
import { registerStudioIpc } from './studio.js';
import { registerPagesIpc } from './pages.js';
import { registerWorkspaceIpc } from './workspace.js';
import { registerAuthIpc } from './auth.js';
import { registerOwnerIpc } from './owner.js';
import { registerTerminalIpc } from '../terminal/handler.js';
import { registerCheckpointIpc } from './checkpoint.js';
import { registerClipboardIpc } from './clipboard.js';
import { registerCompletionIpc } from './completion.js';
import { registerComputerAutomationIpc } from './computer-automation.js';
import { registerDebugIpc } from './debug.js';
import { registerGapIpc } from './gaps.js';
import { registerGitHubIpc } from './github.js';
import { registerIndexingIpc } from './indexing.js';
import { registerNotificationIpc } from './notification.js';
import { registerProjectIpc } from './projects.js';
import { registerOptimizeIpc } from './optimize.js';
import { registerOllamaIpc } from './ollama.js';
import { registerQueueIpc } from './queue.js';
import { registerGitIpc } from './git.js';
import { registerLearningIpc } from './learning.js';
import { registerMessagingIpc } from './messaging.js';
import { registerWhatsAppLinkIpc } from './whatsapp-link.js';
import { registerCommandsIpc } from './commands.js';
import { registerWindowIpc } from './window.js';
import { SelfImprovementAgent } from '../agent/self-improvement.js';
import { SelfEvolutionEngine } from '../brain/self-evolution.js';
import { createEvolutionLoop, type EvolutionLoop } from '../brain/evolution-loop.js';
import { SelfApplyRunner } from '../self-apply.js';
import { findSelfRepoRoot } from '../self-repo.js';
import { getEngine } from '../engine/intelligence.js';
import { SkillsManager } from '../skills/manager.js';
import { PersonalizationManager } from '../personalization/manager.js';
import { orchestrator, type OrchestratorEvent } from '../agent/orchestrator.js';
import { buildCrewPlan, runCrew, listCrewRuns, type CrewEvent } from '../agent/crew.js';
import { sessionBoard } from '../agent/session-board.js';
import { selectBestModel, getAllFreeModels } from '../providers/model-selector.js';
import { videoEngine } from '../video/index.js';
import { deploySystem } from '../deploy/index.js';
import { enterpriseManager } from '../enterprise/index.js';
import { callCenter } from '../callcenter/index.js';
import { browserOperator } from '../operator/browser-operator.js';
import { windowsDictation } from '../voice/windows-dictation.js';
import { getLocalVoice, isLocalVoiceScriptAvailable } from '../voice/local-voice.js';
import { voiceSession } from '../voice/session.js';
import { startWorkspaceServer, getWorkspaceServer, serveExternalFile } from '../workspace-server.js';
import {
  createTabBrowserView,
  updateTabBrowserBounds,
  navigateTabBrowser,
  goBackTabBrowser,
  goForwardTabBrowser,
  reloadTabBrowser,
  tabBrowserState,
  closeTabBrowserView,
  readTabBrowserState,
  tabBrowserViewport,
} from '../tab-browser-view.js';
import { replaceTabs, upsertTab, removeTab, listTabs } from '../tab-index.js';
import {
  addCustomCommand,
  clearHistory,
  getVoiceConfig,
  listCustomCommands,
  listHistory,
  processTranscript,
  removeCustomCommand,
  setVoiceConfig,
  type VoiceConfig,
} from '../voice/assistant.js';
import {
  getEmailConfig,
  hasEmailConfig,
  listEmails,
  readEmail,
  saveEmailConfig,
  sendEmail,
  testConnection as testEmailConnection,
  type EmailConfig,
} from '../email/index.js';

const activeRuns = new Map<string, AbortController>();
// Live-run identity for survive-the-reload: snapshotted to a queue file
// before any relaunch so interrupted runs can be auto-continued.
const runMeta = new Map<string, { provider: string; model: string; cwd: string; request: string; background: boolean }>();
const discardedRuns = new Set<string>();

/** First text block of an incoming message payload, for task titles. */
function messageTextOf(message: unknown): string {
  try {
    const content = (message as { content?: Array<{ type: string; text?: string }> }).content ?? [];
    const text = content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join(' ').trim();
    return text.length > 60 ? `${text.slice(0, 60)}…` : text || 'Background task';
  } catch {
    return 'Background task';
  }
}

// Created lazily so importing this module (or registering IPC in tests) never
// starts timers or spawns builds as a side effect.
let evolutionLoopSingleton: EvolutionLoop | null = null;
let selfApplySingleton: SelfApplyRunner | null = null;
function getEvolutionLoop(): EvolutionLoop {
  evolutionLoopSingleton ??= createEvolutionLoop();
  return evolutionLoopSingleton;
}
function getSelfApplyRunner(): SelfApplyRunner {
  selfApplySingleton ??= new SelfApplyRunner();
  return selfApplySingleton;
}

/** Snapshot every live run so a relaunch can continue them (survive-reload). */
export function snapshotActiveRunsForResume(): void {
  const entries: ResumeEntry[] = [];
  for (const [sessionId, meta] of runMeta) {
    entries.push({ sessionId, request: meta.request, provider: meta.provider, model: meta.model, cwd: meta.cwd, background: meta.background, savedAt: Date.now() });
  }
  writeResumeQueue(entries);
}

/** Broadcast a chat-stream event to every open window. */
function broadcastChatEvent(payload: Record<string, unknown>): void {
  try {
    const { BrowserWindow } = require('electron') as typeof import('electron');
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send(IPC.CHAT_STREAM_EVENT, payload); } catch { /* window dying */ }
    }
  } catch {
    /* headless/tests — events dropped, messages still persist */
  }
}

/**
 * Continue every run the last relaunch cut off.
 *
 * Each queued entry re-runs the agent on its ORIGINAL session with a
 * continuation directive: the transcript (persisted per-message) is already
 * in the conversation, so the agent verifies current state and finishes the
 * task instead of the work dying with the process.
 */
async function resumeInterruptedRuns(): Promise<void> {
  const entries = await consumeResumeQueue(async (sessionId) =>
    Boolean(await sessionStore.loadSessionMeta(sessionId).catch(() => null)),
  );
  if (entries.length === 0) return;
  console.log('[resume] continuing ' + entries.length + ' interrupted run(s) after restart');
  for (const entry of entries) {
    void (async () => {
      const controller = new AbortController();
      activeRuns.set(entry.sessionId, controller);
      runMeta.set(entry.sessionId, { provider: entry.provider, model: entry.model, cwd: entry.cwd, request: entry.request, background: entry.background });
      markRunStarted(entry.sessionId, entry.request);
      try {
        const note: Message = {
          id: uuid(),
          role: 'user',
          content: [{ type: 'text', text:
            '[Resumed after restart] The app restarted while this task was running. The transcript above is the work already completed. ' +
            'Verify the current state first (the requested files/values may already exist and the rebuild may already have happened). ' +
            'Do NOT call BuildFeature, start another build, or relaunch the app in this resumed run — the restart this note follows was that step. ' +
            'If the requested change is already present, confirm it with a read/command and finish with the evidence. ' +
            'Original request: ' + entry.request }],
          timestamp: Date.now(),
        };
        await sessionStore.appendMessage(entry.sessionId, note);
        broadcastChatEvent({ sessionId: entry.sessionId, type: 'provider_status', status: 'resuming', detail: 'Resuming interrupted task after restart...' });
        const history = await sessionStore.loadMessages(entry.sessionId);
        const historyBefore = history.slice(0, -1);
        if (entry.background) startBackgroundTask(entry.sessionId, entry.request.slice(0, 80));
        const completed = await runAgent(historyBefore, note, {
          sessionId: entry.sessionId,
          cwd: entry.cwd,
          provider: entry.provider,
          model: entry.model,
          signal: controller.signal,
          onEvent: (ev) => broadcastChatEvent({ sessionId: entry.sessionId, ...ev }),
          onMessage: async (produced) => {
            if (discardedRuns.has(entry.sessionId)) return;
            await sessionStore.appendMessage(entry.sessionId, produced);
            markRunStarted(entry.sessionId, entry.request);
          },
        });
        clearRunMarker(entry.sessionId);
        if (entry.background) {
          const lastAssistant = [...completed].reverse().find((m) => m.role === 'assistant');
          const summary = lastAssistant ? lastAssistant.content.filter((c) => c.type === 'text').map((c) => (c as { text?: string }).text ?? '').join(' ') : '';
          finishBackgroundTask(entry.sessionId, 'completed', summary);
        }
      } catch (err) {
        clearRunMarker(entry.sessionId);
        console.warn('[resume] continuation failed:', (err as Error).message);
        finishBackgroundTask(entry.sessionId, 'failed', (err as Error).message);
      } finally {
        if (activeRuns.get(entry.sessionId) === controller) activeRuns.delete(entry.sessionId);
        runMeta.delete(entry.sessionId);
      }
    })();
  }
}

export function registerIpc(getMainWindow: () => BrowserWindow | null): void {
  // Plan-mode + todo events ride the chat stream channel, so wire the emitters here.
  const chatStreamSend: (channel: string, payload: unknown) => void = (channel, payload) =>
    getMainWindow()?.webContents.send(channel, payload);
  setPlanModeEmitter(chatStreamSend);
  setTodoEmitter(chatStreamSend);
  setBackgroundTaskEmitter(chatStreamSend);
  registerWindowIpc(getMainWindow);
  registerAuthIpc();
  // Survive-the-reload: continue runs the last relaunch interrupted.
  setTimeout(() => { void resumeInterruptedRuns().catch((e) => console.warn('[resume] failed:', (e as Error).message)); }, 5_000);
  registerOwnerIpc();
  registerTerminalIpc();
  registerCheckpointIpc();
  registerClipboardIpc();
  registerCompletionIpc();
  registerComputerAutomationIpc();
  registerDebugIpc();
  registerGapIpc();
  registerGitHubIpc();
  registerIndexingIpc();
  registerNotificationIpc();
  registerOllamaIpc();
registerOptimizeIpc();
  registerQueueIpc();
  registerGitIpc();
  registerLearningIpc(getMainWindow);
  registerMessagingIpc();
  registerWhatsAppLinkIpc();
  registerCommandsIpc();
  // Background build — app stays running while AI edits code
  //
  // These were registered with no preload exposure and no renderer caller, so
  // a finished background-build feature (auto-update/index.ts, including its
  // own progress events) was unreachable. Now exposed and surfaced in
  // Settings so a rebuild triggered by the agent is visible rather than silent.
  ipcMain.handle(IPC.BUILD_START, async () => {
    const { buildInBackground } = await import('../auto-update/index.js');
    const cwd = settings.get('cwd') as string | undefined ?? process.cwd();
    const result = await buildInBackground(cwd);
    // Notify renderer that a new build is ready
    if (result.phase === 'ready') {
      const win = getMainWindow();
      win?.webContents.send(IPC.BUILD_HAS_UPDATE, result);
    }
    return result;
  });

  // Forward every background-build state change to the renderer.
  //
  // `onBuildStatusChange` existed in auto-update/index.ts with no subscriber,
  // so a build could finish, fail or be cancelled and the UI would never learn:
  // the app just sat there looking idle while a rebuild ran or died.
  {
    void import('../auto-update/index.js').then(({ onBuildStatusChange }) => {
      onBuildStatusChange((status) => {
        getMainWindow()?.webContents.send(IPC.BUILD_STATUS_CHANGED, status);
      });
    });
  }
  ipcMain.handle(IPC.BUILD_STATUS, async () => {
    const { getBuildStatus } = await import('../auto-update/index.js');
    return getBuildStatus();
  });
  ipcMain.handle(IPC.BUILD_CANCEL, async () => {
    const { cancelBuild } = await import('../auto-update/index.js');
    return { cancelled: cancelBuild() };
  });
  ipcMain.handle(IPC.BUILD_HAS_UPDATE, async () => {
    const { hasStagedUpdate } = await import('../auto-update/index.js');
    return { hasUpdate: hasStagedUpdate() };
  });
  ipcMain.handle(IPC.BUILD_CLEAR_UPDATE, async () => {
    const { clearStagedUpdate } = await import('../auto-update/index.js');
    clearStagedUpdate();
    return { ok: true };
  });
  // Chat
  ipcMain.handle(IPC.CHAT_PLAN_RESOLVE, async (_e, { sessionId, approved }: { sessionId: string; approved: boolean }) => {
    const pending = getPendingExitPlan(sessionId);
    const ok = resolveExitPlan(sessionId, approved);
    if (ok && pending) {
      const win = getMainWindow();
      if (win && approved) {
        // The agent loop continues with the plan in context; surface it as a
        // provider status so the user sees the transition live.
        win.webContents.send(IPC.CHAT_STREAM_EVENT, {
          sessionId,
          type: 'provider_status',
          status: 'Plan approved — executing with full tools.',
        });
      }
    }
    return { ok };
  });

  ipcMain.handle(IPC.BACKGROUND_TASKS_LIST, async () => listBackgroundTasks());

  ipcMain.handle(IPC.CHAT_SEND, async (_e, { sessionId, message, displayMessage, provider, model, cwd, planMode, background, untilDone }) => {
    // Mark heartbeat as active — don't run consolidation while user is chatting.
    void import('../heartbeat/index.js').then(({ heartbeatTouch }) => heartbeatTouch()).catch(() => {});
    const win = getMainWindow();
    if (!win) {
      console.error('[IPC] CHAT_SEND: No window available');
      throw new Error('No window');
    }

    const controller = new AbortController();
    activeRuns.set(sessionId, controller);
    runMeta.set(sessionId, { provider, model, cwd, request: messageTextOf(message), background: Boolean(background) });

    // Enforced plan mode: when the user sent this message in Plan mode, arm the
    // read-only gate for the run. It stays on until the model calls ExitPlan
    // and the user approves (CHAT_PLAN_RESOLVE), or the run ends.
    if (planMode) setPlanMode(sessionId, true);
    // Background detach: register the run so completion raises an OS
    // notification and the sidebar can badge it. The run itself is unchanged —
    // the user simply doesn't have to keep this session in the foreground.
    if (background) {
      startBackgroundTask(sessionId, messageTextOf(message));
    }

    // Continuation requests ('continue' after an interruption) carry no new
    // instruction — the model would wander. Rebuild the task ledger from the
    // persisted transcript and inject it as the model-facing text, so the
    // agent resumes the TASK (goal, what ran, what still needs verifying).
    let modelFacingContent = message;
    if (isContinuationRequest(messageTextOf(message))) {
      try {
        const priorHistory = await sessionStore.loadMessages(sessionId);
        const ledger = buildTaskLedger(priorHistory);
        if (ledger) {
          modelFacingContent = [{ type: 'text', text: renderLedgerContext(ledger, messageTextOf(message)) }];
        }
      } catch (e) {
        console.warn('[chat] task ledger unavailable:', (e as Error).message);
      }
    }
    const userMessage: Message = { id: uuid(), role: 'user', content: modelFacingContent, timestamp: Date.now() };
    const storedUserMessage: Message = { ...userMessage, content: displayMessage ?? message };
    const history = await sessionStore.loadMessages(sessionId);
    await sessionStore.appendMessage(sessionId, storedUserMessage);

    // How much of the run's output is already safely on disk. Messages are
    // appended as the agent produces them rather than only at the end, because
    // the most common way to lose a whole conversation is Infinite AI editing
    // its own source: the app restarts mid-run, the run never returns, and
    // everything it had already done was only ever held in memory.
    const persistedThrough = { value: history.length + 1 };

    // Mark the run as live so a restart is detectable at the next launch.
    markRunStarted(sessionId, message);

    try {
      const startTime = Date.now();
      const completedMessages = await runAgent(history, userMessage, {
        sessionId,
        cwd,
        provider,
        model,
        signal: controller.signal,
        // "Keep working until done": this run gets the marathon budget — the
        // completeness contract rides the prompt, the ceiling rides here.
        ...(untilDone
          ? { maxTurns: UNTIL_DONE_MAX_TURNS, wallClockMs: UNTIL_DONE_WALL_CLOCK_MS }
          : {}),
        onEvent: (ev) => {
          win.webContents.send(IPC.CHAT_STREAM_EVENT, { sessionId, ...ev });
        },
        // Persist each message as the agent finishes it. Sequential on purpose:
        // the transcript has to stay in the order the model actually saw.
        onMessage: async (produced) => {
          // A chat cleared mid-run must not be resurrected by a straggling write.
          if (discardedRuns.has(sessionId)) return;
          await sessionStore.appendMessage(sessionId, produced);
          persistedThrough.value += 1;
          // Refresh the mark so "still working" is distinguishable from "died".
          markRunStarted(sessionId, message);
        },
      });
      // The run finished normally, so there is nothing to report on next boot.
      clearRunMarker(sessionId);
      const duration = Date.now() - startTime;
      if (background) {
        const lastAssistant = [...completedMessages].reverse().find((m) => m.role === 'assistant');
        const summary = lastAssistant
          ? lastAssistant.content.filter((c) => c.type === 'text').map((c) => (c as { text?: string }).text ?? '').join(' ')
          : '';
        finishBackgroundTask(sessionId, 'completed', summary);
      }

      // Record this interaction in the Intelligence Engine for learning
      try {
        const engine = getEngine();
        // Bootstrap if this is the first interaction
        engine.tryBootstrap();

        // Extract the user's text input
        const userText = userMessage.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(' ');

        // Extract the assistant's text output
        const lastAssistant = [...completedMessages].reverse().find(m => m.role === 'assistant');
        const assistantText = lastAssistant
          ? lastAssistant.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join(' ')
          : '';

        // Determine if the interaction was successful (no tool_result errors)
        const hasError = completedMessages.some(
          (m) => m.content.some((c) => c.type === 'tool_result' && c.is_error),
        );
        const success = !hasError && assistantText.length > 10;

        // Count tokens roughly
        const inputTokens = userText.length;
        const outputTokens = assistantText.length;

        engine.recordInteraction({
          taskType: detectTaskType(userText),
          input: userText.slice(0, 500),
          modelUsed: model,
          provider,
          output: assistantText.slice(0, 1000),
          success,
          duration,
          tokens: { input: inputTokens, output: outputTokens },
        });
      } catch (engineErr) {
        console.error('[IPC] CHAT_SEND: engine recording failed:', engineErr);
      }

      // Episodic memory write: every completed chat turn becomes a decaying
      // episodic memory, so recall has real data to surface later (the
      // heartbeat prunes low-importance episodes after 30 days). Fire-and-
      // forget — a memory failure must never fail the chat.
      try {
        const { recordEpisodic } = await import('../memory/store.js');
        const turnUserText = userMessage.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as { text?: string }).text ?? '')
          .join(' ');
        const turnAssistant = [...completedMessages].reverse().find((m) => m.role === 'assistant');
        const turnAnswer = turnAssistant
          ? turnAssistant.content
              .filter((c) => c.type === 'text')
              .map((c) => (c as { text?: string }).text ?? '')
              .join(' ')
          : '';
        const turnHadErrors = completedMessages.some(
          (m) => m.content.some((c) => c.type === 'tool_result' && c.is_error),
        );
        recordEpisodic(
          sessionId,
          turnUserText.slice(0, 120) || 'Chat turn',
          `Asked: ${turnUserText.slice(0, 600)}\nAnswered: ${turnAnswer.slice(0, 600) || '(no text answer)'}`,
          !turnHadErrors && turnAnswer.length > 10 ? 0.5 : 0.35,
        );
      } catch (memoryErr) {
        console.warn('[IPC] CHAT_SEND: episodic memory write failed:', memoryErr);
      }

      // A clear-history action may have deleted this session while the agent
      // was winding down after cancellation. Never recreate a deleted chat.
      const wasDiscarded = discardedRuns.delete(sessionId);
      if (!wasDiscarded && (await sessionStore.loadSessionMeta(sessionId))) {
        // Only the tail the run never streamed. Messages already handed to
        // `onMessage` during the run are on disk, and appending them again
        // would double every tool call in the transcript.
        for (const message of completedMessages.slice(persistedThrough.value)) {
          await sessionStore.appendMessage(sessionId, message);
        }
      }
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String(err.message)
            : String(err);
      if (background) finishBackgroundTask(sessionId, 'failed', errorMessage);
      console.error('[IPC] CHAT_SEND: runAgent failed:', errorMessage);
      // The run ended, so it must not be reported as an interrupted one next
      // boot. The marker only surviving a hard process death is the signal.
      clearRunMarker(sessionId);
      try {
        win.webContents.send(IPC.CHAT_STREAM_EVENT, {
          sessionId,
          type: 'error',
          error: errorMessage || 'Agent failed',
        });
      } catch (sendErr) {
        console.error('[IPC] CHAT_SEND: failed to send error event:', sendErr);
      }
    }

    discardedRuns.delete(sessionId);
    if (activeRuns.get(sessionId) === controller) activeRuns.delete(sessionId);
    runMeta.delete(sessionId);
    // A run that ended without ExitPlan approval leaves the gate armed; clear
    // it so the next normal message is not silently read-only.
    if (planMode && !getPendingExitPlan(sessionId)) setPlanMode(sessionId, false);
    return { ok: true };
  });

  ipcMain.handle(IPC.CHAT_ABORT, async (_e, { sessionId }) => {
    activeRuns.get(sessionId)?.abort();
    orchestrator.cancelSession(sessionId);
    // Also abort any crew / subagent runs for this session so Thinking never hangs 192m
    try {
      const { abortSessionRuns } = await import('../agent/runtime.js');
      abortSessionRuns(sessionId);
    } catch { /* best-effort abort */ }
    try {
      const { cancelCrewSession } = await import('../agent/crew.js');
      cancelCrewSession(sessionId);
    } catch { /* best-effort abort */ }
    return { ok: true };
  });

  ipcMain.handle(IPC.CHAT_INTERJECT, async (_e, { sessionId, message }: { sessionId: string; message: string }) => {
    if (!activeRuns.has(sessionId)) return { ok: false, error: 'No active task for this session.' };
    interjectAgent(sessionId, message);
    return { ok: true };
  });
  ipcMain.handle(IPC.OPERATOR_BROWSER_SEARCH, async (_e, { query }: { query: string }) =>
    browserOperator.searchAmazon(query),
  );
  ipcMain.handle(IPC.OPERATOR_BROWSER_NAVIGATE, async (_e, { url }: { url: string }) =>
    browserOperator.navigate(url),
  );
  ipcMain.handle(IPC.OPERATOR_BROWSER_SHUTDOWN, async () => {
    await browserOperator.shutdown();
    return { ok: true };
  });
  ipcMain.handle(IPC.EMAIL_TEST, async (_e, config: EmailConfig) => testEmailConnection(config));
  ipcMain.handle(IPC.EMAIL_CONFIG_GET, async () => getEmailConfig());
  ipcMain.handle(IPC.EMAIL_CONFIG_SAVE, async (_e, config: EmailConfig) => {
    await saveEmailConfig(config);
    return { ok: true };
  });
  ipcMain.handle(IPC.EMAIL_HAS_CONFIG, async () => hasEmailConfig());
  ipcMain.handle(IPC.EMAIL_LIST, async (_e, args: { folder?: string; limit?: number }) =>
    listEmails(args?.folder ?? 'INBOX', args?.limit ?? 20),
  );
  ipcMain.handle(IPC.EMAIL_READ, async (_e, args: { uid: string; folder?: string }) =>
    readEmail(args.uid, args.folder ?? 'INBOX'),
  );
  ipcMain.handle(IPC.EMAIL_SEND, async (_e, args: { to: string; subject: string; text: string; inReplyTo?: string }) =>
    sendEmail(args.to, args.subject, args.text, args.inReplyTo),
  );

  // Sessions
  ipcMain.handle(IPC.SESSION_LIST, async () => sessionStore.listSessions());
  ipcMain.handle(IPC.SESSION_CREATE, async (_e, { cwd, model, provider, title }) => {
    const session = await sessionStore.createSession({ cwd, model, provider, title });
    // Auto-index the workspace in the background so repo understanding is
    // ready before the agent ever needs it — the Knowledge tool used to be
    // the only trigger, which meant nobody's workspace was ever indexed.
    // force=false makes repeat indexing cheap (unchanged files are skipped).
    if (typeof cwd === 'string' && cwd && cwd !== '.' && cwd !== homedir()) {
      void (async () => {
        try {
          const { getWorkspaceIndexer } = await import('../indexing/indexer.js');
          await getWorkspaceIndexer().buildIndex([cwd], false);
        } catch (e) {
          console.warn('[index] background workspace index failed:', (e as Error).message);
        }
      })();
    }
    return session;
  });
  ipcMain.handle(IPC.SESSION_LOAD, async (_e, { sessionId }) => sessionStore.loadMessages(sessionId));
  ipcMain.handle(IPC.SESSION_DELETE, async (_e, { sessionId }) => {
    if (activeRuns.has(sessionId)) discardedRuns.add(sessionId);
    activeRuns.get(sessionId)?.abort();
    activeRuns.delete(sessionId);
    orchestrator.cancelSession(sessionId);
    await sessionStore.deleteSession(sessionId);
    return { ok: true };
  });
  ipcMain.handle(IPC.SESSION_CLEAR_ALL, async () => {
    // A history wipe also stops in-flight tasks so they cannot recreate a
    // transcript after the user has explicitly removed it.
    for (const [sessionId, controller] of activeRuns) {
      discardedRuns.add(sessionId);
      controller.abort();
    }
    activeRuns.clear();
    orchestrator.cancelAll();
    const deleted = await sessionStore.clearAllSessions();
    return { ok: true, deleted };
  });
  ipcMain.handle(IPC.SESSION_RENAME, async (_e, { sessionId, title }) => sessionStore.renameSession(sessionId, title));
  ipcMain.handle(IPC.SESSION_PIN, async (_e, { sessionId, pinned }) => sessionStore.pinSession(sessionId, pinned));

  // Archive — a flag on the session, never a move. The caller refreshes its own
  // list, so no broadcast channel is needed for a user-initiated change.
  ipcMain.handle(IPC.SESSION_ARCHIVE_SET, async (_e, { sessionId, archived }) =>
    sessionStore.setSessionArchived(sessionId, archived));
  ipcMain.handle(IPC.SESSION_ARCHIVE_LIST, async () => sessionStore.listArchivedSessions());
  ipcMain.handle(IPC.SESSION_ARCHIVE_SEARCH, async (_e, { query }) => sessionStore.searchArchivedSessions(query));
  ipcMain.handle(IPC.SESSION_SEARCH, async (_e, { query }) => sessionStore.searchSessions(query));
  ipcMain.handle(IPC.SESSION_BRANCH, async (_e, { sessionId, messageId }) =>
    sessionStore.branchSession(sessionId, messageId),
  );
  ipcMain.handle(IPC.SESSION_UPDATE_MESSAGE, async (_e, { sessionId, messageId, content }) =>
    sessionStore.updateMessage(sessionId, messageId, content),
  );
  ipcMain.handle(IPC.SESSION_APPEND, async (_e, { sessionId, message }) => {
    await sessionStore.appendMessage(sessionId, message as Message);
    return { ok: true };
  });
  ipcMain.handle(IPC.SESSION_EXPORT, async (_e, { sessionId, format = 'markdown' }) => {
    const session = await sessionStore.loadSessionMeta(sessionId);
    if (!session) throw new Error('Conversation not found');
    const result = await dialog.showSaveDialog({
      title: 'Export conversation',
      defaultPath: `${session.title.replace(/[<>:"/\\|?*]/g, '-')}.${format === 'json' ? 'json' : 'md'}`,
      filters:
        format === 'json' ? [{ name: 'JSON', extensions: ['json'] }] : [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    await writeFile(result.filePath, await sessionStore.exportSession(sessionId, format), 'utf8');
    return { ok: true, path: result.filePath };
  });
  ipcMain.handle(IPC.SESSION_IMPORT, async (_e, { format, content, cwd, model, provider }) => {
    try {
      const session = await sessionStore.importSession({ format, content, cwd, model, provider });
      return { ok: true, session };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });
  // Share a conversation: produce compact markdown and copy it to the clipboard
  // so the user can paste it anywhere (chat, email, notes) — like a share link.
  ipcMain.handle(IPC.SESSION_SHARE, async (_e, { sessionId }) => {
    const session = await sessionStore.loadSessionMeta(sessionId);
    if (!session) throw new Error('Conversation not found');
    const markdown = await sessionStore.exportSession(sessionId, 'markdown');
    await clipboard.writeText(markdown);
    return { ok: true, length: markdown.length };
  });

  // Settings
  ipcMain.handle(IPC.SETTINGS_GET, async (_e, { key }) => settings.get(key));
  ipcMain.handle(IPC.SETTINGS_SET, async (_e, { scope, key, value, cwd }) => {
    await settings.set(scope, key, value, cwd);
    return { ok: true };
  });

  // Providers
  ipcMain.handle(IPC.PROVIDER_LIST, async () =>
    listProviders().map((p) => ({
      id: p.id,
      label: p.label,
      requiresApiKey: p.requiresApiKey,
      acceptsApiKey: p.acceptsApiKey ?? false,
      defaultBaseUrl: p.defaultBaseUrl,
      freeModels: p.freeModels,
      ...(p.homepage ? { homepage: p.homepage } : {}),
    })),
  );
  ipcMain.handle(IPC.PROVIDER_TEST, async (_e, { provider, apiKey, baseUrl }) => {
    const p = getProvider(provider);
    if (!p) return { ok: false, error: 'Unknown provider' };
    const key = apiKey?.trim() || (await getApiKey(provider));
    if (p.requiresApiKey && !key) return { ok: false, error: 'No API key saved for this provider.' };
    return p.testConnection(key, baseUrl);
  });
  ipcMain.handle(IPC.PROVIDER_MODELS, async (_e, { provider, apiKey, baseUrl }) => {
    const p = getProvider(provider);
    if (!p) return [];
    const key = apiKey?.trim() || (await getApiKey(provider));
    return p.listModels(key, baseUrl);
  });
  ipcMain.handle(IPC.PROVIDER_SET_KEY, async (_e, { provider, key }) => {
    const normalized = key?.trim();
    if (!normalized) {
      const p = getProvider(provider);
      if (!p?.acceptsApiKey) throw new Error('API key cannot be empty.');
      await deleteApiKey(provider);
      return { ok: true, cleared: true };
    }
    await setApiKey(provider, normalized);
    return { ok: true };
  });
  ipcMain.handle(IPC.PROVIDER_HAS_KEY, async (_e, { provider }) => hasApiKey(provider));

  ipcMain.handle(IPC.OPENCODE_CLI_VERSION, async () => {
    const { getInstalledOpenCodeVersion, isOpenCodeVersionAtLeast, openCodeServerVersion, OPENCODE_MIN_FREE_VERSION, openCodeKeylessStatus } =      await import('../providers/opencode.js');
    const version = await getInstalledOpenCodeVersion();
    const serverVersion = await openCodeServerVersion();
    // The running server answers turns — it decides free-tier support. When
    // no server is running yet, the installed binary (which will be spawned)
    // decides.
    const effective = serverVersion ?? version;
    const keyless = await openCodeKeylessStatus().catch(() => null);    return {
      version,
      serverVersion,
      minFreeVersion: OPENCODE_MIN_FREE_VERSION,
      freeTierSupported: isOpenCodeVersionAtLeast(effective),
      serverStale: Boolean(serverVersion) && !isOpenCodeVersionAtLeast(serverVersion),
      connected: keyless?.connected ?? null,
      opencodeCount: keyless?.opencodeCount ?? null,
      goCount: keyless?.goCount ?? null,
      freeCount: keyless?.freeCount ?? null,    };
  });
  ipcMain.handle(IPC.OPENCODE_SERVER_RESTART, async () => {
    const { restartStaleOpenCodeServer } = await import('../providers/opencode.js');
    const version = await restartStaleOpenCodeServer();
    return { version };
  });
  ipcMain.handle(IPC.OPENCODE_CLI_UPGRADE, async () => {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);
      // .cmd shims need a shell on Windows; quoting is handled by execFile.
      const { stdout } = await execFileAsync('npm', ['install', '--global', 'opencode-ai@latest'], {
        timeout: 240_000,
        windowsHide: true,
        ...(process.platform === 'win32' ? { shell: true } : {}),
      });
      const tail = String(stdout ?? '').trim().split('\n').slice(-5).join('\n');
      return { ok: true as const, output: tail };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message.slice(0, 500) };
    }
  });

  // Tools
  ipcMain.handle(IPC.TOOLS_LIST, async () => toolRegistry.asProviderTools());

  // Action audit log — query the durable record of agent actions
  ipcMain.handle(IPC.AUDIT_RECENT, async (_e, args?: { limit?: number }) =>
    actionAuditLog.recent(args?.limit));
  ipcMain.handle(IPC.AUDIT_QUERY, async (_e, args?: { sessionId?: string; tool?: string; limit?: number }) =>
    actionAuditLog.query({ sessionId: args?.sessionId, toolPrefix: args?.tool, limit: args?.limit }));
  ipcMain.handle(IPC.AUDIT_DAY, async (_e, args?: { date?: string }) =>
    actionAuditLog.readDay(args?.date ? new Date(args.date) : new Date()));
  ipcMain.handle(IPC.AUDIT_STATS, async () => actionAuditLog.stats());
  ipcMain.handle(IPC.AUDIT_VERIFY, async () => {
    const brokenSeq = actionAuditLog.verifyIntegrity();
    return { intact: brokenSeq === null, brokenSeq };
  });

  // Agents (multi-agent system)
  ipcMain.handle(IPC.AGENT_LIST, async () => {
    // listAgents() already merges built-ins with custom agents from the
    // database — appending listCustomAgents() here duplicated every custom
    // agent in the fleet grid (React duplicate-key warnings, doubled cards).
    return listAgents().map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      color: a.color,
      allowedTools: a.allowedTools,
      maxTurns: a.maxTurns,
    }));
  });
  ipcMain.handle(IPC.AGENT_RUNS, async () => {
    clearCompletedRuns();
    return listRunStates();
  });
  ipcMain.handle(IPC.AGENT_SPAWN, async (_e, { agentId, task, sessionId, cwd, provider, model }) => {
    const win = getMainWindow();
    const sink = (e: unknown) => win?.webContents.send(IPC.AGENT_EVENT, e);
    const { state, done } = spawnSubagent({
      agentId: agentId as AgentId,
      task,
      sessionId,
      cwd,
      provider,
      model,
      parentHistory: [],
      sink,
    });
    done.catch(() => {}); // don't await — fire and forget
    return state;
  });
  ipcMain.handle(IPC.AGENT_ABORT, async (_e, { runId }: { runId: string }) => {
    const ok = abortSubagent(runId);
    return ok ? { ok: true } : { ok: false, error: `No active agent run found for ${runId}.` };
  });

  // Custom Agents
  ipcMain.handle(IPC.CUSTOM_AGENT_CREATE, async (_e, { agent }) => createCustomAgent(agent));
  ipcMain.handle(IPC.CUSTOM_AGENT_LIST, async () => listCustomAgents());
  ipcMain.handle(IPC.CUSTOM_AGENT_GET, async (_e, { id }) => getCustomAgent(id));
  ipcMain.handle(IPC.CUSTOM_AGENT_UPDATE, async (_e, { id, updates }) => updateCustomAgent(id, updates));
  ipcMain.handle(IPC.CUSTOM_AGENT_DELETE, async (_e, { id }) => deleteCustomAgent(id));

  // Memory
  ipcMain.handle(IPC.MEMORY_CREATE, async (_e, { entry }) => memoryStore.createMemory(entry));
  ipcMain.handle(IPC.MEMORY_LIST, async (_e, { type, search }) => memoryStore.listMemories(type, search));
  ipcMain.handle(IPC.MEMORY_GET, async (_e, { id }) => memoryStore.getMemory(id));
  ipcMain.handle(IPC.MEMORY_UPDATE, async (_e, { id, updates }) => memoryStore.updateMemory(id, updates));
  ipcMain.handle(IPC.MEMORY_DELETE, async (_e, { id }) => memoryStore.deleteMemory(id));
  ipcMain.handle(IPC.MEMORY_SEARCH, async (_e, { query }) => memoryStore.searchMemories(query));
  ipcMain.handle(IPC.MEMORY_STATS, async () => memoryStore.getMemoryStats());

  // Evaluation — read-only history. Runs deliberately execute in the headless
  // CLI process (`npm run eval`) so the approval-bypass env flag can never
  // leak into a concurrent chat turn in this process.
  ipcMain.handle(IPC.EVALUATION_LIST, async (_e, { limit }: { limit?: number } = {}) =>
    listEvaluationReports({ limit }));
  ipcMain.handle(IPC.EVALUATION_GET, async (_e, { id }: { id: string }) => getEvaluationReport(String(id ?? '')));
  ipcMain.handle(IPC.EVALUATION_CATALOG, async () => ({
    suites: listEvalSuites(),
    tasks: evalFixtures.map((task) => ({
      id: task.id,
      name: task.name,
      description: task.description,
      checks: task.checks.length,
      timeoutMs: task.timeoutMs ?? null,
      maxTurns: task.maxTurns ?? null,
    })),
  }));

  // MCP
  ipcMain.handle(IPC.MCP_LIST_SERVERS, async () => listMcpServers());
  ipcMain.handle(IPC.MCP_CONNECT, async (_e, { name, config }) => {
    await mcpConnect(name, config);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_DISCONNECT, async (_e, { name }) => {
    await mcpDisconnect(name);
    return { ok: true };
  });
  ipcMain.handle(IPC.MCP_STATUS, async () => mcpGetStatus());
  ipcMain.handle(IPC.MCP_LIST_TOOLS, async (_e, { name } = {}) => mcpListTools(name));

  // Permissions
  ipcMain.handle(IPC.PERMISSION_RESPONSE, async (_e, { id, allowed }) => {
    respondToPermission(id, allowed);
    return { ok: true };
  });

  // Blocking question cards (AskUserQuestion)
  // ── Workspace static server ─────────────────────────────────────────────────
// Serves the workspace over loopback so the Tabs browser can display a file the
// agent produced without launching an external browser window. A file outside
// the workspace (the agent often writes a scratch page to the temp directory)
// gets its own single-file root rather than widening the served tree.
ipcMain.handle(IPC.WORKSPACE_SERVE, async (_e, { root }: { root?: string }) => {
  try {
    const server = await startWorkspaceServer(root || process.cwd());
    return { ok: true, origin: server.origin, root: server.root };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});
ipcMain.handle(IPC.WORKSPACE_URL_FOR, async (_e, { path: filePath }: { path?: string }) => {
  try {
    if (!filePath) return { ok: false, error: 'path is required' };
    const absolute = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    const server = getWorkspaceServer();
    // Inside the served workspace? Use it directly.
    const url = server?.urlFor(absolute);
    if (url) return { ok: true, url };
    // Otherwise give the file its own root so a scratch page is still viewable.
    const external = await serveExternalFile(absolute);
    return external ? { ok: true, url: external } : { ok: false, error: 'Could not serve that file' };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});

// ── Tab index (renderer mirrors its tabs so the agent can see them) ─────────
ipcMain.handle(IPC.TAB_INDEX_REPLACE, async (_e, { tabs }: { tabs?: unknown }) => {
  replaceTabs(Array.isArray(tabs) ? (tabs as Array<{ id: string }>) : []);
  return { ok: true, count: listTabs().length };
});
ipcMain.handle(IPC.TAB_INDEX_UPSERT, async (_e, { tab }: { tab?: { id: string } }) => {
  if (!tab?.id) return { ok: false, error: 'tab.id is required' };
  return { ok: true, tab: upsertTab(tab) };
});
ipcMain.handle(IPC.TAB_INDEX_REMOVE, async (_e, { id }: { id?: string }) => {
  if (id) removeTab(id);
  return { ok: true };
});

// ── In-app browser (Tabs section) ───────────────────────────────────────────
// The guest is a WebContentsView child of the app window, so browsing happens
// inside Infinite OS and nothing ever appears over it. State changes are pushed
// back to every window so the toolbar, address bar and title stay truthful.
const pushTabBrowserEvent = (viewId: string): void => {
  const state = readTabBrowserState(viewId);
  if (!state) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.TAB_BROWSER_EVENT, { viewId, ...state });
  }
};
ipcMain.handle(IPC.TAB_BROWSER_CREATE, async (event, args) => {
  const result = createTabBrowserView({
    viewId: String(args?.viewId ?? ''),
    windowId: event.sender.id,
    url: String(args?.url ?? 'about:blank'),
    bounds: args?.bounds,
  });
  if (result.ok) {
    pushTabBrowserEvent(String(args.viewId));
    // Follow the guest's own lifecycle so the UI never goes stale.
    const { getTabBrowserWebContents } = await import('../tab-browser-view.js');
    const wc = getTabBrowserWebContents(String(args.viewId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (wc) {
      for (const channel of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-fail-load'] as const) {
        wc.on(channel as never, () => pushTabBrowserEvent(String(args.viewId)));
      }
    }
  }
  return result;
});
ipcMain.handle(IPC.TAB_BROWSER_BOUNDS, async (_e, args) => updateTabBrowserBounds({ viewId: String(args?.viewId), bounds: args?.bounds }));
ipcMain.handle(IPC.TAB_BROWSER_NAVIGATE, async (_e, args) => navigateTabBrowser({ viewId: String(args?.viewId), url: String(args?.url ?? '') }));
ipcMain.handle(IPC.TAB_BROWSER_BACK, async (_e, args) => goBackTabBrowser({ viewId: String(args?.viewId) }));
ipcMain.handle(IPC.TAB_BROWSER_FORWARD, async (_e, args) => goForwardTabBrowser({ viewId: String(args?.viewId) }));
ipcMain.handle(IPC.TAB_BROWSER_RELOAD, async (_e, args) => reloadTabBrowser({ viewId: String(args?.viewId) }));
ipcMain.handle(IPC.TAB_BROWSER_STATE, async (_e, args) => {
  const viewId = String(args?.viewId);
  const result = tabBrowserState({ viewId });
  if (!result.ok) return result;
  const viewport = await tabBrowserViewport(viewId);
  return { ...result, state: { ...result.state, viewport } };
});
ipcMain.handle(IPC.TAB_BROWSER_CLOSE, async (_e, args) => closeTabBrowserView({ viewId: String(args?.viewId) }));

ipcMain.handle(IPC.CHAT_QUESTION_RESOLVE, async (_e, { id, answers, skipped }) => {
    const ok = resolveUserQuestions(id, { answers: answers ?? {}, skipped: skipped ?? {} });
    return { ok };
  });

  // File System
  ipcMain.handle(IPC.FILE_READ, async (_e, { path: filePath }: { path: string }) => {
    try {
      const { readFile, stat } = await import('node:fs/promises');
      const s = await stat(filePath);
      if (s.isDirectory()) {
        const { readdir } = await import('node:fs/promises');
        const entries = await readdir(filePath, { withFileTypes: true });
        const enriched = await Promise.all(entries.map(async (e) => {
          try {
            const full = (await import('node:path')).join(filePath, e.name);
            const st = await stat(full);
            return { name: e.name, isDirectory: e.isDirectory(), size: st.size, mtime: st.mtimeMs, ext: e.name.split('.').pop()?.toLowerCase() ?? '' };
          } catch { return { name: e.name, isDirectory: e.isDirectory(), size: 0, mtime: 0, ext: '' }; }
        }));
        return {
          type: 'directory',
          entries: enriched,
        };
      }
      // Detect binary / media types — serve as base64 so renderer can preview inline.
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const imageExts = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg']);
      const videoExts = new Set(['mp4','webm','mov','avi','mkv','m4v']);
      const audioExts = new Set(['mp3','wav','ogg','flac','m4a','aac','wma']);
      const isImage = imageExts.has(ext);
      const isVideo = videoExts.has(ext);
      const isAudio = audioExts.has(ext);
      const isPdf = ext === 'pdf';
      // For media/pdf, return base64; cap inline preview to 60 MB.
      const MAX_INLINE = 60 * 1024 * 1024;
      if ((isImage || isVideo || isAudio || isPdf) && s.size <= MAX_INLINE) {
        const buf = await readFile(filePath);
        const b64 = buf.toString('base64');
        const mimeMap: Record<string,string> = {
          png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', bmp:'image/bmp', ico:'image/x-icon', svg:'image/svg+xml',
          mp4:'video/mp4', webm:'video/webm', mov:'video/quicktime', avi:'video/x-msvideo', mkv:'video/x-matroska', m4v:'video/x-m4v',
          mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', flac:'audio/flac', m4a:'audio/mp4', aac:'audio/aac', wma:'audio/x-ms-wma',
          pdf:'application/pdf',
        };
        return { type: 'file', content: b64, size: s.size, isBinary: true, mimeType: mimeMap[ext] ?? 'application/octet-stream', encoding: 'base64' as const, mtime: s.mtimeMs };
      }
      if ((isImage || isVideo || isAudio || isPdf) && s.size > MAX_INLINE) {
        return { type: 'file', content: '', size: s.size, isBinary: true, mimeType: 'application/octet-stream', tooLarge: true, mtime: s.mtimeMs };
      }
      const content = await readFile(filePath, 'utf8');
      return { type: 'file', content, size: s.size, isBinary: false, mtime: s.mtimeMs };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

  ipcMain.handle(IPC.FILE_WRITE, async (_e, { path: filePath, content }: { path: string; content: string }) => {
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  ipcMain.handle(IPC.FILE_OPEN, async (_e, { path: filePath }: { path: string }) => {
    try {
      const { resolve } = await import('node:path');
      const absolutePath = resolve(filePath);
      const error = await shell.openPath(absolutePath);
      return error ? { error } : { ok: true, path: absolutePath };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  ipcMain.handle(IPC.PICK_DIRECTORY, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle(IPC.FILE_SYSTEM_ROOTS, async () => {
    const { access } = await import('node:fs/promises');
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const home = homedir();
    const candidates = [
      { name: 'Home', path: home, kind: 'home' },
      { name: 'Desktop', path: join(home, 'Desktop'), kind: 'common' },
      { name: 'Downloads', path: join(home, 'Downloads'), kind: 'common' },
      { name: 'Documents', path: join(home, 'Documents'), kind: 'common' },
      { name: 'Pictures', path: join(home, 'Pictures'), kind: 'common' },
    ];
    const common = [];
    for (const item of candidates) {
      try {
        await access(item.path);
        common.push(item);
      } catch { /* unavailable location */ }
    }
    const driveCandidates = process.platform === 'win32'
      ? Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
      : ['/'];
    const drives: Array<{ name: string; path: string; kind: string }> = [];
    await Promise.all(driveCandidates.map(async (path) => {
      try {
        await access(path);
        drives.push({ name: process.platform === 'win32' ? `Local Disk (${path.slice(0, 2)})` : 'File System', path, kind: 'drive' });
      } catch { /* drive is not mounted */ }
    }));
    drives.sort((a, b) => a.path.localeCompare(b.path));
    return { home, common, drives };
  });
  ipcMain.handle(IPC.SYSTEM_OPEN_URL, async (_e, { url }: { url: string }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { error: `Unsupported URL protocol: ${parsed.protocol}` };
      }
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  ipcMain.handle(IPC.FILE_MKDIR, async (_e, { path: filePath }: { path: string }) => {
    try {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(filePath, { recursive: true });
      return { ok: true };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle(IPC.FILE_DELETE, async (_e, { path: filePath }: { path: string }) => {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(filePath, { recursive: true, force: true });
      return { ok: true };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle(IPC.FILE_RENAME, async (_e, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
    try {
      const { mkdir, rename } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(newPath), { recursive: true });
      await rename(oldPath, newPath);
      return { ok: true };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle(IPC.FILE_COPY, async (_e, { src, dest }: { src: string; dest: string }) => {
    try {
      const { cp, mkdir, stat } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      await mkdir(dirname(dest), { recursive: true });
      const s = await stat(src);
      if (s.isDirectory()) await cp(src, dest, { recursive: true });
      else await cp(src, dest);
      return { ok: true };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle(IPC.FILE_STAT, async (_e, { path: filePath }: { path: string }) => {
    try {
      const { stat } = await import('node:fs/promises');
      const s = await stat(filePath);
      return { ok: true, size: s.size, mtime: s.mtimeMs, isDirectory: s.isDirectory(), isFile: s.isFile() };
    } catch (e) { return { error: (e as Error).message }; }
  });
  ipcMain.handle(
    IPC.TERMINAL_EXECUTE,
    async (_e, { command, cwd }: { command: string; cwd?: string }) =>
      new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
        if (!command?.trim()) return reject(new Error('Command is required'));
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const shellArgs = process.platform === 'win32' ? ['-NoProfile', '-Command', command] : ['-c', command];
        const child = spawn(shell, shellArgs, { cwd: cwd || process.cwd(), windowsHide: true, env: process.env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout = (stdout + chunk.toString()).slice(-50_000)));
        child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-50_000)));
        const timeout = setTimeout(() => child.kill(), 120_000);
        child.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', (exitCode) => {
          clearTimeout(timeout);
          resolve({ stdout, stderr, exitCode });
        });
      }),
  );

  // App
  ipcMain.handle(IPC.APP_VERSION, async () => '0.1.0');
  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return { ok: false, error: 'Invalid URL' };
    await shell.openExternal(url);
    return { ok: true };
  });

  // System Metrics
  ipcMain.handle(IPC.METRICS_GET, async () => collectSystemMetrics());

  // Brain subsystem IPC
  registerBrainIpc();

  // Phase 2 IPC
  registerBrowserIpc();
  registerBridgeIpc();
  registerAutomationIpc(getMainWindow);
  registerWorkersIpc(getMainWindow);

  // Phase 3 IPC
  registerWebsiteIpc();
  registerAppIpc();
  registerBusinessIpc();
registerProjectIpc();

  // Studio + Planner: the personal document and life-operating surfaces.
  registerStudioIpc(getMainWindow);
  // Pages: the Notion-style workspace (pages, blocks, databases).
  registerPagesIpc(getMainWindow);

// Runs that a restart interrupted, so the app can tell the user what it had
// already done instead of dropping them back into a blank chat.
ipcMain.handle(IPC.RESUME_INTERRUPTED, async () => findInterruptedRuns());
  registerPluginIpc();

  // Phase 4 IPC
  registerCloudIpc();
  registerMultiAgentIpc();
  registerWorkspaceIpc();
  registerRemoteIpc();

  // Self-Improvement Agent IPC
  ipcMain.handle('self-improvement:audit', async (_e, { cwd }: { cwd: string }) => {
    const agent = new SelfImprovementAgent(cwd);
    return agent.runFullAudit();
  });
  ipcMain.handle('self-improvement:status', async (_e, { cwd }: { cwd: string }) => {
    const agent = new SelfImprovementAgent(cwd);
    return agent.getLastReport();
  });

  // Self-Evolution Engine IPC
  const selfEvolutionEngine = new SelfEvolutionEngine();
  ipcMain.handle(IPC.SELF_EVOLVE_ANALYZE, async () => {
    return selfEvolutionEngine.analyzePatterns();
  });
  ipcMain.handle(IPC.SELF_EVOLVE_SUGGESTIONS, async (_e, { status }: { status?: 'suggested' | 'accepted' | 'dismissed' }) => {
    return selfEvolutionEngine.getSuggestions(status);
  });
  ipcMain.handle(IPC.SELF_EVOLVE_ACCEPT, async (_e, { id }: { id: string }, autoCreate: boolean = true) => {
    return selfEvolutionEngine.acceptSuggestion(id, autoCreate);
  });
  ipcMain.handle(IPC.SELF_EVOLVE_DISMISS, async (_e, { id }: { id: string }) => {
    return selfEvolutionEngine.dismissSuggestion(id);
  });
  ipcMain.handle(IPC.SELF_EVOLVE_STATUS, async () => {
    return selfEvolutionEngine.getStatus();
  });
  ipcMain.handle(IPC.SELF_EVOLVE_PROMPT, async () => {
    return selfEvolutionEngine.getAutomationPrompt();
  });
  ipcMain.handle(IPC.SELF_EVOLVE_EVOLVE, async () => {
    return selfEvolutionEngine.evolve();
  });

  // Continuous self-evolution loop (the Settings "Evolve continuously" toggle).
  ipcMain.handle(IPC.EVOLVE_LOOP_START, async (_e, args?: { intervalMs?: number }) => {
    getEvolutionLoop().start(args);
    return getEvolutionLoop().status();
  });
  ipcMain.handle(IPC.EVOLVE_LOOP_STOP, async () => getEvolutionLoop().stop());
  ipcMain.handle(IPC.EVOLVE_LOOP_STATUS, async () => getEvolutionLoop().status());
  ipcMain.handle(IPC.EVOLVE_LOOP_RUN_NOW, async () => getEvolutionLoop().runNow());

  // Self-apply: typecheck + rebuild + relaunch so packaged builds load the
  // app's own source edits (dev mode hot-reloads — no rebuild needed).
  ipcMain.handle(IPC.SELF_APPLY_RUN, async () => {
    const win = getMainWindow();
    return getSelfApplyRunner().run({
      isPackaged: app.isPackaged,
      repoRoot: findSelfRepoRoot(),
      devServer: Boolean(process.env['ELECTRON_RENDERER_URL']),
      relaunch: () => {
        snapshotActiveRunsForResume();
        app.relaunch();
        app.exit(0);
      },
      onEvent: (event) => {
        try {
          win?.webContents.send(IPC.SELF_APPLY_EVENT, event);
        } catch { /* window may be gone mid-relaunch */ }
      },
    });
  });
  ipcMain.handle(IPC.SELF_APPLY_STATUS, async () => getSelfApplyRunner().status());

  // Skills IPC
  ipcMain.handle(IPC.SKILLS_LIST, async () => {
    const mgr = new SkillsManager();
    return mgr.listAllSkills();
  });
  ipcMain.handle(IPC.SKILLS_GET, async (_e, { id }: { id: string }) => {
    const mgr = new SkillsManager();
    return mgr.getSkill(id) ?? null;
  });
  ipcMain.handle(IPC.SKILLS_CREATE, async (_e, { skill }: { skill: Parameters<SkillsManager['addSkill']>[0] }) => {
    const mgr = new SkillsManager();
    return mgr.addSkill(skill);
  });
  ipcMain.handle(IPC.SKILLS_UPDATE, async (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    const mgr = new SkillsManager();
    return mgr.updateSkill(id, updates as Parameters<SkillsManager['updateSkill']>[1]);
  });
  ipcMain.handle(IPC.SKILLS_DELETE, async (_e, { id }: { id: string }) => {
    const mgr = new SkillsManager();
    return mgr.removeSkill(id);
  });
  ipcMain.handle(IPC.SKILLS_TOGGLE, async (_e, { id }: { id: string }) => {
    const mgr = new SkillsManager();
    return mgr.toggleSkill(id);
  });
  ipcMain.handle(IPC.SKILLS_SEARCH, async (_e, { query }: { query: string }) => {
    const mgr = new SkillsManager();
    return mgr.searchSkills(query);
  });
  ipcMain.handle(IPC.SKILLS_STATS, async () => {
    const mgr = new SkillsManager();
    return mgr.getStats();
  });
  ipcMain.handle(IPC.SKILLS_IMPORT_CLAUDE, async (_e, { filePath }: { filePath: string }) => {
    const mgr = new SkillsManager();
    return mgr.importClaudeCodeSkill(filePath);
  });
  ipcMain.handle(IPC.SKILLS_RELEVANT, async (_e, { task }: { task: string }) => {
    const mgr = new SkillsManager();
    return mgr.getRelevantSkills(task);
  });
  ipcMain.handle(IPC.SKILLS_EXPORT, async (_e, { skillIds }: { skillIds?: string[] }) => {
    const mgr = new SkillsManager();
    return mgr.exportSkills(skillIds);
  });
  ipcMain.handle(IPC.SKILLS_IMPORT, async (_e, { manifest }: { manifest: unknown }) => {
    const mgr = new SkillsManager();
    const m = manifest as { skills?: Array<{ name: string; description: string; category: string; instructions: string; enabled?: boolean }> };
    let imported = 0;
    for (const skill of m.skills ?? []) {
      try {
        await mgr.addSkill({
          name: skill.name,
          description: skill.description,
          category: skill.category,
          instructions: skill.instructions,
          source: 'imported',
          enabled: skill.enabled ?? true,
        });
        imported++;
      } catch { /* skip duplicates */ }
    }
    return { imported };
  });

  // Personalization IPC
  ipcMain.handle('profile:get', async () => {
    const mgr = new PersonalizationManager();
    return mgr.getProfile();
  });
  ipcMain.handle('profile:update', async (_e, { updates }: { updates: Record<string, unknown> }) => {
    const mgr = new PersonalizationManager();
    return mgr.updateProfile(updates as Parameters<PersonalizationManager['updateProfile']>[0]);
  });
  ipcMain.handle('profile:preferences', async (_e, { prefs }: { prefs: Record<string, unknown> }) => {
    const mgr = new PersonalizationManager();
    return mgr.updatePreferences(prefs as Parameters<PersonalizationManager['updatePreferences']>[0]);
  });
  ipcMain.handle('profile:business', async (_e, { ctx }: { ctx: Record<string, unknown> }) => {
    const mgr = new PersonalizationManager();
    return mgr.updateBusinessContext(ctx as Parameters<PersonalizationManager['updateBusinessContext']>[0]);
  });
  ipcMain.handle('profile:context', async () => {
    const mgr = new PersonalizationManager();
    return mgr.getPersonalizedContext();
  });
  ipcMain.handle('profile:suggestions', async () => {
    const mgr = new PersonalizationManager();
    return mgr.suggestImprovements();
  });

  // Orchestrator IPC
  ipcMain.handle(IPC.ORCHESTRATOR_START, async (_e, { prompt, displayPrompt, sessionId, cwd, provider, model }) => {
    const win = getMainWindow();
    if (!win) throw new Error('No window');
    await sessionStore.appendMessage(sessionId, {
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text: displayPrompt ?? prompt }],
      timestamp: Date.now(),
    });

    // Gather available providers
    const availableProviders = new Map<string, { apiKey?: string; baseUrl?: string }>();
    for (const p of listProviders()) {
      const key = await getApiKey(p.id).catch(() => undefined);
      availableProviders.set(p.id, { apiKey: key });
    }

    // Analyze and decompose the task
    const task = orchestrator.analyze(
      prompt,
      availableProviders,
      provider && model ? { provider, model } : undefined,
    );

    // Notify user about paid model if needed
    if (task.paidModelNotification) {
      win.webContents.send(IPC.CHAT_STREAM_EVENT, {
        sessionId,
        type: 'text_delta',
        message_id: 'system-notification',
        text: `\n\n⚠️ ${task.paidModelNotification}\n`,
      });
    }

    // Stream orchestrator events to renderer
    const sink = (e: OrchestratorEvent) => {
      win.webContents.send(IPC.ORCHESTRATOR_EVENT, { sessionId, ...e });
      if (e.type === 'task_completed' || e.type === 'task_failed') {
        const data = e.data as {
          totalSubTasks?: number;
          completed?: number;
          failed?: number;
          errors?: string[];
          report?: {
            summary?: string;
            failed?: Array<{ description: string; error: string; attempts: number }>;
            retries?: Array<{ description: string; attempt: number; reason: string }>;
          };
        };
        const text =
          data.report?.summary ?? (e.type === 'task_completed'
            ? `Task completed successfully: ${data.completed ?? 0} of ${data.totalSubTasks ?? data.completed ?? 0} sub-tasks passed.`
            : `Task failed and was not marked complete: ${data.completed ?? 0} sub-task(s) passed and ${data.failed ?? 1} failed.${data.errors?.length ? ` ${data.errors.slice(0, 2).join(' ')}` : ''}`);
        const detail = data.report?.failed?.length
          ? `\n\nUnresolved phases:\n${data.report.failed.map((phase) => `- ${phase.description}: ${phase.error} (attempts: ${phase.attempts})`).join('\n')}`
          : '';
        void (async () => {
          // Deleting/clearing a conversation also cancels its orchestrator.
          // Do not recreate that transcript when cancellation winds down.
          if (!(await sessionStore.loadSessionMeta(sessionId))) return;
          await sessionStore.appendMessage(sessionId, {
            id: uuid(),
            role: 'assistant',
            content: [{ type: 'text', text: `${text}${detail}` }],
            timestamp: Date.now(),
          });
        })();
      }
    };

    // Execute autonomously in background
    orchestrator.execute(task.id, sessionId, cwd, sink).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      win.webContents.send(IPC.ORCHESTRATOR_EVENT, {
        sessionId,
        type: 'task_failed',
        taskId: task.id,
        data: {
          totalSubTasks: task.subTasks.length,
          completed: task.subTasks.filter((subTask) => subTask.status === 'completed').length,
          failed: task.subTasks.filter((subTask) => subTask.status !== 'completed').length,
          report: { summary: `Orchestrator crashed before completion: ${message}`, failed: [], retries: [] },
        },
      });
    });

    return { taskId: task.id, subTasks: task.subTasks.length, model: task.modelSelection };
  });

  ipcMain.handle(IPC.ORCHESTRATOR_INTERJECT, async (_e, { taskId, message }) => {
    orchestrator.interject(taskId, message);
    return { ok: true };
  });

  ipcMain.handle(IPC.ORCHESTRATOR_STATUS, async (_e, { taskId }: { taskId?: string }) => {
    if (taskId) return orchestrator.getTask(taskId);
    return orchestrator.getActiveTasks();
  });

  // ── Crew IPC (multi-agent + multi-model orchestration) ─────────────────
  ipcMain.handle(IPC.CREW_START, async (_e, { prompt, displayPrompt, sessionId, cwd, provider, model, agents, provider2, model2 }) => {
    const win = getMainWindow();
    if (!win) throw new Error('No window');

    await sessionStore.appendMessage(sessionId, {
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text: displayPrompt ?? prompt }],
      timestamp: Date.now(),
    });

    // Gather provider keys (only providers the user actually configured).
    const available = new Map<string, { apiKey?: string; baseUrl?: string }>();
    for (const p of listProviders()) {
      const key = await getApiKey(p.id).catch(() => undefined);
      if (key) available.set(p.id, { apiKey: key });
    }
    // Always include the current provider (it must at least hold the leader).
    const curKey = await getApiKey(provider ?? '').catch(() => undefined);
    if (provider && !available.has(provider) && (curKey || provider === 'ollama' || provider === 'opencode')) {
      available.set(provider, { apiKey: curKey });
    }
    // The paired model's provider must be reachable too — keyless providers
    // (ollama/opencode) join without a key, keyed providers require their key.
    if (provider2 && !available.has(provider2)) {
      const p2key = await getApiKey(provider2).catch(() => undefined);
      if (p2key || provider2 === 'ollama' || provider2 === 'opencode') {
        available.set(provider2, { apiKey: p2key });
      }
    }

    const leader: { provider: string; model: string; free: boolean } = {
      provider: provider ?? 'openrouter',
      model: model ?? 'google/gemma-4-31b-it:free',
      free: false,
    };
    try {
      const adapter = providerRegistry[leader.provider];
      leader.free = adapter?.freeModels.some((m) => m.id === leader.model && m.free) ?? false;
    } catch { /* best-effort */ }

    const plan = buildCrewPlan(prompt, leader, available, agents?.length ? agents : undefined, provider2 && model2 ? { provider: provider2, model: model2 } : undefined);
    const sink = (e: CrewEvent) => {
      win.webContents.send(IPC.CREW_EVENT, { sessionId, ...e });
    };

    runCrew(plan, {
      prompt,
      sessionId,
      cwd,
      parentHistory: await sessionStore.loadMessages(sessionId).catch(() => []),
      sink,
    }).then(async (run) => {
      // Persist the final leader answer into the transcript.
      if (!(await sessionStore.loadSessionMeta(sessionId))) return;
      if (!run.report?.leaderResult) return;
      const memberLines = run.report.memberReports
        .filter((m) => m.result)
        .map((m) => `- ${m.role}: ${(m.result ?? '').slice(0, 300)}`)
        .join('\n');
      const fallbackLines = run.report.fallbacks.length
        ? `\n\nModel fallbacks used:\n${run.report.fallbacks.map((f) => `- ${f}`).join('\n')}`
        : '';
      await sessionStore.appendMessage(sessionId, {
        id: uuid(),
        role: 'assistant',
        content: [{ type: 'text', text: `${run.report.leaderResult}${memberLines ? `\n\nCrew summary:\n${memberLines}` : ''}${fallbackLines}` }],
        timestamp: Date.now(),
      });
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      win.webContents.send(IPC.CREW_EVENT, {
        sessionId,
        type: 'crew_failed',
        runId: 'unknown',
        data: { summary: `Crew crashed before completion: ${message}`, fallbacks: [], unresolved: [] },
      });
    });

    const pairedMember = provider2 && model2 ? plan.members.find((m) => m.role === 'Collaborator') ?? null : null;
    return {
      runId: null,
      strategy: plan.strategy,
      members: plan.members.map((m) => ({ role: m.role, agentType: m.agentType, provider: m.assignment.provider, model: m.assignment.model })),
      leader,
      paired: pairedMember ? { role: pairedMember.role, provider: pairedMember.assignment.provider, model: pairedMember.assignment.model } : null,
    };
  });

  ipcMain.handle(IPC.CREW_STATUS, async () => {
    return listCrewRuns();
  });

  // ── Session Board IPC (kanban management of parallel agent sessions) ────
  sessionBoard.onEvent((event) => {
    const win = getMainWindow();
    win?.webContents.send(IPC.SESSION_BOARD_EVENT, event);
  });

  ipcMain.handle(IPC.SESSION_BOARD_CREATE, async (_e, { title, options }) => {
    return sessionBoard.createSession(title, options);
  });

  ipcMain.handle(IPC.SESSION_BOARD_START, async (_e, { sessionId, task, agentId, model, provider }) => {
    const session = await sessionBoard.startSession(sessionId, task, agentId, model, provider);
    if (!session) throw new Error('Unknown session.');
    return session;
  });

  ipcMain.handle(IPC.SESSION_BOARD_CANCEL, async (_e, { sessionId }) => {
    return { ok: sessionBoard.cancelSession(sessionId) };
  });

  ipcMain.handle(IPC.SESSION_BOARD_INTERJECT, async (_e, { sessionId, message }) => {
    return { ok: sessionBoard.interject(sessionId, message) };
  });

  ipcMain.handle(IPC.SESSION_BOARD_LIST, async () => {
    return sessionBoard.getBoardData();
  });

  ipcMain.handle(IPC.SESSION_BOARD_GET, async (_e, { sessionId }) => {
    return sessionBoard.getSession(sessionId) ?? null;
  });

  // Model Selector IPC
  ipcMain.handle(IPC.MODEL_SELECT, async (_e, { taskType }) => {
    const availableProviders = new Map<string, { apiKey?: string; baseUrl?: string }>();
    for (const p of listProviders()) {
      const key = await getApiKey(p.id).catch(() => undefined);
      availableProviders.set(p.id, { apiKey: key });
    }
    return selectBestModel(taskType ?? 'general', availableProviders);
  });

  ipcMain.handle(IPC.MODEL_FREE_LIST, async () => {
    return getAllFreeModels();
  });

  // Voice Assistant IPC — settings, commands, history, and transcript routing
  // are persisted by src/main/voice/assistant.ts.
  ipcMain.handle(IPC.VOICE_CONFIG_GET, async () => getVoiceConfig());
  ipcMain.handle(IPC.VOICE_CONFIG_SET, async (_e, { config }: { config?: Partial<VoiceConfig> }) =>
    setVoiceConfig(config ?? {}),
  );
  // ── Dictation engine selection ─────────────────────────────────────────
  // Order: fully local (mic → energy VAD → Faster-Whisper, offline) →
  // Windows SAPI dictation → the browser engine in the renderer. Each layer
  // only starts when the one above it is unavailable or refuses to start, so
  // a missing Python install still ends in a working microphone.
  let localVoiceForward: (() => void) | null = null;
  let localVoiceStartError: string | null = null;
  // Bumped by every Stop so a Stop that lands while start() is still awaiting
  // the Python handshake cannot leave a freshly-started session orphaned
  // behind an already-unsubscribed listener.
  let listenEpoch = 0;

  // The server also emits mic-meter/status chatter (level, speech_start,
  // status, tts_*); only the renderer's dictation contract is forwarded.
  const LOCAL_DICTATION_TYPES = new Set(['ready', 'result', 'error', 'ended']);

  ipcMain.handle(IPC.VOICE_START_LISTENING, async (event) => {
    localVoiceStartError = null;
    const epoch = ++listenEpoch;

    if (isLocalVoiceScriptAvailable()) {
      const local = getLocalVoice();
      // Subscribe before start(): the server emits `ready` as part of
      // starting the capture stream.
      localVoiceForward?.();
      localVoiceForward = local.onEvent((payload) => {
        if (!LOCAL_DICTATION_TYPES.has(payload.type) || event.sender.isDestroyed()) return;
        event.sender.send(IPC.VOICE_TRANSCRIPT_EVENT, {
          type: payload.type,
          transcript: payload.transcript,
          // VAD-gated local results are always whole-utterance finals.
          final: payload.type === 'result' ? true : undefined,
          confidence: payload.confidence,
          language: payload.language,
          message: payload.message,
        });
      });

      const config = getVoiceConfig();
      const result = await local.start({
        language: config.language,
        model: config.sttModel,
        // Bias decoding toward the wake phrase — small models garble it.
        hotwords: config.wakeWord,
      });

      if (result.ok) {
        if (epoch !== listenEpoch) {
          // Stopped while starting: tear the session back down instead of
          // returning a live engine nobody is listening to.
          await local.stop().catch(() => undefined);
          localVoiceForward?.();
          localVoiceForward = null;
          return { ok: false, error: 'Stopped before the speech engine finished starting.' };
        }
        return { ok: true, engine: 'local-whisper', model: result.model };
      }

      localVoiceForward?.();
      localVoiceForward = null;
      localVoiceStartError = result.error ?? 'Local speech engine failed to start.';
    }

    if (epoch !== listenEpoch) {
      return { ok: false, error: 'Stopped before the speech engine finished starting.' };
    }

    const started = await windowsDictation.start((payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.VOICE_TRANSCRIPT_EVENT, payload);
    });
    if (started.ok && epoch !== listenEpoch) {
      windowsDictation.stop();
      return { ok: false, error: 'Stopped before the speech engine finished starting.' };
    }
    if (started.ok) return started;
    const parts = [localVoiceStartError, started.error].filter(Boolean) as string[];
    return { ok: false, error: parts.join(' — ') || 'No speech engine is available.' };
  });

  ipcMain.handle(IPC.VOICE_STOP_LISTENING, async () => {
    listenEpoch += 1;
    localVoiceForward?.();
    localVoiceForward = null;
    // Both are safe no-ops when they never started, and stopping one must
    // never leave the other holding the microphone.
    await getLocalVoice().stop().catch(() => undefined);
    windowsDictation.stop();
    return { ok: true };
  });
  ipcMain.handle(IPC.VOICE_PROCESS_TRANSCRIPT, async (_e, { transcript }: { transcript?: string }) =>
    processTranscript(transcript ?? ''),
  );
  ipcMain.handle(IPC.VOICE_SET_WAKE_WORD, async (_e, { word }: { word?: string }) => {
    setVoiceConfig({ wakeWord: word ?? '' });
    return { ok: true, config: getVoiceConfig() };
  });
  ipcMain.handle(IPC.VOICE_ADD_CUSTOM_COMMAND, async (_e, { trigger, action }: { trigger?: string; action?: string }) => {
    addCustomCommand(trigger ?? '', action ?? '');
    return { ok: true, commands: listCustomCommands() };
  });
  ipcMain.handle(IPC.VOICE_REMOVE_CUSTOM_COMMAND, async (_e, { trigger }: { trigger?: string }) => {
    removeCustomCommand(trigger ?? '');
    return { ok: true, commands: listCustomCommands() };
  });
  ipcMain.handle(IPC.VOICE_CUSTOM_COMMANDS, async () => listCustomCommands());
  ipcMain.handle(IPC.VOICE_HISTORY, async () => listHistory());

  // ── Always-on voice ───────────────────────────────────────────────────────
  // The listening loop is owned by the main process (voice/session.ts), so it
  // keeps working whichever view is open. These handlers are a thin control
  // surface; state is broadcast to every window on every change.
  const broadcastVoiceState = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IPC.VOICE_SESSION_EVENT, voiceSession.getState());
    }
  };
  ipcMain.handle(IPC.VOICE_SESSION_STATE, async () => voiceSession.getState());
  ipcMain.handle(IPC.VOICE_SESSION_SET_ENABLED, async (_e, { enabled, cwd }: { enabled?: boolean; cwd?: string }) =>
    voiceSession.setEnabled(enabled === true, cwd || '.'),
  );
  ipcMain.handle(IPC.VOICE_SESSION_PAUSE, async () => {
    voiceSession.pause();
    return voiceSession.getState();
  });
  ipcMain.handle(IPC.VOICE_SESSION_RESUME, async () => voiceSession.resume());
  ipcMain.handle(IPC.VOICE_SESSION_INTERRUPT, async () => {
    voiceSession.interrupt();
    return voiceSession.getState();
  });
  ipcMain.handle(IPC.VOICE_SESSION_SAY, async (_e, { text }: { text?: string }) => {
    // Fire and forget: the renderer only needs the audio to start.
    void voiceSession.say(text ?? '');
    return { ok: true };
  });
  voiceSession.on('state', broadcastVoiceState);
  voiceSession.on('utterance', (payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.VOICE_SESSION_EVENT, voiceSession.getState(), payload);
    }
  });
  ipcMain.handle(IPC.VOICE_CLEAR_HISTORY, async () => {
    clearHistory();
    return { ok: true };
  });
  ipcMain.handle(IPC.VOICE_SPEAK, async (_e, { text }) => {
    try {
      const { getVoiceAsync } = await import('../voice/index.js');
      const voice = await getVoiceAsync();
      const buffer = await voice.textToSpeech(text);
      return { ok: true, audio: buffer.toString('base64') };
    } catch {
      // Fallback: notify renderer to use browser SpeechSynthesis.
      const win = getMainWindow();
      win?.webContents.send(IPC.CHAT_STREAM_EVENT, { type: 'voice_speak', text });
      return { ok: true, fallback: true };
    }
  });
  // VOICE_STATUS is registered in gaps.ts (registerGapIpc) — do not duplicate

  // Video Clipping IPC
  ipcMain.handle(IPC.VIDEO_CREATE_PROJECT, async (_e, { name, sourceFile, description }) =>
    videoEngine.createProject(name, sourceFile, description),
  );
  ipcMain.handle(IPC.VIDEO_LIST_PROJECTS, async () => videoEngine.listProjects());
  ipcMain.handle(IPC.VIDEO_GET_PROJECT, async (_e, { id }) => videoEngine.getProject(id) ?? null);
  ipcMain.handle(IPC.VIDEO_DELETE_PROJECT, async (_e, { id }) => videoEngine.deleteProject(id));
  ipcMain.handle(IPC.VIDEO_ANALYZE, async (_e, { projectId }) => videoEngine.analyzeVideo(projectId));
  ipcMain.handle(IPC.VIDEO_EXTRACT_CLIP, async (_e, { projectId, startTime, endTime, name, tags }) =>
    videoEngine.extractClip({ projectId, startTime, endTime, name, tags }),
  );
  ipcMain.handle(IPC.VIDEO_FIND_HIGHLIGHTS, async (_e, { projectId, maxClips }) =>
    videoEngine.findHighlights(projectId, maxClips),
  );
  ipcMain.handle(IPC.VIDEO_ADD_TRANSCRIPT, async (_e, { projectId, segments }) => {
    await videoEngine.addTranscript(projectId, segments);
    return { ok: true };
  });
  ipcMain.handle(IPC.VIDEO_SPLIT_BY_CHAPTERS, async (_e, { projectId }) => videoEngine.splitByChapters(projectId));
  ipcMain.handle(IPC.VIDEO_ADD_HIGHLIGHT, async (_e, { projectId, timestamp, description }) => {
    videoEngine.addHighlight(projectId, timestamp, description);
    return { ok: true };
  });

  // Deployment IPC
  ipcMain.handle(IPC.DEPLOY_CREATE_TARGET, async (_e, { name, type, config }) =>
    deploySystem.createTarget(name, type, config),
  );
  ipcMain.handle(IPC.DEPLOY_LIST_TARGETS, async () => deploySystem.listTargets());
  ipcMain.handle(IPC.DEPLOY_GET_TARGET, async (_e, { id }) => deploySystem.getTarget(id) ?? null);
  ipcMain.handle(IPC.DEPLOY_DELETE_TARGET, async (_e, { id }) => deploySystem.deleteTarget(id));
  ipcMain.handle(IPC.DEPLOY_CREATE_PIPELINE, async (_e, { name, projectId, targetId, commands }) =>
    deploySystem.createPipeline(name, projectId, targetId, commands),
  );
  ipcMain.handle(IPC.DEPLOY_RUN_PIPELINE, async (_e, { pipelineId, cwd }) => deploySystem.runPipeline(pipelineId, cwd));
  ipcMain.handle(IPC.DEPLOY_CANCEL_PIPELINE, async (_e, { pipelineId }) => deploySystem.cancelPipeline(pipelineId));
  ipcMain.handle(IPC.DEPLOY_GET_PIPELINE, async (_e, { id }) => deploySystem.getPipeline(id) ?? null);
  ipcMain.handle(IPC.DEPLOY_LIST_PIPELINES, async () => deploySystem.listPipelines());
  ipcMain.handle(IPC.DEPLOY_DETECT_PROJECT, async (_e, { projectPath }) => deploySystem.detectProjectType(projectPath));
  ipcMain.handle(IPC.DEPLOY_DEFAULT_CONFIG, async (_e, { type }) => deploySystem.getDefaultBuildConfig(type));
  ipcMain.handle(IPC.DEPLOY_QUICK_PUSH, async (_e, { cwd, message }: { cwd?: string; message?: string }) => {
    const workDir = cwd || process.cwd();
    const commitMsg = message || `deploy ${new Date().toISOString().slice(0, 19)}`;
    const target = deploySystem.createTarget('github-push', 'local', { cwd: workDir });
    const pipeline = await deploySystem.createPipeline('Quick Push', 'default', target.id, [
      `git add -A`,
      `git commit -m "${commitMsg}"`,
      `git push`,
    ]);
    return deploySystem.runPipeline(pipeline.id, workDir);
  });
  ipcMain.handle(IPC.DEPLOY_OS_STATUS, async () => osPushStatus());
  ipcMain.handle(IPC.DEPLOY_OS_PUSH, async (_e, { message }: { message?: string }) => osPush(message));

  // Enterprise IPC
  ipcMain.handle(IPC.ENTERPRISE_ADD_MEMBER, async (_e, { name, email, role }) =>
    enterpriseManager.addMember(name, email, role),
  );
  ipcMain.handle(IPC.ENTERPRISE_LIST_MEMBERS, async () => enterpriseManager.listMembers());
  ipcMain.handle(IPC.ENTERPRISE_GET_MEMBER, async (_e, { id }) => enterpriseManager.getMember(id) ?? null);
  ipcMain.handle(IPC.ENTERPRISE_UPDATE_ROLE, async (_e, { id, role }) => enterpriseManager.updateMemberRole(id, role));
  ipcMain.handle(IPC.ENTERPRISE_REMOVE_MEMBER, async (_e, { id }) => enterpriseManager.removeMember(id));
  ipcMain.handle(IPC.ENTERPRISE_CREATE_PROJECT, async (_e, { name, ownerId, description }) =>
    enterpriseManager.createProject(name, ownerId, description),
  );
  ipcMain.handle(IPC.ENTERPRISE_LIST_PROJECTS, async () => enterpriseManager.listProjects());
  ipcMain.handle(IPC.ENTERPRISE_ADD_MEMBER_TO_PROJECT, async (_e, { projectId, memberId }) =>
    enterpriseManager.addMemberToProject(projectId, memberId),
  );
  ipcMain.handle(IPC.ENTERPRISE_REMOVE_MEMBER_FROM_PROJECT, async (_e, { projectId, memberId }) =>
    enterpriseManager.removeMemberFromProject(projectId, memberId),
  );
  ipcMain.handle(IPC.ENTERPRISE_AUDIT_LOG, async (_e, { filters }) => enterpriseManager.getAuditLog(filters));
  ipcMain.handle(IPC.ENTERPRISE_ADD_COMPLIANCE_RULE, async (_e, { name, description, category, severity, check }) =>
    enterpriseManager.addComplianceRule(name, description, category, severity, check),
  );
  ipcMain.handle(IPC.ENTERPRISE_COMPLIANCE_RULES, async () => enterpriseManager.listComplianceRules());
  ipcMain.handle(IPC.ENTERPRISE_COMPLIANCE_STATUS, async () => enterpriseManager.getComplianceStatus());
  ipcMain.handle(IPC.ENTERPRISE_EXPORT_AUDIT, async () => enterpriseManager.exportAuditLog());

  // Company board (Enterprise tab — shared by the user UI and the agent tool)
  ipcMain.handle(IPC.ENTERPRISE_COMPANY_GET, async () => {
    const { getCompany } = await import('../enterprise/company.js');
    return getCompany();
  });
  ipcMain.handle(IPC.ENTERPRISE_COMPANY_UPDATE, async (_e, { name, industry, website }) => {
    const { updateCompany } = await import('../enterprise/company.js');
    return updateCompany({ ...(typeof name === 'string' ? { name } : {}), ...(typeof industry === 'string' ? { industry } : {}), ...(typeof website === 'string' ? { website } : {}) });
  });
  ipcMain.handle(IPC.ENTERPRISE_COMPANY_ADD_NOTE, async (_e, { text, kind }) => {
    const { addCompanyNote } = await import('../enterprise/company.js');
    if (typeof text !== 'string' || !text.trim()) throw new Error('text is required');
    const valid = ['note', 'complaint', 'decision', 'contact'] as const;
    return addCompanyNote(text.trim(), valid.includes(kind) ? kind : 'note', 'user');
  });
  ipcMain.handle(IPC.ENTERPRISE_COMPANY_DELETE_NOTE, async (_e, { id }) => {
    const { deleteCompanyNote } = await import('../enterprise/company.js');
    return deleteCompanyNote(id);
  });

  // Business knowledge base (Knowledge tab — separate from agent memory)
  ipcMain.handle(IPC.KB_LIST, async () => {
    const kb = await import('../knowledge/business-kb.js');
    return kb.listKb();
  });
  ipcMain.handle(IPC.KB_GET, async (_e, { id }) => {
    const kb = await import('../knowledge/business-kb.js');
    return kb.getKb(id);
  });
  ipcMain.handle(IPC.KB_SAVE, async (_e, { id, title, content, tags }) => {
    const kb = await import('../knowledge/business-kb.js');
    if (typeof title !== 'string' || !title.trim()) throw new Error('title is required');
    return kb.saveKb({
      ...(typeof id === 'string' && id ? { id } : {}),
      title,
      content: typeof content === 'string' ? content : '',
      tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
    });
  });
  ipcMain.handle(IPC.KB_DELETE, async (_e, { id }) => {
    const kb = await import('../knowledge/business-kb.js');
    return kb.deleteKb(id);
  });
  ipcMain.handle(IPC.KB_ATTACH, async (_e, { path: filePath, title }) => {
    const kb = await import('../knowledge/business-kb.js');
    if (typeof filePath !== 'string' || !filePath) throw new Error('path is required');
    return kb.attachKbFile(filePath, typeof title === 'string' ? title : undefined);
  });
  ipcMain.handle(IPC.PICK_FILE, async (_e, { filters }: { filters?: Array<{ name: string; extensions: string[] }> } = {}) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters?.length ? filters : [{ name: 'Documents', extensions: ['pdf', 'xlsx', 'xls', 'csv', 'txt', 'md'] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  // Call Center IPC
  ipcMain.handle(IPC.CALL_CREATE, async (_e, { callerId, direction, options }) =>
    callCenter.createCall(callerId, direction, options),
  );
  ipcMain.handle(IPC.CALL_ANSWER, async (_e, { callId, agentId }) => callCenter.answerCall(callId, agentId));
  ipcMain.handle(IPC.CALL_HOLD, async (_e, { callId }) => callCenter.holdCall(callId));
  ipcMain.handle(IPC.CALL_RESUME, async (_e, { callId }) => callCenter.resumeCall(callId));
  ipcMain.handle(IPC.CALL_END, async (_e, { callId, disposition, notes }) =>
    callCenter.endCall(callId, disposition, notes),
  );
  ipcMain.handle(IPC.CALL_MISS, async (_e, { callId }) => callCenter.missCall(callId));
  ipcMain.handle(IPC.CALL_GET, async (_e, { id }) => callCenter.getCall(id) ?? null);
  ipcMain.handle(IPC.CALL_LIST, async (_e, { filters }) => callCenter.listCalls(filters));
  ipcMain.handle(IPC.CALL_QUEUE_CREATE, async (_e, { name, maxWaitTime, priority }) =>
    callCenter.createQueue(name, maxWaitTime, priority),
  );
  ipcMain.handle(IPC.CALL_QUEUE_LIST, async () => callCenter.listQueues());
  ipcMain.handle(IPC.CALL_QUEUE_ADD, async (_e, { queueId, callId }) => callCenter.addToQueue(queueId, callId));
  ipcMain.handle(IPC.CALL_QUEUE_REMOVE, async (_e, { queueId, callId }) => callCenter.removeFromQueue(queueId, callId));
  ipcMain.handle(IPC.CALL_AGENT_CREATE, async (_e, { name, skills, maxConcurrent }) =>
    callCenter.createAgent(name, skills, maxConcurrent),
  );
  ipcMain.handle(IPC.CALL_AGENT_LIST, async () => callCenter.listAgents());
  ipcMain.handle(IPC.CALL_AGENT_STATUS, async (_e, { agentId, status }) =>
    callCenter.updateAgentStatus(agentId, status),
  );
  ipcMain.handle(IPC.CALL_ASSIGN, async (_e, { agentId, callId }) => callCenter.assignCall(agentId, callId));
  ipcMain.handle(IPC.CALL_TEMPLATE_CREATE, async (_e, { name, greeting, prompts }) =>
    callCenter.createTemplate(name, greeting, prompts),
  );
  ipcMain.handle(IPC.CALL_TEMPLATE_LIST, async () => callCenter.listTemplates());
  ipcMain.handle(IPC.CALL_ANALYTICS, async (_e, { since }) => callCenter.getAnalytics(since));

  // Screenshot cleanup IPC
  ipcMain.handle('screenshot:cleanup', async () => {
    const { runScreenshotCleanup } = await import('../system/screenshot-cleanup.js');
    return runScreenshotCleanup();
  });
  ipcMain.handle('screenshot:restore', async () => {
    const { restoreTrashedScreenshots } = await import('../system/screenshot-cleanup.js');
    return restoreTrashedScreenshots();
  });
  ipcMain.handle('screenshot:stats', async () => {
    const { getScreenshotStats } = await import('../system/screenshot-cleanup.js');
    return getScreenshotStats();
  });

  // Token and cost totals. Providers report usage per response and the
  // pricing table can price it, but nothing connected the two, so the numbers
  // were captured and thrown away.
  ipcMain.handle(IPC.USAGE_GET, async () => {
    const { getUsageTotals } = await import('../providers/usage-store.js');
    return getUsageTotals();
  });
  ipcMain.handle(IPC.USAGE_RESET, async () => {
    const { resetUsage } = await import('../providers/usage-store.js');
    resetUsage();
    return true;
  });

  // Window controls are registered by registerWindowIpc() — no duplicates here.
}

function detectTaskType(input: string): string {
  const lower = input.toLowerCase().slice(0, 200);
  if (/\b(code|program|function|class|api|debug|error|fix|refactor|component|module|library)\b/.test(lower)) return 'coding';
  if (/\b(build|create|make|generate|write|scaffold|bootstrap)\b/.test(lower)) return 'building';
  if (/\b(explain|what|how|why|tell|describe|define|meaning|difference)\b/.test(lower)) return 'learning';
  if (/\b(deploy|push|publish|release|ship|launch)\b/.test(lower)) return 'deployment';
  if (/\b(test|check|verify|validate|assert|spec)\b/.test(lower)) return 'testing';
  if (/\b(search|find|look|browse|navigate|go to)\b/.test(lower)) return 'research';
  if (/\b(run|execute|start|stop|restart|command|terminal)\b/.test(lower)) return 'command';
  if (/\b(hi|hello|hey|thanks|bye|goodbye)\b/.test(lower)) return 'conversation';
  return 'general';
}
