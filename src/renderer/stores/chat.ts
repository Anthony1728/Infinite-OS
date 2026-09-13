import { create } from 'zustand';
import type { ContentBlock, Message, Session } from '../../shared/types';
import { useBrainStore } from './brain';
import { useEditorStore } from './editor';
import { useAgentsStore } from './agents';
import {
  brainTeachingUnavailableMessage,
  buildBrainTeachingContext,
  formatBrainTeachingResult,
  parseBrainTeachingCommand,
  type BrainTeachingStatus,
} from '../lib/brainTeaching';

// Each conversation can keep working in the background, so watchdogs must be
// keyed by session rather than sharing one global timer.
// Reduced from 150s to 90s — if no tool/provider activity for 90s, the run
// is stuck and should fall back to the offline brain. Users rarely wait >60s.
const SAFETY_INACTIVITY_TIMEOUT_MS = 90_000;
const pendingSafetyTimers = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; onTimeout: () => void | Promise<void>; ms: number }
>();
// A watchdog abort is reported back by the main process as a stream error.
// Track those sessions so the expected abort cannot render a second message.
const safetyFallbackSessions = new Set<string>();
// Fire-and-forget session appends are the classic vanishing-message race:
// a transcript reload that lands before the writes commit drops just-sent
// messages. Every append registers here; reloads flush first.
const pendingPersists = new Set<Promise<unknown>>();
function persistSessionMessage(sessionId: string, message: Message): void {
  const pending = window.api.appendSessionMessage({ sessionId, message }).catch(() => undefined);
  pendingPersists.add(pending);
  void pending.finally(() => pendingPersists.delete(pending));
}
async function flushPersists(): Promise<void> {
  if (pendingPersists.size === 0) return;
  await Promise.allSettled([...pendingPersists]);
}
const activeChatTaskBySession = new Map<string, string>();
const chatTaskByOrchestrator = new Map<string, string>();
const orchestratorBySession = new Map<string, string>();
const filesByChatTask = new Map<string, string[]>();
const selectedAgentRuns = new Map<
  string,
  {
    sessionId: string;
    chatTaskId: string;
    activityId: string;
    agentName: string;
    preview: string;
    /** Live transcript message ids streamed for this run (unified streaming). */
    liveMessageIds: string[];
    /** Tool activity row ids (toolUseId) created for this run. */
    liveToolUseIds: string[];
  }
>();
let activeTeachingChatSessionId: string | null = null;

/** Live pair-panel message per crew run (both models streaming, one narrative). Not persisted — the final transcript replaces it. */
const pairPanelByRun = new Map<string, string>();

type PairSectionBlock = {
  type: 'pair';
  memberId: string;
  role: string;
  provider: string;
  model: string;
  text: string;
  status: 'running' | 'done' | 'error';
};

function upsertPairSection(runId: string, section: PairSectionBlock, appendText?: string): void {
  const state = useChatStore.getState();
  const msgId = pairPanelByRun.get(runId);
  const existing = msgId ? state.messages.find((m) => m.id === msgId) : undefined;
  if (!existing) {
    const msg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: [section],
      timestamp: Date.now(),
    } as unknown as Message;
    pairPanelByRun.set(runId, msg.id);
    useChatStore.setState((s) => ({ messages: [...s.messages, msg], streaming: true }));
    return;
  }
  useChatStore.setState((s) => ({
    messages: s.messages.map((m) => {
      if (m.id !== msgId) return m;
      const blocks = m.content as unknown as PairSectionBlock[];
      const idx = blocks.findIndex((b) => b.type === 'pair' && b.memberId === section.memberId);
      if (idx < 0) return { ...m, content: [...(m.content as unknown[]), section] as Message['content'] };
      const next = [...blocks];
      const prev = next[idx];
      // Empty-string fields never clobber (delta/completion events often
      // carry only the fields that changed).
      const patch = Object.fromEntries(
        Object.entries(section).filter(([, v]) => v !== ''),
      ) as Partial<PairSectionBlock>;
      next[idx] = appendText !== undefined
        ? { ...prev, status: section.status, text: `${prev.text}${appendText}` }
        : { ...prev, ...patch };
      return { ...m, content: next as unknown as Message['content'] };
    }),
    streaming: true,
  }));
}

/** What the user currently has selected (provider/model), for error context. Never throws. */
function currentSelectionLabel(): string | null {
  try {
    const raw = localStorage.getItem('infinite:current');
    if (!raw) return null;
    const cur = JSON.parse(raw) as { provider?: unknown; model?: unknown; modelLabel?: unknown };
    const provider = typeof cur.provider === 'string' && cur.provider ? cur.provider : null;
    const model = typeof cur.modelLabel === 'string' && cur.modelLabel
      ? cur.modelLabel
      : typeof cur.model === 'string' && cur.model ? cur.model : null;
    if (!provider && !model) return null;
    return [provider, model].filter(Boolean).join(' / ');
  } catch {
    return null;
  }
}

function clearSafetyTimer(sessionId: string): void {
  const watchdog = pendingSafetyTimers.get(sessionId);
  if (watchdog) clearTimeout(watchdog.timer);
  pendingSafetyTimers.delete(sessionId);
}

function armSafetyTimer(sessionId: string, onTimeout: () => void | Promise<void>, ms = SAFETY_INACTIVITY_TIMEOUT_MS): void {
  clearSafetyTimer(sessionId);
  const timer = setTimeout(() => {
    pendingSafetyTimers.delete(sessionId);
    void Promise.resolve(onTimeout()).catch((error) => {
      console.error('[chat] Safety fallback failed:', error);
    });
  }, ms);
  pendingSafetyTimers.set(sessionId, { timer, onTimeout, ms });
}

function touchSafetyTimer(sessionId: string): void {
  const watchdog = pendingSafetyTimers.get(sessionId);
  if (watchdog) armSafetyTimer(sessionId, watchdog.onTimeout, watchdog.ms);
}

function clearAllSafetyTimers(): void {
  for (const watchdog of pendingSafetyTimers.values()) clearTimeout(watchdog.timer);
  pendingSafetyTimers.clear();
}

export type StreamEvent =
  | { type: 'welcome'; agentName: string; role: string; model?: string; message: string }
  | { type: 'message_start'; message_id: string }
  | { type: 'message_discard'; message_id: string }
  | { type: 'text_delta'; message_id: string; text: string }
  | { type: 'tool_use_start'; message_id: string; tool_use_id: string; name: string }
  | { type: 'tool_use_delta'; tool_use_id: string; partial_json: string }
  | { type: 'tool_use_end'; message_id: string; tool_use_id: string; name: string; input: unknown }
  | {
      type: 'tool_progress';
      tool_use_id: string;
      name: string;
      status: 'running' | 'completed' | 'error';
      input?: unknown;
      detail?: string;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content?: string | ContentBlock[];
      is_error?: boolean;
      partial?: boolean;
    }
  | {
      type: 'provider_start';
      message_id: string;
      provider: string;
      model: string;
      requested_provider: string;
      requested_model: string;
      turn: number;
    }
  | {
      type: 'provider_status';
      status: 'connecting' | 'streaming' | 'failover' | 'cold_start' | 'rate_limited' | 'retrying';
      provider?: string;
      model?: string;
      from?: string;
      to?: string;
      reason?: string;
    }
  | { type: 'message_end'; message_id: string; stop_reason: string; usage?: { input: number; output: number } }
  | { type: 'error'; error: string }
  | { type: 'fallback_required'; error?: string }
  | { type: 'done'; success?: boolean; reason?: string };

export interface ActivityItem {
  id: string;
  toolUseId: string;
  name: string;
  label: string;
  detail: string;
  category: string;
  status: 'running' | 'done' | 'error';
  timestamp: number;
}

export interface BrainTeachingLiveState extends BrainTeachingStatus {
  chatSessionId: string | null;
}

export type ChatExecutionMode = 'chat' | 'agent' | 'research' | 'code' | 'build' | 'plan';

export function isModelIdentityQuestion(text: string): boolean {
  const request = text.trim().toLowerCase().replace(/[?!.,]+$/g, '');
  return (
    /\b(what|which)\s+(ai\s+)?model\s+(are you|is this|is infinite os)\s+(using|running|on)\b/.test(request) ||
    /\bwhat\s+model\s+are\s+you\b/.test(request) ||
    /\bshow\s+(me\s+)?(the\s+)?(current|active|selected)\s+model\b/.test(request)
  );
}

export function formatRuntimeIdentity(provider: string, model: string, label?: string): string {
  const providerLabel = provider === 'ollama'
    ? 'Ollama'
    : provider === 'opencode'
      ? 'OpenCode Zen'
      : provider
          .split(/[-_]/)
          .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
          .join(' ');
  const modelLabel = label?.trim() || model || 'the provider default';
  const modelId = model && model !== modelLabel ? ` (\`${model}\`)` : '';
  return `This chat is currently configured to use **${modelLabel}**${modelId} through **${providerLabel}**. I read that from Infinite OS's live runtime settings, so I won't guess or claim a different model. If automatic failover is needed, the model shown on that response will identify the provider that actually answered.`;
}

export function inferExecutionMode(text: string): ChatExecutionMode {
  const request = text.trim().toLowerCase();
  if (!request) return 'chat';

  const conversational =
    /^(hi|hello|hey|good\s+(morning|afternoon|evening)|how are you|thank(s| you)|what do you think|can we (chat|talk)|let'?s (chat|talk)|tell me about)\b/.test(
      request,
    );
  const actionVerb =
    /\b(build|create|make|design|develop|implement|add|change|edit|fix|debug|refactor|test|run|deploy|publish|open|launch|browse|search|research|investigate|analy[sz]e|write|save|send|automate|control|install|remove)\b/.test(
      request,
    );
  if (conversational && !actionVerb) return 'chat';

  if (
    /\b(research|investigate|compare sources|current sources|latest|fact[- ]check|market research|deep dive|literature review)\b/.test(
      request,
    )
  ) {
    return 'research';
  }
  if (
    /\b(build|create|make|design|develop|generate)\b/.test(request) &&
    /\b(app|application|website|web ?page|dashboard|saas|game|tool|product|project|system|prototype|landing page|portfolio|presentation|document|image|video)\b/.test(
      request,
    )
  ) {
    return 'build';
  }
  if (
    /\b(code|codebase|repository|repo|source|component|function|class|api|typescript|javascript|python|css|html|bug|debug|refactor|test|typecheck|lint)\b/.test(
      request,
    ) ||
    (/\b(implement|add|change|edit|fix)\b/.test(request) &&
      /\b(feature|file|logic|frontend|backend|database|endpoint|ui|button|screen)\b/.test(request))
  ) {
    return 'code';
  }
  if (
    /\b(open|launch|browse|click|type|press|run|execute|deploy|publish|send|install|remove|rename|move|automate|control|agent|delegate)\b/.test(
      request,
    )
  ) {
    return 'agent';
  }
  return 'chat';
}

export function requiresOrchestration(text: string): boolean {
  return (
    text.length > 200 ||
    (/\b(build|create|make|develop|deploy|full|complete|entire|whole)\b/i.test(text) &&
      /\b(website|app|application|dashboard|saas|project|system)\b/i.test(text))
  );
}

function promptForExecutionMode(text: string, mode: ChatExecutionMode): string {
  const request = text.trim();
  switch (mode) {
    case 'agent':
      return `Agent mode is active. Take ownership of the request: inspect what is available, make a short plan, use the necessary tools, continue through recoverable problems, and verify the result before replying.\n\nUser request:\n${request}`;
    case 'research':
      return `Deep Research mode is active. Investigate the request thoroughly using current, reliable sources when online access is available. Compare important viewpoints, distinguish verified facts from conclusions, include direct source links, and end with a clear synthesis.\n\nResearch request:\n${request}`;
    case 'code':
      return `Code mode is active. Treat this as a software task. Inspect the relevant workspace files, implement or explain the smallest solid solution, preserve unrelated work, run proportionate validation, and report the files and checks involved.\n\nCoding request:\n${request}`;
    case 'build':
      return `Build mode is active. Produce a complete working outcome, not only suggestions. Use the app-building and workspace tools where useful, connect the required functionality, test the result, and keep iterating through recoverable failures until it works.\n\nBuild request:\n${request}`;
    case 'plan':
      return `Plan mode is active. You are READ-ONLY. Do not modify any files, run state-changing commands, or reach approvals. Inspect the relevant workspace, files, and context thoroughly, then respond with a concise step-by-step implementation plan broken into phases: (1) what exists and the gap, (2) the exact steps/commands/tools that would be needed, (3) files or systems each step touches, (4) how the result will be verified. End with a one-line "Ready to execute" summary. Never make changes in plan mode.\n\nPlan request:\n${request}`;
    default:
      return request;
  }
}

// Builds a user message's content blocks, attaching any base64 image blocks
// the composer collected (paste / drag-drop / file picker) alongside the text.
function withImages(text: string, images?: ContentBlock[]): ContentBlock[] {
  return images && images.length > 0
    ? [{ type: 'text', text }, ...images]
    : [{ type: 'text', text }];
}

// Turn a tool name + input into a CLI-grade, Claude-style label.
// Goals: explain what the AI is doing in 4-7 words + precise target, so the
// LiveActivityFeed reads like "Bash: npm run build" not "Running a command".
function summarizeTool(name: string, input: unknown): { label: string; detail: string; category: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const n = name.toLowerCase();
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
  const short = (s: string, m = 80) => (s.length > m ? `${s.slice(0, m)}…` : s);
  const path = short(str(i.path ?? i.file_path ?? i.file ?? i.filename ?? ''));
  const pattern = short(str(i.pattern ?? i.glob ?? ''));
  const query = short(str(i.query ?? i.prompt ?? i.text ?? ''));
  const cmd = short(str(i.command ?? i.cmd ?? i.script ?? i.code ?? ''), 100);

  // High-signal exact matches first (like Claude)
  if (n === 'bash' || n === 'read' || n === 'write' || n === 'edit' || n === 'glob' || n === 'grep' || n === 'websearch' || n === 'webfetch') {
    if (n === 'bash') return { label: cmd ? `Bash: ${cmd}` : 'Bash', detail: cmd, category: 'shell' };
    if (n === 'read') return { label: path ? `Read ${path}` : 'Read', detail: path || query, category: 'file' };
    if (n === 'write') return { label: path ? `Write ${path}` : 'Write', detail: path || short(str(i.content ?? ''), 120), category: 'file' };
    if (n === 'edit') return { label: path ? `Edit ${path}` : 'Edit', detail: path || short(str(i.old_string ?? i.oldString ?? ''), 80), category: 'file' };
    if (n === 'glob') return { label: pattern ? `Glob ${pattern}` : 'Glob', detail: pattern || path, category: 'file' };
    if (n === 'grep') return { label: query ? `Grep "${query}"` : 'Grep', detail: query || pattern, category: 'file' };
    if (n === 'websearch') return { label: query ? `Web search: "${query}"` : 'Web search', detail: query, category: 'web' };
    if (n === 'webfetch') return { label: short(str(i.url ?? '')) ? `Fetch ${short(str(i.url ?? ''))}` : 'Fetch', detail: short(str(i.url ?? '')), category: 'web' };
  }
  // Hermes-beating new tools
  if (n === 'messaging') return { label: `Messaging → ${short(str(i.action ?? ''))}`, detail: short(str(i.text ?? '')), category: 'web' };
  if (n === 'imagegenerator') return { label: query ? `Generate image: "${query}"` : 'Generate image', detail: short(str(i.prompt ?? query)), category: 'tool' };
  if (n === 'device') return { label: `Device ${short(str(i.action ?? ''))}${i.device ? `: ${short(str(i.device))}` : ''}`, detail: short(str(i.url ?? i.payload ?? '')), category: 'computer' };
  if (n === 'vision') return { label: i.imagePath ? `Vision: ${short(str(i.imagePath))}` : `Vision ${short(str(i.action ?? ''))}`, detail: short(str(i.prompt ?? '')), category: 'tool' };
  if (n === 'sandbox') return { label: cmd ? `Sandbox: ${cmd}` : 'Sandbox', detail: cmd, category: 'shell' };
  if (n === 'batch') {
    const len = Array.isArray(i.calls) ? (i.calls as unknown[]).length : 0;
    return { label: len ? `Batch: ${len} tools in parallel` : 'Batch', detail: len ? `${len} calls` : '', category: 'agent' };
  }
  if (/(shell|bash|exec|terminal|command|run_command|process|powershell)/.test(n)) {
    return { label: cmd ? `Bash: ${cmd}` : 'Bash', detail: cmd, category: 'shell' };
  }
  if (/(browser|navigate|fill_form|scrape|crawl|url|operator)/.test(n)) {
    const action = short(str(i.action ?? ''));
    const target = short(str(i.url ?? i.selector ?? i.text ?? ''));
    return { label: action ? `Browser: ${action}` : 'Browser', detail: target, category: 'browser' };
  }
  if (/(computer|desktop|mouse|keyboard|screen|press_key|type_text|click|scroll|screenshot)/.test(n)) {
    const action = short(str(i.action ?? i.action_type ?? ''));
    const target = short(str(i.text ?? i.key ?? i.selector ?? i.application ?? i.app ?? ''));
    return { label: action ? `Computer: ${action}` : 'Computer', detail: target, category: 'computer' };
  }
  if (/(read|write|edit|save|create|glob|grep|file)/.test(n)) {
    return { label: path ? `${name} ${path}` : name, detail: path || pattern || query, category: 'file' };
  }
  if (/(memory|knowledge|recall|remember|brain|learn)/.test(n)) {
    return { label: `Memory: ${short(str(i.query ?? i.topic ?? name))}`, detail: short(str(i.query ?? i.topic ?? '')), category: 'memory' };
  }
  if (/(agent|orchestrat|subagent|spawn|crew|batch)/.test(n)) {
    return { label: `Agent: ${short(str(i.task ?? i.goal ?? name))}`, detail: short(str(i.task ?? i.goal ?? i.instruction ?? '')), category: 'agent' };
  }
  const detail = short(str(i.prompt ?? i.input ?? i.query ?? i.task ?? i.goal ?? ''));
  return { label: short(name), detail, category: 'tool' };
}

interface ChatState {
  sessions: Session[];
  currentSessionId: string | null;
  messages: Message[];
  streaming: boolean;
  loadingSession: boolean;
  activity: ActivityItem[];
  pendingPermission: { id: string; tool: string; input: unknown } | null;
  orchestratedTaskId: string | null;
  orchestratorEvents: unknown[];
  // Real-time status from the main process (e.g. "Connecting to OpenRouter…")
  // so the Thinking bubble can reflect what's actually happening instead of
  // showing a static "Reasoning through your request…" until the first token.
  providerStatus: {
    label: string;
    detail: string;
    receivedAt: number;
  } | null;
  brainTeaching: BrainTeachingLiveState | null;

  initStreamListener: () => void;
  loadSessions: () => Promise<void>;
  clearAllSessions: () => Promise<void>;
  createSession: (cwd: string, model: string, provider: string) => Promise<Session>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  pinSession: (id: string, pinned: boolean) => Promise<void>;
  searchSessions: (query: string) => Promise<void>;
  branchSession: (id: string, messageId?: string) => Promise<void>;
  exportSession: (id: string, format?: 'markdown' | 'json') => Promise<void>;
  importSession: (content: string, format: 'markdown' | 'json') => Promise<Session>;
  shareSession: (id: string) => Promise<{ ok: boolean; length?: number }>;
  updateMessage: (messageId: string, text: string) => Promise<void>;
  announceUncensoredMode: () => Promise<void>;
  sendMessage: (text: string, images?: ContentBlock[], mode?: ChatExecutionMode, agentId?: string) => Promise<void>;
  abort: () => Promise<void>;
  respondPermission: (allowed: boolean) => Promise<void>;
  isSessionStreaming: (id: string) => boolean;
  interject: (message: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  streaming: false,
  loadingSession: false,
  activity: [],
  pendingPermission: null,
  orchestratedTaskId: null,
  orchestratorEvents: [],
  providerStatus: null,
  brainTeaching: null,

  initStreamListener: () => {
    const win = window as { __streamListenerAttached?: boolean };
    if (win.__streamListenerAttached) return;
    win.__streamListenerAttached = true;

    window.api.onStreamEvent((payload: unknown) => {
      const ev = payload as { sessionId: string } & StreamEvent;
      // Ignore late events from a run deliberately aborted by our watchdog.
      // A future send clears this marker before it starts a new run.
      if (safetyFallbackSessions.has(ev.sessionId)) return;
      // Provider status, tokens, and tool events all prove the run is alive.
      touchSafetyTimer(ev.sessionId);
      if (ev.sessionId !== get().currentSessionId) {
        // A task keeps running when the user opens another conversation. Its
        // right-panel status must still reach a truthful terminal state.
        const chatTaskId = activeChatTaskBySession.get(ev.sessionId);
        if (ev.type === 'done' || ev.type === 'error') clearSafetyTimer(ev.sessionId);
        if (chatTaskId && ev.type === 'done') {
          if (ev.success === false) {
            useAgentsStore.getState().failChatTask(chatTaskId, ev.reason || 'The task ended without verified success.');
          } else {
            useAgentsStore.getState().completeChatTask(chatTaskId, filesByChatTask.get(chatTaskId));
          }
          filesByChatTask.delete(chatTaskId);
          activeChatTaskBySession.delete(ev.sessionId);
        } else if (chatTaskId && ev.type === 'error') {
          useAgentsStore.getState().failChatTask(chatTaskId, ev.error);
          filesByChatTask.delete(chatTaskId);
          activeChatTaskBySession.delete(ev.sessionId);
        }
        return;
      }
      handleStreamEvent(ev).catch((e) => console.error('[chat] handleStreamEvent error:', e));
    });

    window.api.onAgentEvent(async (payload: unknown) => {
      const event = payload as {
        type:
          | 'start'
          | 'welcome'
          | 'text_delta'
          | 'tool_call'
          | 'complete'
          | 'fail'
          | 'retrying'
          | 'message_start'
          | 'provider_start'
          | 'tool_use_start'
          | 'tool_use_end'
          | 'tool_progress'
          | 'tool_result'
          | 'provider_status'
          | 'message_end'
          | 'message_discard';
        runId?: string;
        text?: string;
        toolName?: string;
        result?: string;
        error?: string;
        message_id?: string;
        provider?: string;
        model?: string;
        turn?: number;
        tool_use_id?: string;
        name?: string;
        input?: unknown;
        status?: string;
        detail?: string;
        content?: unknown;
        is_error?: boolean;
        partial?: boolean;
        from?: string;
        to?: string;
        reason?: string;
        stop_reason?: Message['stop_reason'];
        usage?: unknown;
        attempt?: number;
        agentName?: string;
        role?: string;
        message?: string;
      };
      if (!event.runId) return;
      const context = selectedAgentRuns.get(event.runId);
      if (!context) return;

      // Welcome event — activity row only, never a canned bubble. The first
      // visible output must be the agent's own live stream, not "X ready".
      if (event.type === 'welcome' && event.message) {
        if (context.sessionId === get().currentSessionId && event.agentName) {
          const wName = event.agentName;
          set((state) => ({
            activity: state.activity.map((item) =>
              item.name === wName && item.status === 'running'
                ? { ...item, detail: event.role || item.detail }
                : item,
            ),
          }));
        }
        return;
      }

      // Legacy preview updates for activity feed row
      if (event.type === 'text_delta') {
        context.preview = `${context.preview}${event.text ?? ''}`.slice(-500);
        if (context.sessionId === get().currentSessionId) {
          set((state) => ({
            activity: state.activity.map((item) =>
              item.id === context.activityId
                ? { ...item, label: `${context.agentName} is working`, detail: context.preview }
                : item,
            ),
          }));
        }
        // Fall through — also render into the transcript via the unified pipeline
      }

      if (event.type === 'tool_call') {
        if (context.sessionId === get().currentSessionId) {
          set((state) => ({
            activity: state.activity.map((item) =>
              item.id === context.activityId
                ? {
                    ...item,
                    label: `${context.agentName} is executing`,
                    detail: event.toolName ? `Using ${event.toolName}` : context.preview,
                  }
                : item,
            ),
          }));
        }
        return;
      }

      if (event.type !== 'complete' && event.type !== 'fail') {
        // Route EVERY streaming event through the same handleStreamEvent
        // pipeline that the automatic agent uses — identical transcript,
        // tool cards, provider status, tab creation, file extraction, etc.

        // Populate live tracking arrays so finalization knows what was streamed
        if (event.type === 'message_start' && typeof event.message_id === 'string') {
          if (!context.liveMessageIds.includes(event.message_id)) {
            context.liveMessageIds.push(event.message_id);
          }
        }
        if ((event.type === 'tool_use_start' || event.type === 'tool_use_end') && typeof event.tool_use_id === 'string') {
          if (!context.liveToolUseIds.includes(event.tool_use_id)) {
            context.liveToolUseIds.push(event.tool_use_id);
          }
        }

        const liveId = context.liveMessageIds.length
          ? context.liveMessageIds[context.liveMessageIds.length - 1]
          : undefined;
        // Adapt agent-event shape to the stream-event shape handleStreamEvent expects
        const adapted: Record<string, unknown> = { ...event, sessionId: context.sessionId };
        if (!adapted.message_id && liveId) adapted.message_id = liveId;
        void handleStreamEvent(adapted as { sessionId: string } & StreamEvent, {
          sessionId: context.sessionId,
        }).catch((err) => console.error('[chat] handleStreamEvent error:', err));
        return;
      }
      selectedAgentRuns.delete(event.runId);
      clearSafetyTimer(context.sessionId);
      activeChatTaskBySession.delete(context.sessionId);

      const successful = event.type === 'complete';
      let responseText = successful
        ? event.result?.trim() || `${context.agentName} completed the task.`
        : `**${context.agentName} could not complete the task.**\n\n${event.error || 'Unknown agent error.'}`;
      const isBillingError = !successful && /credits?error|insufficient balance|credits? exhausted|billing|402|401.*opencode/i.test(event.error || '');
      const isUsageLimitError = !successful && /429|usage limit|rate limit|GoUsageLimitError|too many requests|quota/i.test(event.error || '');
      const isVerifiedFail = !successful && /stopped before verified|reached the .* safety limit|did not produce a verified result|reached the .*turn safety/i.test(event.error || '');
      if (isBillingError) {
        const billingUrl = (event.error?.match(/https:\/\/opencode\.ai[^\s"']+/)?.[0]) ?? 'https://opencode.ai/billing';
        responseText = `**OpenCode credits exhausted (401).**\n\n${event.error}\n\n**Fix now:**\n• Top up: ${billingUrl}\n• Or switch model: **Settings → AI Provider** → pick **nvidia / meta/llama-3.3-70b-instruct** (free), **Groq**, or any provider with a valid key — then retry.\n• The **Infinite AI Brain** is still available locally and will answer without credits (see next message).`;
      } else if (isUsageLimitError) {
        const resetMatch = event.error?.match(/Resets? in (\d+) days?/i);
        const resetInfo = resetMatch ? `\n\nResets in **${resetMatch[1]} days**.` : '';
        const balanceUrl = (event.error?.match(/https:\/\/opencode\.ai[^\s"']+/)?.[0]) ?? 'https://opencode.ai/workspace';
        responseText = `**Monthly usage limit reached (429).**${resetInfo}\n\n**Fix now:**\n• Enable from balance: ${balanceUrl}\n• Or switch model: **Settings → AI Provider** → pick **nvidia / meta/llama-3.3-70b-instruct** (free), **Groq**, **Gemini**, or any provider with available quota — then retry.\n• The **Infinite AI Brain** (local model) is always available and has no usage limits.`;
      } else if (isVerifiedFail) {
        responseText = `**${context.agentName} had trouble verifying the task.**\n\n${event.error}\n\nThe task needed a tool call, but the model returned text only. Infinite OS will still help — see the Brain's answer next. If this repeats, try **Model: nvidia / meta/llama-3.3-70b-instruct** (best tool use) or rephrase to be more explicit (e.g. "Use Bash to...").`;
      }
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: responseText }],
        timestamp: Date.now(),
      };

      if (successful) useAgentsStore.getState().completeChatTask(context.chatTaskId);
      else useAgentsStore.getState().failChatTask(context.chatTaskId, event.error);

      // The streamed turns ARE the transcript: finalize them in place instead
      // of appending a duplicate result message. Only runs that never
      // streamed (background runs, session switches) get the legacy append.
      const liveIds = [...context.liveMessageIds];
      const liveToolIds = new Set(context.liveToolUseIds);
      context.liveMessageIds.length = 0;
      context.liveToolUseIds.length = 0;
      const finalizeStatus = successful ? ('done' as const) : ('error' as const);
      if (context.sessionId === get().currentSessionId) {
        set((state) => {
          const liveSet = new Set(liveIds);
          const hasLive = state.messages.some((m) => liveSet.has(m.id));
          return {
            streaming: false,
            // Success with streamed turns: they ARE the transcript, finalize
            // in place. Failures always append the error message; runs that
            // never streamed append the legacy result message.
            messages: hasLive && successful ? state.messages : [...state.messages, assistantMessage],
            activity: state.activity.map((item) =>
              item.id === context.activityId
                ? {
                    ...item,
                    status: finalizeStatus,
                    label: successful ? `${context.agentName} completed the task` : `${context.agentName} failed`,
                    detail: successful ? responseText.slice(0, 500) : event.error || 'Unknown agent error.',
                  }
                : item.toolUseId && liveToolIds.has(item.toolUseId) && item.status === 'running'
                  ? { ...item, status: finalizeStatus }
                  : item,
            ),
          };
        });
      }
      // Persist the streamed turns in order. Failures additionally keep the
      // legacy error message so the reason stays in the transcript.
      {
        const st = get();
        const liveMsgs = liveIds
          .map((id) => st.messages.find((m) => m.id === id))
          .filter((m): m is Message => Boolean(m));
        if (liveMsgs.length) {
          for (const m of liveMsgs) {
            persistSessionMessage(context.sessionId, m);
          }
        }
        if (!successful || !liveMsgs.length) {
          persistSessionMessage(context.sessionId, assistantMessage);
        }
      }
      if (isBillingError || isVerifiedFail) {
        try {
          const curMsgs = get().messages;
          const lastUser = [...curMsgs].reverse().find((m) => m.role === 'user');
          const userText = lastUser ? textFromMessage(lastUser) : '';
          const brainText = userText ? await useBrainStore.getState().generateOfflineResponse(userText) : isBillingError ? 'Infinite AI Brain is ready. Fix your credits or switch provider and retry — I can still help locally.' : 'Infinite AI Brain is ready with a local answer while the agent recovers. Try a more explicit tool request if needed.';
          const tried = currentSelectionLabel();
          const brainMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: [{ type: 'text', text: `🧠 **Infinite AI Brain (offline, no credits needed):**${tried ? `\n_${tried} didn't answer, so here's the local brain instead._` : ''}\n\n${brainText}` }], timestamp: Date.now(), provider: 'offline-brain', model: 'local-recovery' };
          if (context.sessionId === get().currentSessionId) set((s) => ({ messages: [...s.messages, brainMsg] }));
          persistSessionMessage(context.sessionId, brainMsg);
        } catch { /* ignore */ }
      }
    });

    window.api.onPermissionRequest((req: { id: string; tool: string; input: unknown }) =>
      set({ pendingPermission: req }),
    );

    window.api.onBrainTeachEvent((payload: unknown) => {
      const event = payload as {
        type: 'started' | 'progress' | 'lesson' | 'recovering' | 'completed' | 'stopped';
        status: BrainTeachingLiveState;
        lesson?: { title?: string };
      };
      if (event.type === 'started') return;
      const targetSessionId = activeTeachingChatSessionId;
      const learned = event.status.lessonsCompleted ?? event.status.lessonsAdded ?? 0;
      const complete = event.type === 'completed' || event.type === 'stopped';
      const shouldPost = complete || (event.type === 'lesson' && (learned === 1 || learned % 5 === 0));
      const activity: ActivityItem = {
        id: 'brain-teaching-live',
        toolUseId: 'brain-teaching-live',
        name: 'Brain learning',
        label: complete ? 'Brain learning complete' : event.type === 'lesson' ? `Lesson saved ┬╖ ${learned}` : 'Researching and learning',
        detail: event.lesson?.title ?? event.status.currentTopic ?? event.status.message ?? '',
        category: 'memory',
        status: complete ? 'done' : 'running',
        timestamp: Date.now(),
      };
      set((state) => ({
        activity: [...state.activity.filter((item) => item.id !== activity.id), activity],
        brainTeaching: { ...event.status, chatSessionId: targetSessionId },
      }));
      if (!shouldPost || !targetSessionId) {
        if (complete) activeTeachingChatSessionId = null;
        return;
      }
      const message: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{
          type: 'text',
          text: complete
            ? `**Brain learning complete.** ${learned} verified lesson${learned === 1 ? '' : 's'} saved and ready for future requests.`
            : `**Brain learning progress:** ${learned} lesson${learned === 1 ? '' : 's'} saved${event.lesson?.title ? ` ┬╖ ${event.lesson.title}` : ''}.`,
        }],
        timestamp: Date.now(),
      };
      if (targetSessionId === get().currentSessionId) set((state) => ({ messages: [...state.messages, message] }));
      persistSessionMessage(targetSessionId, message);
      if (complete) activeTeachingChatSessionId = null;
    });

    window.api.onCrewEvent(async (payload: unknown) => {
      const ev = payload as { sessionId?: string; type?: string; data?: { summary?: string } };
      if (!ev || typeof ev.sessionId !== 'string' || typeof ev.type !== 'string') return;
      const { sessionId } = ev;
      const chatTaskId = activeChatTaskBySession.get(sessionId);
      const terminal = ev.type === 'crew_completed' || ev.type === 'crew_failed';
      if (terminal) pairPanelByRun.delete((ev as { runId?: string }).runId ?? sessionId);
      if (!terminal) {
        // Progress: keep the run visibly alive in the composer status.
        if (sessionId === get().currentSessionId) {
          const data = (ev as { data?: {
            id?: string; role?: string; memberId?: string; text?: string;
            assignment?: { provider?: string; model?: string };
          } }).data;
          const runId = (ev as { runId?: string }).runId ?? sessionId;
          const shortModel = (m?: string) => m?.split('/').pop()?.replace(/:free$/, '') ?? '';
          if (ev.type === 'crew_member_started' && data) {
            // One model narrates: name WHO is working so the pair story reads.
            const provider = data.assignment?.provider ?? '';
            const model = data.assignment?.model ?? '';
            upsertPairSection(runId, {
              type: 'pair',
              memberId: data.id ?? runId,
              role: data.role ?? 'Specialist',
              provider, model, text: '', status: 'running',
            });
          } else if (ev.type === 'crew_member_delta' && data?.memberId && typeof data.text === 'string') {
            upsertPairSection(runId, {
              type: 'pair',
              memberId: data.memberId,
              role: '', provider: '', model: '', text: '', status: 'running',
            }, data.text);
          } else if ((ev.type === 'crew_member_completed' || ev.type === 'crew_member_failed') && data) {
            const memberId = data.memberId ?? data.id ?? runId;
            upsertPairSection(runId, {
              type: 'pair',
              memberId,
              role: data.role ?? '',
              provider: data.assignment?.provider ?? '',
              model: data.assignment?.model ?? '',
              text: '',
              status: ev.type === 'crew_member_failed' ? 'error' : 'done',
            });
          } else if (ev.type === 'crew_member_retrying' && data?.memberId) {
            upsertPairSection(runId, {
              type: 'pair',
              memberId: data.memberId,
              role: '', provider: '', model: '', text: '', status: 'running',
            });
          }
          const memberLabel = data?.role && (data.assignment?.provider || data.assignment?.model)
            ? `${data.role} · ${shortModel(data.assignment?.model)} working…`
            : undefined;
          const detail =
            memberLabel && (ev.type === 'crew_member_started' || ev.type === 'crew_member_retrying') ? memberLabel
            : ev.type === 'crew_member_started' ? 'Crew specialist working…'
            : ev.type === 'leader_started' ? 'Crew leader integrating…'
            : ev.type === 'crew_planned' ? 'Crew planned — specialists deploying…'
            : 'Crew working…';
          set((state) => ({
            providerStatus: state.providerStatus
              ? { ...state.providerStatus, detail, receivedAt: Date.now() }
              : state.providerStatus,
          }));
        }
        return;
      }
      clearSafetyTimer(sessionId);
      activeChatTaskBySession.delete(sessionId);
      const ok = ev.type === 'crew_completed';
      if (chatTaskId) {
        if (ok) useAgentsStore.getState().completeChatTask(chatTaskId);
        else useAgentsStore.getState().failChatTask(chatTaskId, ev.data?.summary ?? 'Crew run failed.');
      }
      if (!ok) {
        const errMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: `**Crew run failed.**\n\n${ev.data?.summary ?? 'Unknown crew error.'}\n\n**Try:** a different paired model, or turn **Pair model** off for a single-model run.` }],
          timestamp: Date.now(),
        };
        persistSessionMessage(sessionId, errMsg);
        if (sessionId === get().currentSessionId) {
          set((state) => ({ messages: [...state.messages, errMsg], streaming: false }));
          return;
        }
      }
      // Main persisted the final answer — flush our appends first, then reload
      // the transcript. Merge, never blind-replace: anything shown on screen
      // during the run (live member turns main never persisted) must survive
      // even if it never reached disk; rescued messages are re-persisted so
      // the next reload keeps them too.
      try {
        await flushPersists();
        const loaded = (await window.api.loadSession({ sessionId })) as Message[];
        if (sessionId === get().currentSessionId) {
          const current = get().messages;
          const seen = new Set(loaded.map((m) => m.id));
          const missing = current.filter((m) => !seen.has(m.id));
          for (const m of missing) persistSessionMessage(sessionId, m);
          set({ messages: missing.length ? [...loaded, ...missing] : loaded, streaming: false });
        }
      } catch {
        if (sessionId === get().currentSessionId) set({ streaming: false });
      }
    });

    window.api.onOrchestratorEvent(async (payload: unknown) => {
      const ev = payload as { sessionId: string; taskId: string; type: string; data: unknown };
      const isCurrentSession = ev.sessionId === get().currentSessionId;

      const agentStore = useAgentsStore.getState();

      if (ev.type === 'subtask_deployed') {
        const data = ev.data as { subTaskId: string; agentType: string; description: string };
        if (!data.subTaskId || !data.agentType || !data.description) return;
        agentStore.addSubTask(ev.taskId, data.subTaskId, data.agentType, data.description);
        subtaskProgressById.set(data.subTaskId, { description: data.description, preview: '', toolIds: [] });
        if (isCurrentSession) {
          set((state) => ({
            activity: [
              ...state.activity.filter((item) => item.id !== `subtask-${data.subTaskId}`),
              {
                id: `subtask-${data.subTaskId}`,
                toolUseId: data.subTaskId,
                name: data.agentType,
                label: `${data.agentType} agent is working`,
                detail: data.description,
                category: 'agent',
                status: 'running',
                timestamp: Date.now(),
              },
            ],
          }));
        }
        // No canned chat bubble here by design: the sub-agent's live stream
        // (activity rows + transcript) IS the communication. Announcements
        // like "Agent X deployed" felt robotic and duplicated the activity feed.
        if (isCurrentSession) {
          set((state) => ({
            activity: state.activity.map((item) =>
              item.id === `subtask-${data.subTaskId}` ? { ...item, status: 'running' as const } : item,
            ),
          }));
        }
      } else if (ev.type === 'welcome') {
        // Welcome events feed the activity row only — no canned "X working on"
        // bubble. The agent's own live stream is the communication.
        if (isCurrentSession) {
          const data = ev.data as { agentName?: string; role?: string };
          if (data.agentName) {
            set((state) => ({
              activity: state.activity.map((item) =>
                item.name === data.agentName && item.status === 'running'
                  ? { ...item, detail: data.role || item.detail }
                  : item,
              ),
            }));
          }
        }
      } else if (ev.type === 'subtask_progress') {
        // Live subagent stream (text, tools, retries) — activity feed only,
        // so parallel phases never interleave tokens into the chat transcript.
        const data = ev.data as { subTaskId: string; agentType: string; event: unknown };
        const inner = (data.event ?? {}) as { type?: string; text?: string };
        const progress = subtaskProgressById.get(data.subTaskId) ?? { description: '', preview: '', toolIds: [] as string[] };
        subtaskProgressById.set(data.subTaskId, progress);
        if (inner.type === 'text_delta' && typeof inner.text === 'string' && inner.text) {
          if (!isCurrentSession) return;
          progress.preview = `${progress.preview}${inner.text}`.slice(-2000);
          const detail = progress.preview ? `…${progress.preview.slice(-280)}` : progress.description;
          set((state) => ({
            activity: state.activity.map((item) =>
              item.id === `subtask-${data.subTaskId}` ? { ...item, detail } : item,
            ),
          }));
          return;
        }
        if (!isCurrentSession) return;
        applySubagentLiveEvent(
          {
            sessionId: ev.sessionId,
            agentName: data.agentType || 'Sub-agent',
            activityRowId: `subtask-${data.subTaskId}`,
            transcript: false,
            liveIds: [],
            toolIds: progress.toolIds,
          },
          data.event,
        );
      } else if (ev.type === 'task_updated') {
        // Silent by design: interjections join the mission context without a
        // canned "Update received" bubble — the agent's next stream shows it.
        if (!isCurrentSession) return;
      } else if (ev.type === 'task_completed') {
        if (isCurrentSession) set({ streaming: false, orchestratedTaskId: null });
        const data = ev.data as { totalSubTasks: number; completed: number; failed: number; duration: number };
        const chatTaskId = chatTaskByOrchestrator.get(ev.taskId) ?? activeChatTaskBySession.get(ev.sessionId);
        const verified = data.failed === 0 && data.completed === data.totalSubTasks;
        if (chatTaskId) {
          if (verified) agentStore.completeChatTask(chatTaskId, filesByChatTask.get(chatTaskId));
          else agentStore.failChatTask(chatTaskId, 'Automatic recovery exhausted.');
          filesByChatTask.delete(chatTaskId);
          chatTaskByOrchestrator.delete(ev.taskId);
          activeChatTaskBySession.delete(ev.sessionId);
        }
        orchestratorBySession.delete(ev.sessionId);
        const doneMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: verified
                ? `**All done.** ${data.completed} of ${data.totalSubTasks} sub-tasks completed successfully. Total time: ${(data.duration / 1000).toFixed(1)}s`
                : `**Finished the available work.** Results from ${data.completed} completed phase(s) are shown above.`,
            },
          ],
          timestamp: Date.now(),
        };
        if (isCurrentSession) set((s) => ({ messages: [...s.messages, doneMsg] }));
      } else if (ev.type === 'task_failed') {
        if (isCurrentSession) set({ streaming: false, orchestratedTaskId: null });
        const chatTaskId = chatTaskByOrchestrator.get(ev.taskId) ?? activeChatTaskBySession.get(ev.sessionId);
        if (chatTaskId) {
          agentStore.failChatTask(chatTaskId, 'Automatic recovery exhausted.');
          filesByChatTask.delete(chatTaskId);
          chatTaskByOrchestrator.delete(ev.taskId);
          activeChatTaskBySession.delete(ev.sessionId);
        }
        orchestratorBySession.delete(ev.sessionId);
        if (isCurrentSession) {
          const lastUser = [...get().messages].reverse().find((message) => message.role === 'user');
          const result = lastUser
            ? await useBrainStore.getState().generateOfflineResponse(textFromMessage(lastUser))
            : 'Finished the available work.';
          const resultMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: result }],
            timestamp: Date.now(),
            provider: 'offline-brain',
            model: 'local-recovery',
          };
          set((state) => ({ messages: [...state.messages, resultMessage] }));
          await window.api.appendSessionMessage({ sessionId: ev.sessionId, message: resultMessage }).catch(() => undefined);
        }
      } else if (ev.type === 'subtask_completed') {
        const data = ev.data as { subTaskId: string; result: string };
        const toolIds = new Set(subtaskProgressById.get(data.subTaskId)?.toolIds ?? []);
        subtaskProgressById.delete(data.subTaskId);
        // Create files from sub-agent result
        const files = await extractAndCreateFilesFromText(data.result);
        agentStore.completeSubTask(data.subTaskId, data.result, files);
        if (isCurrentSession) {
          set((state) => ({
            activity: state.activity.map((item) =>
              item.id === `subtask-${data.subTaskId}`
                ? { ...item, status: 'done' as const, label: `${item.name} agent completed`, detail: data.result.slice(0, 500) }
                : toolIds.has(item.toolUseId) && item.status === 'running'
                  ? { ...item, status: 'done' as const }
                  : item,
            ),
          }));
        }
        // Show result message
        const fileNote = files.length > 0 ? `\n\n**Files created:** ${files.join(', ')}` : '';
        const resultMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: `**Sub-agent complete**\n\n${data.result.slice(0, 800)}${fileNote}` }],
          timestamp: Date.now(),
        };
        if (isCurrentSession) set((s) => ({ messages: [...s.messages, resultMsg] }));
      } else if (ev.type === 'subtask_failed') {
        const data = ev.data as { subTaskId: string; error: string };
        const toolIds = new Set(subtaskProgressById.get(data.subTaskId)?.toolIds ?? []);
        subtaskProgressById.delete(data.subTaskId);
        agentStore.failSubTask(data.subTaskId, data.error);
        if (isCurrentSession) {
          set((state) => ({
            activity: state.activity.map((item) =>
              item.id === `subtask-${data.subTaskId}`
                ? { ...item, status: 'error' as const, label: `${item.name} agent failed`, detail: data.error }
                : toolIds.has(item.toolUseId) && item.status === 'running'
                  ? { ...item, status: 'error' as const }
                  : item,
            ),
          }));
        }
      }
    });
  },

  loadSessions: async () => {
    const sessions = await window.api.listSessions();
    set({ sessions });
  },

  clearAllSessions: async () => {
    // The main-process clear operation marks and aborts every active run before
    // deleting transcripts. Do not abort the current run separately here: that
    // would remove it from the main process's active-run map before it can be
    // marked as discarded, allowing a cancellation race to recreate the file.
    await window.api.clearAllSessions();
    activeChatTaskBySession.clear();
    chatTaskByOrchestrator.clear();
    orchestratorBySession.clear();
    filesByChatTask.clear();
    clearAllSafetyTimers();
    safetyFallbackSessions.clear();
    activeTeachingChatSessionId = null;
    useAgentsStore.setState({ chatTasks: [], subTasks: [] });
    set({
      sessions: [],
      currentSessionId: null,
      messages: [],
      streaming: false,
      activity: [],
      pendingPermission: null,
      orchestratedTaskId: null,
      orchestratorEvents: [],
      providerStatus: null,
      brainTeaching: null,
    });
  },

  createSession: async (cwd, model, provider) => {
    const session = await window.api.createSession({ cwd, model, provider });
    set((s) => ({ sessions: [session, ...s.sessions], currentSessionId: session.id, messages: [] }));
    return session;
  },

  selectSession: async (id) => {
    set({ loadingSession: true });
    try {
      // Flush in-flight appends first: switching sessions mid-stream must not
      // strand just-sent messages in a write the new transcript never sees.
      await flushPersists();
      const messages = await window.api.loadSession({ sessionId: id });
      const orchestratedTaskId = orchestratorBySession.get(id) ?? null;
      set({
        currentSessionId: id,
        messages,
        orchestratedTaskId,
        streaming: activeChatTaskBySession.has(id) || Boolean(orchestratedTaskId),
        activity: [],
      });
    } finally {
      set({ loadingSession: false });
    }
  },

  deleteSession: async (id) => {
    await window.api.deleteSession({ sessionId: id });
    clearSafetyTimer(id);
    safetyFallbackSessions.delete(id);
    const orchestratorId = orchestratorBySession.get(id);
    if (orchestratorId) chatTaskByOrchestrator.delete(orchestratorId);
    orchestratorBySession.delete(id);
    activeChatTaskBySession.delete(id);
    if (activeTeachingChatSessionId === id) activeTeachingChatSessionId = null;
    set((s) => ({
      sessions: s.sessions.filter((x) => x.id !== id),
      currentSessionId: s.currentSessionId === id ? null : s.currentSessionId,
      messages: s.currentSessionId === id ? [] : s.messages,
    }));
  },

  renameSession: async (id, title) => {
    await window.api.renameSession({ sessionId: id, title });
    await get().loadSessions();
  },

  pinSession: async (id, pinned) => {
    await window.api.pinSession({ sessionId: id, pinned });
    await get().loadSessions();
  },

  searchSessions: async (query) => {
    const sessions = await window.api.searchSessions({ query });
    set({ sessions });
  },

  branchSession: async (id, messageId) => {
    const session = await window.api.branchSession({ sessionId: id, messageId });
    await flushPersists();
    const messages = await window.api.loadSession({ sessionId: session.id });
    set((state) => ({ sessions: [session, ...state.sessions], currentSessionId: session.id, messages }));
  },

  exportSession: async (id, format = 'markdown') => {
    await window.api.exportSession({ sessionId: id, format });
  },

  importSession: async (content, format) => {
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as {
      cwd?: string;
      model?: string;
      provider?: string;
    };
    const result = (await window.api.importSession({
      format,
      content,
      cwd: current.cwd ?? '.',
      model: current.model ?? 'qwen3:4b',
      provider: current.provider ?? 'ollama',
    })) as { ok: boolean; session?: Session; error?: string };
    if (!result.ok || !result.session) throw new Error(result.error ?? 'Import failed');
    const messages = await window.api.loadSession({ sessionId: result.session.id });
    set((state) => ({ sessions: [result.session!, ...state.sessions], currentSessionId: result.session!.id, messages }));
    return result.session;
  },

  shareSession: async (id) => {
    const result = await window.api.shareSession({ sessionId: id }) as { ok: boolean; length?: number };
    return result;
  },

  announceUncensoredMode: async () => {
    let { currentSessionId } = get();
    if (!currentSessionId) {
      const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as {
        cwd?: string;
        model?: string;
        provider?: string;
      };
      const session = await window.api.createSession({
        cwd: current.cwd ?? '.',
        model: current.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
        provider: current.provider === 'local' ? 'ollama' : (current.provider ?? 'openrouter'),
        title: 'Uncensored mode activated',
      });
      currentSessionId = session.id;
      set((state) => ({ sessions: [session, ...state.sessions], currentSessionId: session.id, messages: [] }));
    }
    const announcement: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: [{ type: 'text', text: 'Uncensored mode enabled for this session. Responses will be direct and unrestricted within safety bounds.' }],
      timestamp: Date.now(),
    };
    set((state) => ({ messages: [...state.messages, announcement] }));
    if (currentSessionId) await window.api.appendSessionMessage({ sessionId: currentSessionId, message: announcement }).catch(() => undefined);
  },

  updateMessage: async (messageId, text) => {
    const { currentSessionId } = get();
    if (!currentSessionId || !text.trim()) return;
    const content: ContentBlock[] = [{ type: 'text', text: text.trim() }];
    const messages = await window.api.updateSessionMessage({ sessionId: currentSessionId, messageId, content });
    set({ messages });
  },

  sendMessage: async (visibleText, images, mode = 'chat', agentId) => {
    // Show thinking indicator IMMEDIATELY — before any async work.
    // This makes the UI feel instant when the user presses Enter.
    set({ streaming: true });

    // Only apply mode prefix when user explicitly chose a non-default mode.
    // The default 'agent' mode should behave identically to the button path
    // (no prefix, direct streaming via window.api.sendMessage).
    const text = (mode && mode !== 'chat' && mode !== 'agent')
      ? promptForExecutionMode(visibleText, mode)
      : visibleText.trim();
    const { currentSessionId } = get();
    const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    const provider = settings.provider === 'local' ? 'ollama' : (settings.provider ?? 'openrouter');
    let model = settings.model ?? '';
    let modelLabel = '';
    const textLower = text.toLowerCase();

    const teachingCommand = parseBrainTeachingCommand(text);
    if (teachingCommand) {
      const teachingSourceMessages = get().messages;
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: withImages(visibleText, images),
        timestamp: Date.now(),
      };
      set((state) => ({ messages: [...state.messages, userMessage], streaming: true }));

      let resultText: string;
      let teachingStatusResult: BrainTeachingStatus = {};
      try {
        let status: BrainTeachingStatus = {};
        if (teachingCommand.action === 'start') {
          const previousTeaching = get().brainTeaching;
          activeTeachingChatSessionId = currentSessionId;
          const context = buildBrainTeachingContext(teachingSourceMessages, teachingCommand.source);
          const startTeaching = window.api.brainTeachStart as (args: {
            durationMinutes: 10 | 60;
            source: 'curriculum' | 'topic' | 'conversation' | 'last-task' | 'online';
            topic?: string;
            context?: string;
            focus?: string;
            provider?: string;
            model?: string;
          }) => Promise<BrainTeachingStatus>;
          status = await startTeaching({
            durationMinutes: teachingCommand.durationMinutes,
            source: teachingCommand.source,
            ...(teachingCommand.topic ? { topic: teachingCommand.topic, focus: teachingCommand.topic } : {}),
            ...(context ? { context } : {}),
            ...(provider ? { provider } : {}),
            ...(model ? { model } : {}),
          });
          status = {
            ...status,
            durationMinutes: status.durationMinutes ?? teachingCommand.durationMinutes,
            source: status.source ?? teachingCommand.source,
            topic: status.topic ?? teachingCommand.topic,
          };
          const continuingExisting = Boolean(
            previousTeaching?.sessionId && status.sessionId && previousTeaching.sessionId === status.sessionId,
          );
          const ownerSessionId = continuingExisting ? previousTeaching?.chatSessionId ?? null : currentSessionId;
          activeTeachingChatSessionId = ownerSessionId;
          set((state) => ({
            brainTeaching: {
              ...status,
              ...(state.brainTeaching?.sessionId === status.sessionId ? state.brainTeaching : {}),
              chatSessionId: ownerSessionId,
            },
          }));
          if (status.active === false) activeTeachingChatSessionId = null;
        } else if (teachingCommand.action === 'status') {
          status = (await window.api.brainTeachStatus()) as BrainTeachingStatus;
          const ownerSessionId = get().brainTeaching?.chatSessionId ?? currentSessionId;
          activeTeachingChatSessionId = status.active ? ownerSessionId : null;
          set({ brainTeaching: status.state === 'idle' ? null : { ...status, chatSessionId: ownerSessionId } });
        } else if (teachingCommand.action === 'stop') {
          status = (await window.api.brainTeachStop()) as BrainTeachingStatus;
          set((state) => ({
            brainTeaching: { ...status, chatSessionId: state.brainTeaching?.chatSessionId ?? currentSessionId },
          }));
        }
        teachingStatusResult = status;
        resultText = formatBrainTeachingResult(teachingCommand.action, status);
      } catch {
        resultText = brainTeachingUnavailableMessage();
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: resultText }],
        timestamp: Date.now(),
      };
      set((state) => ({ messages: [...state.messages, assistantMessage], streaming: false }));

      try {
        let sessionId = currentSessionId;
        if (!sessionId) {
          const session = await window.api.createSession({
            cwd: settings.cwd ?? '.',
            model,
            provider,
            title: 'Brain teaching',
          });
          sessionId = session.id;
          if (teachingStatusResult.active) activeTeachingChatSessionId = session.id;
          set((state) => ({
            brainTeaching: teachingStatusResult.active && state.brainTeaching ? { ...state.brainTeaching, chatSessionId: session.id } : state.brainTeaching,
          }));
          set((state) => ({ sessions: [session, ...state.sessions], currentSessionId: session.id }));
        }
        await window.api.appendSessionMessage({ sessionId, message: userMessage });
        await window.api.appendSessionMessage({ sessionId, message: assistantMessage });
        set({ sessions: await window.api.listSessions() });
      } catch {
        // Teaching remains active even if local chat history cannot be persisted.
      }
      return;
    }

    // Skip pre-send model validation — it adds ~500-2000ms latency before the
    // agent even starts. The backend validates model availability during the
    // agent loop and handles fallback automatically via the failover plan.
    // This makes the first response start in ~200ms instead of ~2000ms.

    const persistLocalExchange = async (userMessage: Message, assistantMessage: Message) => {
      let sessionId = get().currentSessionId;
      if (!sessionId) {
        const session = await window.api.createSession({
          cwd: settings.cwd ?? '.',
          model,
          provider,
          title: visibleText.slice(0, 60),
        });
        sessionId = session.id;
        set((state) => ({ sessions: [session, ...state.sessions], currentSessionId: session.id }));
      }
      await window.api.appendSessionMessage({ sessionId, message: userMessage });
      await window.api.appendSessionMessage({ sessionId, message: assistantMessage });
      const sessions = await window.api.listSessions();
      set({ sessions });
    };

    // Model identity is live application state, not something the selected
    // model should be asked to remember. Answer locally so a provider persona
    // or stale training data can never misreport the active configuration.
    if (isModelIdentityQuestion(visibleText)) {
      const now = Date.now();
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: withImages(visibleText.trim(), images),
        timestamp: now,
      };
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: formatRuntimeIdentity(provider, model, modelLabel) }],
        timestamp: now + 1,
        provider,
        model,
        requested_provider: provider,
        requested_model: model,
      };
      set((state) => ({ messages: [...state.messages, userMessage, assistantMessage], streaming: false }));
      await persistLocalExchange(userMessage, assistantMessage);
      return;
    }

    if (agentId && agentId !== 'auto') {
      let sessionId = currentSessionId;
      if (!sessionId) {
        const session = await window.api.createSession({
          cwd: settings.cwd ?? '.',
          model,
          provider,
          title: visibleText.slice(0, 60),
        });
        sessionId = session.id;
        set((state) => ({ sessions: [session, ...state.sessions], currentSessionId: session.id, messages: [] }));
      }
    if (!sessionId) { set({ streaming: false }); return; }
      const selectedSessionId = sessionId;

      const agentInfo = useAgentsStore.getState().types.find((item) => item.id === agentId);
      const agentName = agentInfo?.name ?? agentId;
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: withImages(visibleText, images),
        timestamp: Date.now(),
      };
      const activityId = `selected-agent-${crypto.randomUUID()}`;
      const taskTitle = visibleText.length > 60 ? `${visibleText.slice(0, 60)}...` : visibleText;
      const chatTaskId = useAgentsStore.getState().addChatTask(`${agentName}: ${taskTitle}`);
      activeChatTaskBySession.set(selectedSessionId, chatTaskId);
      // Start with empty activity[] so ThinkingBubble shows first — identical
      // to the automatic agent path. Activity rows are created by
      // handleStreamEvent when tools actually start running.
      set((state) => ({
        messages: [...state.messages, userMessage],
        streaming: true,
        activity: [],
      }));
      await window.api.appendSessionMessage({ sessionId: selectedSessionId, message: userMessage });

      try {
        const run = (await window.api.spawnAgent({
          agentId,
          task: text,
          sessionId: selectedSessionId,
          cwd: settings.cwd ?? '.',
          provider,
          model,
        })) as { id: string };
        selectedAgentRuns.set(run.id, {
          sessionId: selectedSessionId,
          chatTaskId,
          activityId,
          agentName,
          preview: '',
          liveMessageIds: [],
          liveToolUseIds: [],
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        activeChatTaskBySession.delete(selectedSessionId);
        useAgentsStore.getState().failChatTask(chatTaskId, message);
        set((state) => ({
          streaming: false,
          activity: state.activity.map((item) =>
            item.id === activityId
              ? { ...item, status: 'error' as const, label: `${agentName} could not start`, detail: message }
              : item,
          ),
          messages: [
            ...state.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: [{ type: 'text', text: `**${agentName} could not start.**\n\n${message}` }],
              timestamp: Date.now(),
            },
          ],
        }));
      }
      return;
    }

    // Intent detection: intercept deploy/push actions and run them directly
    if (
      /\b(deploy|push\s+to\s+github|push\s+to\s+git|publish)\b/i.test(textLower) &&
      /\b(this|project|repo|code|app|now|it)\b/i.test(textLower)
    ) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: withImages(visibleText, images),
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, userMessage], streaming: true }));
      try {
        const result = (await window.api.deployQuickPush({ cwd: settings.cwd ?? '.', message: text.slice(0, 72) })) as {
          status?: string;
          steps?: Array<{ name: string; command: string; status: string; output?: string }>;
        };
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [
            {
              type: 'text',
              text:
                result?.status === 'success'
                  ? `**Deployed successfully!**\n\n${result.steps?.map((s) => `- ${s.name}: \`${s.command}\` ΓÇö ${s.status}`).join('\n')}`
                  : `**Deployment failed.**\n\n${
                      result?.steps
                        ?.filter((s) => s.status === 'failed')
                        .map((s) => `- ${s.name}: ${s.output}`)
                        .join('\n') || 'Unknown error'
                    }`,
            },
          ],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, assistantMessage], streaming: false }));
        await persistLocalExchange(userMessage, assistantMessage);
        await distillInteraction(text, textFromMessage(assistantMessage), {
          source: 'system',
          provider: 'infinite-deploy',
          model: 'chat-action',
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: [{ type: 'text', text: `**Deployment error:** ${error.message}` }],
              timestamp: Date.now(),
            } as Message,
          ],
          streaming: false,
        }));
      }
      return;
    }

    // Intent detection: intercept test/run actions
    if (/\b(run\s+tests?|test\s+this|run\s+vitest|run\s+jest|run\s+pytest)\b/i.test(textLower)) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: withImages(visibleText, images),
        timestamp: Date.now(),
      };
      set((s) => ({ messages: [...s.messages, userMessage], streaming: true }));
      try {
        const detected = await window.api.deployDetectProject({ projectPath: settings.cwd ?? '.' });
        const config = (await window.api.deployDefaultConfig({ type: detected || 'node' })) as {
          commands?: { test?: string };
        };
        const target = (await window.api.deployCreateTarget({ name: 'test-run', type: 'local', config: {} })) as {
          id: string;
        };
        const pipeline = (await window.api.deployCreatePipeline({
          name: 'Run Tests',
          projectId: 'default',
          targetId: target.id,
          commands: [config.commands?.test || 'npx vitest run'],
        })) as { id: string };
        const result = (await window.api.deployRunPipeline({ pipelineId: pipeline.id, cwd: settings.cwd ?? '.' })) as {
          status?: string;
          steps?: Array<{ status: string; output?: string }>;
        };
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [
            {
              type: 'text',
              text:
                result?.status === 'success'
                  ? `**Tests passed!**\n\n${result.steps?.map((s) => s.output).join('\n')}`
                  : `**Tests failed.**\n\n${
                      result?.steps
                        ?.filter((s) => s.status === 'failed')
                        .map((s) => s.output)
                        .join('\n') || 'Unknown error'
                    }`,
            },
          ],
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, assistantMessage], streaming: false }));
        await persistLocalExchange(userMessage, assistantMessage);
        await distillInteraction(text, textFromMessage(assistantMessage), {
          source: 'system',
          provider: 'infinite-tests',
          model: 'chat-action',
        });
      } catch (e: unknown) {
        const error = e instanceof Error ? e : new Error(String(e));
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: [{ type: 'text', text: `**Test error:** ${error.message}` }],
              timestamp: Date.now(),
            } as Message,
          ],
          streaming: false,
        }));
      }
      return;
    }

    // Fast path: real API providers skip all local checks — send immediately.
    // The backend failover system handles key validation and model routing.
    const isRealProvider = provider !== 'local' && provider !== 'ollama';
    const brainMode = settings.brainMode !== false;

    // Only check keys for local/ollama — real APIs (openrouter, openai, etc.) 
    // have keys validated server-side. This removes ~500ms of IPC calls.
    let hasApiKey = isRealProvider;
    let ollamaAvailable = false;
    if (!isRealProvider) {
      try {
        const providerList = await window.api.listProviders() as Array<{ id: string; requiresApiKey: boolean }>;
        const providerRequiresApiKey = providerList.find((item) => item.id === provider)?.requiresApiKey ?? true;
        if (providerRequiresApiKey) hasApiKey = (await window.api.hasProviderKey({ provider })) as boolean;
      } catch { /* ignore */ }
      try {
        ollamaAvailable = Boolean((await window.api.ollamaStatus())?.available);
      } catch { /* ignore */ }
    }

    // Skip engine bootstrap for real providers — the backend handles it
    const brainStore = useBrainStore.getState();
    if (!isRealProvider) {
      try {
        await brainStore.refreshEngineStatus();
      } catch { /* ignore */ }

      // If engine is dormant but we have credentials, bootstrap it
      if (brainStore.enginePhase === 'dormant' && (hasApiKey || ollamaAvailable)) {

        try {
          await window.api.engineBootstrap();
          await brainStore.refreshEngineStatus();
        } catch {
          /* ignore */
        }
      }
    }

    // If engine is not ready and we don't have API keys, prefer brain/ollama
    const engineReady = brainStore.checkEngineReady();

    let prestartedTaskId: string | null = null;

    // Full-system mode has a local deterministic action router. It handles
    // PC/browser shortcuts instantly (same fast path the Power Center buttons use).
    // Cache the permission profile locally so this doesn't block typing.
    const localProfileHint = (() => {
      try {
        const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as { permissionProfile?: string };
        return cur.permissionProfile ?? '';
      } catch { return ''; }
    })();
    try {
      const permissionProfile = localProfileHint || await window.api.getSetting({ key: 'permissionProfile' });
      if ([':full-system-access', 'fullSystemAccess', 'full-system-access', 'full_system_access'].includes(String(permissionProfile))) {
        const localActionIntent = /\b(open|launch|start|search|find|navigate|browse|click|type|press|send|run|execute|create|write|move|rename|delete|capture|screenshot)\b/i.test(text);
        if (localActionIntent) {
          const taskTitle = visibleText.length > 60 ? visibleText.slice(0, 60) + '...' : visibleText;
          prestartedTaskId = useAgentsStore.getState().addChatTask(taskTitle);
        }
        const operatorIntent = /\b(open|launch|start|search|find|navigate|browse)\b/i.test(text) &&
          /\b(chrome|browser|amazon|website|web|url)\b/i.test(text);
        const operatorActivityId = `operator-${crypto.randomUUID()}`;
        if (operatorIntent) {
          set((state) => ({
            streaming: true,
            activity: [
              ...state.activity,
              {
                id: operatorActivityId,
                toolUseId: operatorActivityId,
                name: 'Operator',
                label: 'Starting Chrome operator',
                detail: 'Launching remote debugging and attaching through CDP',
                category: 'computer',
                status: 'running',
                timestamp: Date.now(),
              },
            ],
          }));
        }
        const actionResponse = await brainStore.executeLocalAction(text);
        if (actionResponse) {
          const userMessage: Message = {
            id: crypto.randomUUID(),
            role: 'user',
            content: withImages(visibleText, images),
            timestamp: Date.now(),
          };
          const assistantMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: actionResponse }],
            timestamp: Date.now(),
          };
          set((s) => ({
            messages: [...s.messages, userMessage, assistantMessage],
            streaming: false,
            activity: s.activity.map((item) =>
              item.id === operatorActivityId ? { ...item, status: 'done' as const } : item,
            ),
          }));
          if (prestartedTaskId) {
            if (responseIndicatesFailure(actionResponse)) {
              useAgentsStore.getState().failChatTask(prestartedTaskId, actionResponse);
            } else {
              useAgentsStore.getState().completeChatTask(prestartedTaskId);
            }
          }
          await persistLocalExchange(userMessage, assistantMessage);
          await distillInteraction(text, actionResponse, {
            source: 'system',
            provider: 'infinite-action-router',
            model: 'local-actions',
          });
          return;
        }
      }
    } catch (error) {
        console.warn('[chat] Local action router unavailable; continuing through the agent loop.', error);
    }
    // Always enter the credential-aware recovery router. If the selected model
    // or provider is unavailable it can use any other saved key automatically.
    if (provider === 'ollama') {
      // Continue to the shared streaming agent path below so local models can use tools.
    } else if (isRealProvider) {

      // Fall through to API path below (the code after this brainMode block)
    } else if (brainMode) {


      // Step 1: Try Brain patterns FIRST ΓÇö these execute real actions (build, open, email, terminal, etc.)
      let brainResponse: string | null = null;
      let isActionResponse = false;
      try {
        const brainStore = useBrainStore.getState();
        // Keep the self-trained Brain gated until every readiness check passes.
        // During bootstrap, configured local/API models remain its teachers.
        brainResponse = engineReady ? await brainStore.generateOfflineResponse(text) : null;

        // Check if this was an ACTION pattern (file write, command, browser, etc.)
        if (brainResponse) {
          isActionResponse =
          brainResponse.startsWith('**$ ') ||
          brainResponse.includes('```') ||
          brainResponse.startsWith('≡ƒôü') ||
          brainResponse.startsWith('Γ£à') ||
          brainResponse.startsWith('≡ƒô╕') ||
          brainResponse.startsWith('≡ƒôé') ||
          brainResponse.startsWith('≡ƒûÑ∩╕Å') ||
          brainResponse.startsWith('≡ƒîÉ') ||
          brainResponse.startsWith('≡ƒôº') ||
          brainResponse.startsWith('≡ƒô¼') ||
          brainResponse.startsWith('≡ƒô¡') ||
          brainResponse.startsWith('≡ƒöè') ||
          brainResponse.startsWith('≡ƒöç') ||
          brainResponse.startsWith('ΓÅ│') ||
          brainResponse.includes('Exit code:') ||
          brainResponse.includes('created successfully') ||
          brainResponse.includes('Error:') ||
          brainResponse.includes('Γ¥î');
        } else {
          isActionResponse = false;
        }

        // If it's an ACTION, use the Brain response directly
        if (isActionResponse) {

        }
        // If it's conversational and user has an API key, skip Brain ΓÇö go to API
        else if (hasApiKey) {

          brainResponse = null; // Don't use Brain response
        }
      } catch (brainErr: unknown) {
        const error = brainErr instanceof Error ? brainErr : new Error(String(brainErr));
        console.error('[chat] Brain error:', error);
        brainResponse = `Γ¥î Brain error: ${error.message}. Try again or check the console for details.`;
        isActionResponse = true; // Treat errors as action responses
      }

      // If Brain gave an action response, display it and stop
      if (isActionResponse && brainResponse) {
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: withImages(visibleText, images),
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, userMessage], streaming: true }));

        const taskTitle = visibleText.length > 60 ? visibleText.slice(0, 60) + '...' : visibleText;
        const taskId = prestartedTaskId ?? useAgentsStore.getState().addChatTask(taskTitle);

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: brainResponse }],
          timestamp: Date.now(),
        };

        set((s) => ({ messages: [...s.messages, assistantMessage], streaming: false }));

        const files = await extractAndCreateFiles(assistantMessage, text);
        if (responseIndicatesFailure(brainResponse)) useAgentsStore.getState().failChatTask(taskId, brainResponse);
        else useAgentsStore.getState().completeChatTask(taskId, files);

        await persistLocalExchange(userMessage, assistantMessage);
        await distillInteraction(text, brainResponse, {
          source: 'brain',
          provider: 'offline-brain',
          model: 'pattern-action',
        });

        return;
      }

      // If Brain gave conversational response but user has API key, fall through to API path
      if (!isActionResponse && hasApiKey) {

        // Don't add user message yet ΓÇö the API path will add it
        // Fall through to the API code below (past the brainMode block)
      }

      // If no API key, try Ollama, then use Brain response
      if (!isActionResponse && !hasApiKey) {
        const userMessage: Message = {
          id: crypto.randomUUID(),
          role: 'user',
          content: withImages(visibleText, images),
          timestamp: Date.now(),
        };
        set((s) => ({ messages: [...s.messages, userMessage], streaming: true }));

        const taskTitle = visibleText.length > 60 ? visibleText.slice(0, 60) + '...' : visibleText;
        const taskId = prestartedTaskId ?? useAgentsStore.getState().addChatTask(taskTitle);

        let finalResponse = brainResponse || '';

        try {
          if (ollamaAvailable) {
            const systemPrompt = await window.api.ollamaSystemPrompt().catch(() => '');
            // An explicit choice wins; otherwise the main process selects the
            // best installed model for this laptop's hardware profile.
            const selectedModel = settings.ollamaModel || undefined;
            const ollamaResponse = (await window.api.ollamaAsk({
              prompt: text,
              systemPrompt,
              model: selectedModel,
            })) as string;
            if (ollamaResponse && ollamaResponse.length > 5) {
              finalResponse = ollamaResponse;
            }
          }
        } catch {
          // Ollama unavailable ΓÇö keep the pattern-matching response
        }

        if (!finalResponse) {
          finalResponse = 'The Infinite Brain is still bootstrapping and cannot answer on its own yet. Configure an API key or start Ollama; successful model responses will train the Brain until its readiness checks pass.';
        }

        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: finalResponse }],
          timestamp: Date.now(),
        };

        set((s) => ({ messages: [...s.messages, assistantMessage], streaming: false }));

        const files = await extractAndCreateFiles(assistantMessage, text);
        if (responseIndicatesFailure(finalResponse)) useAgentsStore.getState().failChatTask(taskId, finalResponse);
        else useAgentsStore.getState().completeChatTask(taskId, files);

        await persistLocalExchange(userMessage, assistantMessage);
        await distillInteraction(text, finalResponse, {
          source: finalResponse === brainResponse ? 'brain' : 'ollama',
          provider: finalResponse === brainResponse ? 'offline-brain' : 'ollama',
          model: finalResponse === brainResponse ? 'pattern-memory' : settings.ollamaModel || model || 'ollama',
        });

        return;
      }
    }



    let sessionId = currentSessionId;

    // Auto-create session if none exists
    if (!sessionId) {
      try {
        const session = await window.api.createSession({
          cwd: settings.cwd ?? '.',
          model,
          provider,
          title: visibleText.slice(0, 60),
        });
        sessionId = session.id;
        set((s) => ({
          sessions: [session, ...s.sessions],
          currentSessionId: session.id,
          messages: [],
        }));
      } catch (e) {
        console.error('[chat] Failed to create session:', e);
        set({ streaming: false });
        return;
      }
    }

    if (!sessionId) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: withImages(visibleText, images),
      timestamp: Date.now(),
    };
    // Show streaming + a provider hint immediately, before the first real
    // provider event arrives — matches the instant feedback you see from
    // the Power Center one-click buttons.
    set({
      messages: [...get().messages, userMessage],
      streaming: true,
      activity: [],
      providerStatus: { label: `Contacting ${provider}`, detail: 'Preparing request…', receivedAt: Date.now() },
    });

    // Create a chat task for the right panel
    const taskTitle = visibleText.length > 60 ? visibleText.slice(0, 60) + '...' : visibleText;
    const chatTaskId = prestartedTaskId ?? useAgentsStore.getState().addChatTask(taskTitle);
    activeChatTaskBySession.set(sessionId!, chatTaskId);

    // Paired second model (paid feature): two models collaborate as a crew —
    // leader on the primary model + Collaborator on the paired model.
    // Falls through to the normal single-model path on any failure.
    const pairedModel =
      settings.secondModelEnabled && settings.model2 && !agentId && !(images && images.length)
        ? {
            provider: (settings.provider2 as string | undefined) ?? provider,
            model: settings.model2 as string,
            label: (settings.model2Label as string | undefined) ?? (settings.model2 as string),
          }
        : null;
    if (pairedModel) {
      try {
        const crew = (await window.api.crewStart({
          prompt: text,
          displayPrompt: visibleText,
          sessionId: sessionId!,
          cwd: settings.cwd ?? '.',
          provider,
          model,
          provider2: pairedModel.provider,
          model2: pairedModel.model,
        })) as {
          strategy?: string;
          members?: Array<{ role: string; provider: string; model: string }>;
          leader?: { provider: string; model: string };
          paired?: { role: string; provider: string; model: string } | null;
        };
        const team = [
          `Leader: ${crew.leader?.provider ?? provider}/${crew.leader?.model ?? model}`,
          ...(crew.members ?? []).map((m) => `${m.role}: ${m.provider}/${m.model}`),
        ].join(' · ');
        set((s) => ({
          providerStatus: { label: `Crew (${crew.strategy ?? 'paired'})`, detail: team.slice(0, 220), receivedAt: Date.now() },
          messages: [
            ...s.messages,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: [{ type: 'text', text: `Two models collaborating — ${team}. Working…` }],
              timestamp: Date.now(),
            },
          ],
        }));
        // Completion/failure lands via onCrewEvent (transcript reload + task close).
        return;
      } catch (e) {
        console.error('[chat] Crew start failed, falling back to single model:', e);
      }
    }

    // Fall back only after 150 seconds without provider, token, or tool
    // activity. NVIDIA may legitimately take 120 seconds before retrying.
    safetyFallbackSessions.delete(sessionId);
    armSafetyTimer(sessionId, async () => {
      if (!activeChatTaskBySession.has(sessionId!)) return;
      console.error('[chat] Safety timeout ΓÇö stopping the unverified run and using the offline fallback');
      safetyFallbackSessions.add(sessionId!);
      await window.api.abortMessage({ sessionId: sessionId! }).catch(() => undefined);
      const brainStore = useBrainStore.getState();
      const brainResponse = await brainStore.generateOfflineResponse(text);
      const fallbackText = brainResponse;
      await distillInteraction(text, fallbackText, {
        source: 'system',
        provider,
        model: model || 'offline-fallback',
      });

      const fallbackMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: fallbackText }],
        timestamp: Date.now(),
      };
      await window.api.appendSessionMessage({ sessionId: sessionId!, message: fallbackMessage }).catch(() => undefined);

      const st = get();
      if (st.currentSessionId === sessionId) {
        set({
          streaming: false,
          messages: [...st.messages, fallbackMessage],
        });
      }
      useAgentsStore.getState().completeChatTask(chatTaskId);
      activeChatTaskBySession.delete(sessionId!);
    });

    // Only orchestrate truly complex multi-part requests. Short single-build
    // requests like "create a website" go to a single agent to avoid 2× overhead.
    const isComplexTask =
      (text.length > 300 &&
        /\b(build|create|make|develop|deploy|full|complete|entire|whole)\b/i.test(text) &&
        /\b(website|app|application|dashboard|saas|project|system)\b/i.test(text)) ||
      (/\b(build|create|make|develop)\b/i.test(text) &&
        /\b(website|app|application|dashboard|saas|project|system)\b/i.test(text) &&
        /(?:\band\b|\bthen\b|,|;)/i.test(text)); // multi-part: "create X and Y"

    try {
      if (isComplexTask) {
        // Use orchestrator for complex tasks
        try {
          const result = await window.api.orchestratorStart({
            prompt: text,
            displayPrompt: visibleText,
            sessionId: sessionId!,
            cwd: settings.cwd ?? '.',
            provider,
            model,
          });
          clearSafetyTimer(sessionId!);
          chatTaskByOrchestrator.set(result.taskId, chatTaskId);
          orchestratorBySession.set(sessionId!, result.taskId);
          set({ orchestratedTaskId: result.taskId });

          // No canned "breaking this down" bubble: the sub-agents' live
          // activity rows + transcript ARE the announcement.
        } catch (e) {
          console.error('[chat] Orchestrator failed, falling back to direct:', e);
          await window.api.sendMessage({
            sessionId: sessionId!,
            message: withImages(text, images),
            displayMessage: userMessage.content,
            provider,
            model,
            cwd: settings.cwd ?? '.',
          });
        }
      } else {
        // Use direct agent for simple tasks
        await window.api.sendMessage({
          sessionId: sessionId!,
          message: withImages(text, images),
          displayMessage: userMessage.content,
          provider,
          model,
          cwd: settings.cwd ?? '.',
        });
      }
    } catch (e: unknown) {
      const error = e instanceof Error ? e : new Error(String(e));
      console.error('[chat] Send failed:', error);
      clearSafetyTimer(sessionId!);
      useAgentsStore.getState().failChatTask(chatTaskId, error.message);
      activeChatTaskBySession.delete(sessionId!);

      // If API fails, try to use brain as fallback — show SHORT error
      const brainStore = useBrainStore.getState();
      const brainResponse = await brainStore.generateOfflineResponse(text);
      await distillInteraction(text, `API Error: ${error.message}\n\n${brainResponse}`, {
        source: 'system',
        provider,
        model: model || 'offline-fallback',
      });

      // Extract short error summary (first 120 chars only)
      const shortError = error.message.length > 120 ? error.message.slice(0, 120) + '...' : error.message;
      set((s) => ({
        streaming: false,
        messages: [
          ...s.messages,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: [{ type: 'text', text: `**Something went wrong.**\n\n${shortError}\n\n**Try:** Check your API key in Settings → AI Provider, or switch to a different provider.\n\n---\n\n${brainResponse}` }],
            timestamp: Date.now(),
          },
        ],
      }));
      return;
    }
  },

  abort: async () => {
    const { currentSessionId } = get();
    if (currentSessionId) {
      await window.api.abortMessage({ sessionId: currentSessionId });
      clearSafetyTimer(currentSessionId);
      const chatTaskId = activeChatTaskBySession.get(currentSessionId);
      if (chatTaskId) {
        useAgentsStore.getState().failChatTask(chatTaskId, 'Cancelled by user.');
        filesByChatTask.delete(chatTaskId);
        activeChatTaskBySession.delete(currentSessionId);
      }
      const orchestratorId = orchestratorBySession.get(currentSessionId);
      if (orchestratorId) chatTaskByOrchestrator.delete(orchestratorId);
      orchestratorBySession.delete(currentSessionId);
    }
    set({ streaming: false, orchestratedTaskId: null, providerStatus: null });
  },

  respondPermission: async (allowed) => {
    const { pendingPermission } = get();
    if (!pendingPermission) return;
    await window.api.respondPermission({ id: pendingPermission.id, allowed });
    set({ pendingPermission: null });
  },

  isSessionStreaming: (id) => activeChatTaskBySession.has(id) || Boolean(orchestratorBySession.get(id)),

  interject: async (message) => {
    const { orchestratedTaskId, currentSessionId } = get();
    if (!currentSessionId) return;
    const activeOrchestratorId = orchestratorBySession.get(currentSessionId) ?? orchestratedTaskId;

    // Add user message to chat
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: message }],
      timestamp: Date.now(),
    };
    set((s) => ({ messages: [...s.messages, userMessage] }));

    // Send the update to whichever task engine is currently active.
    try {
      if (activeOrchestratorId) {
        await window.api.orchestratorInterject({ taskId: activeOrchestratorId, message });
      } else {
        await window.api.interjectMessage({ sessionId: currentSessionId, message });
      }
    } catch (e) {
      console.error('[chat] Interjection failed:', e);
    }
  },
}));

type DistillSource = 'api' | 'brain' | 'ollama' | 'system';

interface DistillOptions {
  source: DistillSource;
  provider?: string;
  model?: string;
  duration?: number;
}

function textFromMessage(message: Message): string {
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ');
}

function detectDistilledTaskType(input: string): string {
  const lower = input.toLowerCase();
  if (/\b(quiz|teach|learn|summari[sz]e|explain|study|pdf|lesson)\b/.test(lower)) return 'learning';
  if (/\b(code|feature|functionality|bug|debug|refactor|source code)\b/.test(lower)) return 'coding';
  if (/\b(browser|chrome|search|web|internet|amazon|youtube|online)\b/.test(lower)) return 'web';
  if (/\b(click|type|mouse|keyboard|screen|window|pc|computer|open app)\b/.test(lower)) return 'computer-control';
  if (/\b(business|entrepreneur|startup|market|sales|customer|strategy)\b/.test(lower)) return 'business';
  if (/\b(build|deploy|publish|test|run|app|website|dashboard)\b/.test(lower)) return 'building';
  return 'general';
}

function responseIndicatesFailure(response: string): boolean {
  const text = response.trim();
  return /^(?:error\b|failed\b|failure\b)/i.test(text) ||
    /\b(?:could not|couldn't|cannot|can't|unable to)\s+(?:complete|perform|execute|open|launch|send|create|write|run|connect|answer)\b/i.test(text) ||
    /\bexit code:\s*[1-9]\d*\b/i.test(text);
}

async function distillInteraction(input: string, output: string, options: DistillOptions): Promise<void> {
  const cleanInput = input.trim();
  const cleanOutput = output.trim();
  if (!cleanInput || !cleanOutput) return;

  const localSource = options.source === 'api' ? 'api' : options.source === 'system' ? 'system' : 'user';
  const conversationSource = options.source === 'ollama' ? 'ollama' : options.source === 'api' ? 'api' : 'brain';
  const taskType = detectDistilledTaskType(cleanInput);
  const provider = options.provider || options.source;
  const model = options.model || provider;

  try {
    useBrainStore.getState().learnFromInteraction(cleanInput, cleanOutput, localSource);
  } catch {
    /* non-blocking */
  }

  const work: Array<Promise<unknown>> = [
    window.api.brainLearnInteraction({
      request: cleanInput,
      response: cleanOutput,
      provider,
      model,
      durationMs: options.duration ?? 0,
      success: !responseIndicatesFailure(cleanOutput),
    }),
    window.api.ollamaRecordConversation({
      input: cleanInput,
      output: cleanOutput,
      source: conversationSource,
    }),
    window.api.brainImproveRecord({
      taskType,
      pattern: cleanInput.slice(0, 300),
      success: cleanOutput.length > 10 && !/\b(error|failed|timed out)\b/i.test(cleanOutput.slice(0, 240)),
      duration: options.duration ?? 0,
      model,
      approach: `${provider}:${options.source}`,
    }),
  ];

  if (options.source === 'api') {
    work.push(
      window.api.ollamaRecordApi({
        input: cleanInput,
        response: cleanOutput,
        model,
        provider,
      }),
    );
  }

  await Promise.allSettled(work);

  try {
    const brainStore = useBrainStore.getState();
    await brainStore.refreshEngineStatus();
    if (brainStore.enginePhase === 'dormant' && (options.source === 'api' || options.source === 'ollama')) {
      await window.api.engineBootstrap();
      await brainStore.refreshEngineStatus();
    }
  } catch {
    /* non-blocking */
  }
}

function generateFilename(lang: string): string {
  const map: Record<string, string> = {
    html: 'index.html',
    javascript: 'script.js',
    js: 'script.js',
    typescript: 'index.ts',
    ts: 'index.ts',
    css: 'styles.css',
    python: 'main.py',
    py: 'main.py',
    json: 'config.json',
    markdown: 'readme.md',
    md: 'readme.md',
    rust: 'main.rs',
    rs: 'main.rs',
    go: 'main.go',
    yaml: 'config.yaml',
    yml: 'config.yaml',
    sql: 'query.sql',
    sh: 'script.sh',
    bash: 'script.sh',
  };
  return map[lang.toLowerCase()] || `file.${lang || 'txt'}`;
}

async function extractAndCreateFiles(message: Message, requestText = ''): Promise<string[]> {
  const createdFiles: string[] = [];
  const textBlocks = message.content.filter((c) => c.type === 'text');

  for (const block of textBlocks) {
    if (block.type !== 'text') continue;
    const text = (block as { text: string }).text;
    const files = await extractAndCreateFilesFromText(text, requestText);
    createdFiles.push(...files);
  }

  return createdFiles;
}

function isArtifactRequest(requestText: string): boolean {
  if (!requestText.trim()) return true;
  return /\b(build|create|make|write|generate|implement|code|html|website|webpage|landing page|app|game|file)\b/i.test(
    requestText,
  );
}

function shouldLaunchArtifact(requestText: string, filename: string): boolean {
  if (!filename.toLowerCase().endsWith('.html')) return false;
  return /\b(launch|open|preview|run|show|website|webpage|landing page|html|game)\b/i.test(requestText);
}

async function extractAndCreateFilesFromText(text: string, requestText = ''): Promise<string[]> {
  const createdFiles: string[] = [];
  if (!isArtifactRequest(requestText)) return createdFiles;

  // Match code blocks: ```lang\n code ``` or ```lang filename="file"\n code ```
  const regex = /```(\w+)?\s*(?:filename="([^"]+)")?\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const lang = match[1] || 'txt';
    const filename = match[2] || generateFilename(lang);
    const content = match[3].trim();

    if (content.length > 10) {
      try {
        const result = (await window.api.fileWrite({ path: filename, content })) as { ok?: boolean; error?: string };
        if (result.error) throw new Error(result.error);
        useEditorStore
          .getState()
          .openInEditor(filename, content, undefined, shouldLaunchArtifact(requestText, filename));
        createdFiles.push(filename);
      } catch (e) {
        console.error('[chat] Failed to create file:', filename, e);
      }
    }
  }

  return createdFiles;
}

// Live progress state for orchestrator subtasks (activity feed only).
const subtaskProgressById = new Map<string, { description: string; preview: string; toolIds: string[] }>();

// ── Unified subagent live streaming ──────────────────────────────────────
// Selected agents and orchestrator subtasks emit the same chat-compatible
// live events as the automatic agent loop (message/tool/provider
// boundaries). This applier renders them through the identical UI pipeline:
// live transcript text, tool cards in the activity feed, provider status.
// transcript=true (chat-spawned agents): stream into a live transcript
// message, one per model turn — exactly like the automatic agent.
// transcript=false (orchestrator subtasks): activity feed only, so parallel
// phases never interleave tokens into the chat transcript.
interface SubagentLiveTarget {
  sessionId: string;
  agentName: string;
  /** Agent/subtask-level activity row id. */
  activityRowId: string;
  transcript: boolean;
  /** Tracked live transcript message ids (mutated in place, never reassigned). */
  liveIds: string[];
  /** Tracked tool activity row ids / toolUseIds (mutated in place). */
  toolIds: string[];
}

interface SubagentLiveEvent {
  type: string;
  message_id?: string;
  provider?: string;
  model?: string;
  turn?: number;
  text?: string;
  tool_use_id?: string;
  name?: string;
  input?: unknown;
  status?: string;
  detail?: string;
  content?: unknown;
  is_error?: boolean;
  partial?: boolean;
  from?: string;
  to?: string;
  reason?: string;
  stop_reason?: Message['stop_reason'];
  usage?: unknown;
  attempt?: number;
}

function applySubagentLiveEvent(target: SubagentLiveTarget, raw: unknown): void {
  const ev = raw as SubagentLiveEvent;
  if (target.sessionId !== useChatStore.getState().currentSessionId) return;
  const set = useChatStore.setState;
  const liveId = target.liveIds.length ? target.liveIds[target.liveIds.length - 1] : undefined;
  switch (ev.type) {
    case 'message_start': {
      if (!target.transcript || !ev.message_id) break;
      const msgId = ev.message_id;
      const prevId = target.liveIds.length ? target.liveIds[target.liveIds.length - 1] : undefined;
      const prev = prevId ? useChatStore.getState().messages.find((m) => m.id === prevId) : undefined;
      const prevHasText = prev?.content.some((c) => c.type === 'text' && c.text.trim());
      if (prev && !prevHasText && prevId) {
        const dropIdx = target.liveIds.indexOf(prevId);
        if (dropIdx >= 0) target.liveIds.splice(dropIdx, 1);
      }
      const droppedId = prev && !prevHasText ? prevId : undefined;
      set((s) => {
        const messages = droppedId ? s.messages.filter((m) => m.id !== droppedId) : s.messages;
        if (messages.some((m) => m.id === msgId)) return { streaming: true };
        const assistant: Message = { id: msgId, role: 'assistant', content: [], timestamp: Date.now() };
        return { messages: [...messages, assistant], streaming: true };
      });
      if (!target.liveIds.includes(msgId)) target.liveIds.push(msgId);
      break;
    }
    case 'provider_start': {
      const modelLabel = ev.model || 'model';
      // Some providers prefix their own id into model ids
      // (nvidia/nemotron-...) — strip it so the label never stutters.
      const shortLabel = ev.provider && modelLabel.startsWith(`${ev.provider}/`)
        ? modelLabel.slice(ev.provider.length + 1)
        : modelLabel;
      set((s) => ({
        messages: liveId && target.transcript
          ? s.messages.map((m) => (m.id === liveId ? { ...m, provider: ev.provider, model: ev.model } : m))
          : s.messages,
        providerStatus: {
          label: `Calling ${ev.provider ?? target.agentName}/${shortLabel}`,
          detail: typeof ev.turn === 'number' && ev.turn > 0 ? `Retry turn ${ev.turn + 1}` : 'Preparing the request…',
          receivedAt: Date.now(),
        },
      }));
      break;
    }
    case 'text_delta': {
      if (!target.transcript || !liveId || typeof ev.text !== 'string' || !ev.text) break;
      const text = ev.text;
      set((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== liveId) return m;
          const last = m.content[m.content.length - 1];
          if (last && last.type === 'text') {
            return { ...m, content: [...m.content.slice(0, -1), { type: 'text', text: last.text + text }] };
          }
          return { ...m, content: [...m.content, { type: 'text', text }] };
        }),
      }));
      break;
    }
    case 'tool_use_start': {
      if (!ev.tool_use_id || !ev.name) break;
      const toolId = ev.tool_use_id;
      const toolName = ev.name;
      if (!target.toolIds.includes(toolId)) target.toolIds.push(toolId);
      const summary = summarizeTool(toolName, {});
      set((s) => ({
        activity: s.activity.some((item) => item.toolUseId === toolId)
          ? s.activity
          : [
              ...s.activity,
              {
                id: crypto.randomUUID(),
                toolUseId: toolId,
                name: toolName,
                label: `Starting ${toolName}`,
                detail: 'Preparing tool input...',
                category: summary.category,
                status: 'running' as const,
                timestamp: Date.now(),
              },
            ],
      }));
      break;
    }
    case 'tool_use_end': {
      if (!ev.tool_use_id || !ev.name) break;
      const toolId = ev.tool_use_id;
      const toolName = ev.name;
      if (!target.toolIds.includes(toolId)) target.toolIds.push(toolId);
      const summary = summarizeTool(toolName, ev.input);
      set((s) => ({
        messages:
          liveId && target.transcript
            ? s.messages.map((m) =>
                m.id === liveId
                  ? {
                      ...m,
                      // Dedupe: synthesized remote-telemetry blocks already live
                      // in content (start arrived before end) — never double cards.
                      content: m.content.some((b) => b.type === 'tool_use' && (b as { id?: string }).id === toolId)
                        ? m.content
                        : [...m.content, { type: 'tool_use', id: toolId, name: toolName, input: ev.input }],
                    }
                  : m,
              )
            : s.messages,
        activity: s.activity.some((item) => item.toolUseId === toolId)
          ? s.activity.map((item) =>
              item.toolUseId === toolId
                ? { ...item, name: toolName, label: summary.label, detail: summary.detail, category: summary.category }
                : item,
            )
          : [
              ...s.activity,
              {
                id: crypto.randomUUID(),
                toolUseId: toolId,
                name: toolName,
                label: summary.label,
                detail: summary.detail,
                category: summary.category,
                status: 'running' as const,
                timestamp: Date.now(),
              },
            ],
      }));
      break;
    }
    case 'tool_progress': {
      if (!ev.tool_use_id || !ev.name) break;
      const toolId = ev.tool_use_id;
      const toolName = ev.name;
      if (!target.toolIds.includes(toolId)) target.toolIds.push(toolId);
      const summary = summarizeTool(toolName, undefined);
      const status = ev.status === 'completed' ? 'done' : ev.status === 'error' ? 'error' : 'running';
      const detail =
        typeof ev.detail === 'string' && ev.detail ? ev.detail : summary.detail || (status === 'running' ? 'Working…' : 'Completed');
      set((s) => ({
        activity: s.activity.some((item) => item.toolUseId === toolId)
          ? s.activity.map((item) =>
              item.toolUseId === toolId
                ? { ...item, name: toolName, label: summary.label, detail, category: summary.category, status }
                : item,
            )
          : [
              ...s.activity,
              {
                id: crypto.randomUUID(),
                toolUseId: toolId,
                name: toolName,
                label: summary.label,
                detail,
                category: summary.category,
                status,
                timestamp: Date.now(),
              },
            ],
      }));
      break;
    }
    case 'tool_result': {
      if (!ev.tool_use_id) break;
      if (ev.partial) {
        const progressText = typeof ev.content === 'string' ? ev.content : 'Working...';
        set((s) => ({
          activity: s.activity.map((item) =>
            item.toolUseId === ev.tool_use_id ? { ...item, detail: progressText, status: 'running' as const } : item,
          ),
        }));
        break;
      }
      set((s) => ({
        activity: s.activity.map((item) =>
          item.toolUseId === ev.tool_use_id && item.status === 'running'
            ? { ...item, status: ev.is_error ? 'error' : 'done' }
            : item,
        ),
      }));
      break;
    }
    case 'provider_status': {
      if (ev.status === 'failover') {
        set({
          providerStatus: {
            label: 'Switching providers',
            detail: `${ev.from ?? '?'} → ${ev.to ?? '?'}${typeof ev.reason === 'string' && ev.reason ? ` (${ev.reason.slice(0, 220)})` : ''}`,
            receivedAt: Date.now(),
          },
        });
      } else if (ev.status === 'retrying') {
        // Same-model retry: the selection IS being tried — show which model
        // and why, so a retry never looks like a silent stall or skip.
        const who = ev.model ? `${ev.provider ?? 'provider'}/${ev.model}` : (ev.provider ?? 'provider');
        set({
          providerStatus: {
            label: `Retrying ${who}`,
            detail: typeof ev.reason === 'string' ? ev.reason.slice(0, 300) : '',
            receivedAt: Date.now(),
          },
        });
      } else if (typeof ev.status === 'string' && ev.status) {
        set({
          providerStatus: {
            label: `${target.agentName}: ${ev.status}`,
            detail: typeof ev.detail === 'string' ? ev.detail : '',
            receivedAt: Date.now(),
          },
        });
      }
      break;
    }
    case 'message_end': {
      set((s) => ({
        streaming: true,
        messages:
          liveId && target.transcript
            ? s.messages.map((m) =>
                m.id === liveId ? { ...m, stop_reason: ev.stop_reason, usage: ev.usage as Message['usage'] } : m,
              )
            : s.messages,
        providerStatus: null,
      }));
      break;
    }
    case 'message_discard': {
      if (typeof ev.message_id === 'string') {
        const dropId = ev.message_id;
        const dropIdx = target.liveIds.indexOf(dropId);
        if (dropIdx >= 0) target.liveIds.splice(dropIdx, 1);
        if (target.transcript) set((s) => ({ messages: s.messages.filter((m) => m.id !== dropId) }));
      }
      break;
    }
    case 'retrying': {
      const attempt = typeof ev.attempt === 'number' ? ev.attempt : undefined;
      set((s) => ({
        activity: s.activity.map((item) =>
          item.id === target.activityRowId
            ? {
                ...item,
                label: `${target.agentName} is retrying${attempt ? ` (attempt ${attempt})` : ''}`,
                detail: typeof ev.reason === 'string' && ev.reason ? ev.reason.slice(0, 500) : item.detail,
              }
            : item,
        ),
      }));
      break;
    }
    default:
      break;
  }
}

async function handleStreamEvent(ev: { sessionId: string } & StreamEvent, ctx?: { sessionId?: string }) {
  const { setState, getState } = useChatStore;
  const sessionId = ctx?.sessionId ?? ev.sessionId;
  switch (ev.type) {
    case 'message_start': {
      const assistant: Message = {
        id: ev.message_id,
        role: 'assistant',
        content: [],
        timestamp: Date.now(),
      };
      // A task may span several assistant/tool turns. Preserve its completed
      // activity rows so the user can follow the entire run, not only the
      // latest model turn. New sends clear the feed before starting.
      setState((s) => ({ messages: [...s.messages, assistant] }));
      break;
    }
    case 'message_discard': {
      // A provider/model failed before verification. Remove its partial output;
      // recovery continues in the background with another candidate.
      setState((s) => ({ messages: s.messages.filter((message) => message.id !== ev.message_id) }));
      break;
    }
    case 'text_delta': {
      setState((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== ev.message_id) return m;
          const last = m.content[m.content.length - 1];
          if (last && last.type === 'text') {
            return { ...m, content: [...m.content.slice(0, -1), { type: 'text', text: last.text + ev.text }] };
          }
          return { ...m, content: [...m.content, { type: 'text', text: ev.text }] };
        }),
      }));
      break;
    }
    case 'tool_use_start': {
      setState((s) => ({
        activity: [
          ...s.activity,
          {
            id: crypto.randomUUID(),
            toolUseId: ev.tool_use_id,
            name: ev.name,
            label: `Starting ${ev.name}`,
            detail: 'Preparing tool input...',
            category: summarizeTool(ev.name, {}).category,
            status: 'running',
            timestamp: Date.now(),
          },
        ],
      }));
      break;
    }
    case 'tool_use_end': {
      const summary = summarizeTool(ev.name, ev.input);
      setState((s) => ({
        messages: s.messages.map((m) => {
          if (m.id !== ev.message_id) return m;
          const already = m.content.some((b) => b.type === 'tool_use' && (b as { id?: string }).id === ev.tool_use_id);
          return {
            ...m,
            content: already ? m.content : [...m.content, { type: 'tool_use', id: ev.tool_use_id, name: ev.name, input: ev.input }],
          };
        }),
        activity: s.activity.some((item) => item.toolUseId === ev.tool_use_id)
          ? s.activity.map((item) => item.toolUseId === ev.tool_use_id
            ? { ...item, name: ev.name, label: summary.label, detail: summary.detail, category: summary.category }
            : item)
          : [...s.activity, {
              id: crypto.randomUUID(), toolUseId: ev.tool_use_id, name: ev.name,
              label: summary.label, detail: summary.detail, category: summary.category,
              status: 'running' as const, timestamp: Date.now(),
            }],
      }));
      break;
    }
    case 'tool_progress': {
      const summary = summarizeTool(ev.name, ev.input);
      const status = ev.status === 'completed' ? 'done' : ev.status === 'error' ? 'error' : 'running';
      setState((state) => ({
        activity: state.activity.some((item) => item.toolUseId === ev.tool_use_id)
          ? state.activity.map((item) => item.toolUseId === ev.tool_use_id
            ? {
                ...item,
                name: ev.name,
                label: summary.label,
                detail: ev.detail || summary.detail || (status === 'running' ? 'WorkingΓÇª' : 'Completed'),
                category: summary.category,
                status,
              }
            : item)
          : [...state.activity, {
              id: crypto.randomUUID(),
              toolUseId: ev.tool_use_id,
              name: ev.name,
              label: summary.label,
              detail: ev.detail || summary.detail || (status === 'running' ? 'WorkingΓÇª' : 'Completed'),
              category: summary.category,
              status,
              timestamp: Date.now(),
            }],
      }));
      break;
    }
    case 'tool_result': {
      if (ev.partial) {
        const progressText = typeof ev.content === 'string' ? ev.content : 'Working...';
        setState((s) => ({
          activity: s.activity.map((item) => item.toolUseId === ev.tool_use_id
            ? { ...item, detail: progressText, status: 'running' as const }
            : item),
        }));
        break;
      }
      // Auto-create / update sidebar tab when CreateTab or TabBrowser tool returns
      // Also handle AskUserQuestion — render beautiful multi-choice cards
      try {
        const resultContent = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content);
        const parsed = JSON.parse(resultContent);
        if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
          // AskUserQuestion — create a single assistant message with 1-4 question blocks
          const questionBlocks = parsed.questions.map((q: { question: string; header: string; options: Array<{ label: string; description: string }>; multiple?: boolean; questionId: string; allowCustom?: boolean }) => ({
            type: 'question' as const,
            question: q.question,
            header: (q as unknown as { header: string }).header,
            options: q.options,
            multiple: q.multiple,
            allowCustom: q.allowCustom ?? true,
            questionId: q.questionId,
          }));
          const questionMessage: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: questionBlocks,
            timestamp: Date.now(),
          };
          setState((s) => ({ messages: [...s.messages, questionMessage] }));
          persistSessionMessage(sessionId, questionMessage);
          // Mark activity done without adding a raw tool_result bubble
          setState((s) => ({
            activity: s.activity.map((a) => a.toolUseId === ev.tool_use_id && a.status === 'running' ? { ...a, status: 'done' as const } : a),
          }));
          break;
        }
        if (parsed.action === 'create_tab' && parsed.tab) {
          const { useAiTabsStore } = await import('./aiTabs.js');
          const newTab = useAiTabsStore.getState().createTab(parsed.tab);
          if (parsed.tab.kind === 'website' && newTab.id) {
            // Tabs badge will pulse
          }
        } else if (parsed.action === 'update_tab' && parsed.tabId && parsed.patch) {
          const { useAiTabsStore } = await import('./aiTabs.js');
          useAiTabsStore.getState().updateTab(parsed.tabId, parsed.patch);
        } else if (parsed.action === 'navigate_tab' && parsed.tabId && parsed.url) {
          const { useAiTabsStore } = await import('./aiTabs.js');
          useAiTabsStore.getState().updateTab(parsed.tabId, { htmlContent: parsed.url, metadata: { ...(parsed.metadata||{}), browserUrl: parsed.url } });
        }
      } catch {
        // Not a tab/question action — ignore
      }
      const last = getState().messages[getState().messages.length - 1];
      if (!last || last.role !== 'user') {
        setState((s) => ({
          messages: [
            ...s.messages,
            {
              id: crypto.randomUUID(),
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: ev.tool_use_id,
                  content: ev.content as string,
                  is_error: ev.is_error,
                },
              ],
              timestamp: Date.now(),
            },
          ],
        }));
      }
      // Mark the matching live activity as completed (or errored).
      setState((s) => ({
        activity: s.activity.map((a) =>
          a.toolUseId === ev.tool_use_id && a.status === 'running'
            ? { ...a, status: ev.is_error ? 'error' : 'done' }
            : a,
        ),
      }));
      break;
    }
    case 'provider_start': {
      // The agent loop told us it's about to call the model. Show that in
      // the Thinking bubble so the user sees real progress before any token
      // arrives — important for slow free-tier providers that can take 10-30s.
      const modelLabel = ev.model || 'model';
      const shortLabel = ev.provider && modelLabel.startsWith(`${ev.provider}/`)
        ? modelLabel.slice(ev.provider.length + 1)
        : modelLabel;
      setState((state) => ({
        messages: state.messages.map((message) =>
          message.id === ev.message_id
            ? {
                ...message,
                provider: ev.provider,
                model: ev.model,
                requested_provider: ev.requested_provider,
                requested_model: ev.requested_model,
              }
            : message,
        ),
        providerStatus: {
          label: `Calling ${ev.provider}/${shortLabel}`,
          detail: ev.turn > 0 ? `Retry turn ${ev.turn + 1}` : 'Preparing the request…',
          receivedAt: Date.now(),
        },
      }));
      break;
    }
    case 'provider_status': {
      // Lower-level status from inside the provider (network/transport).
      // Map these to human-friendly copy the Thinking bubble can render.
      let label = '';
      let detail = '';
      switch (ev.status) {
        case 'connecting':
          label = `Connecting to ${ev.provider ?? 'the provider'}`;
          detail = ev.model ? `Model: ${ev.model}` : 'Opening the network connectionΓÇª';
          break;
        case 'streaming':
          label = `${ev.provider ?? 'Provider'} is streaming`;
          detail = ev.model ? `Awaiting first token from ${ev.model}` : 'Awaiting first tokenΓÇª';
          break;
        case 'failover':
          label = `Switching providers`;
          detail = `${ev.from} → ${ev.to}${ev.reason ? ` (${ev.reason.slice(0, 220)})` : ''}`;
          break;
        case 'cold_start':
          label = 'Provider is cold-starting';
          detail = 'Free-tier providers can take up to 30s on first call today.';
          break;
        case 'rate_limited':
          label = 'Rate limited';
          detail = 'Waiting for the provider to allow the next request…';
          break;
        case 'retrying': {
          const who = ev.model ? `${ev.provider ?? 'Provider'}/${ev.model}` : (ev.provider ?? 'Provider');
          label = `Retrying ${who}`;
          detail = typeof ev.reason === 'string' ? ev.reason.slice(0, 300) : 'Trying the same model again…';
          break;
        }
      }
      if (label) {
        setState({ providerStatus: { label, detail, receivedAt: Date.now() } });
      }
      break;
    }
    case 'message_end': {
      // A provider turn ended, but tools or verification may still be running;
      // keep the session watchdog active until done/error.
      setState((s) => ({
        // message_end closes one model turn, not the whole agent run. Keep the
        // task steerable while tools execute or another validation turn starts.
        streaming: true,
        messages: s.messages.map((message) =>
          message.id === ev.message_id
            ? {
                ...message,
                stop_reason: ev.stop_reason as Message['stop_reason'],
                usage: ev.usage,
              }
            : message,
        ),
        activity: s.activity,
        // First text/token has landed; clear the placeholder status so the
        // Thinking bubble knows it can stop showing "awaiting responseΓÇª".
        providerStatus: null,
      }));

      // Auto-create files from code blocks in the AI response
      const messages = getState().messages;
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastAssistant) {
        const files = await extractAndCreateFiles(lastAssistant, lastUser ? textFromMessage(lastUser) : '');
        if (files.length > 0) {
          const chatTaskId = activeChatTaskBySession.get(sessionId);
          if (chatTaskId) {
            filesByChatTask.set(chatTaskId, [...(filesByChatTask.get(chatTaskId) ?? []), ...files]);
          }
        }
      }

      // Learn from the completed conversation
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      const lastAssistantMsg = messages[messages.length - 1];

      if (lastUserMsg && lastAssistantMsg && lastAssistantMsg.role === 'assistant') {
        const userInput = lastUserMsg.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(' ');
        const assistantOutput = lastAssistantMsg.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join(' ');

        if (userInput && assistantOutput) {
          const settings2 = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
          await distillInteraction(userInput, assistantOutput, {
            source: settings2.provider === 'ollama' || settings2.provider === 'local' ? 'ollama' : 'api',
            model: settings2.model ?? 'unknown',
            provider: settings2.provider ?? 'unknown',
          });
        }
      }
      break;
    }
    case 'done':
      // Clear safety timer immediately
      clearSafetyTimer(sessionId);
      setState((s) => ({
        streaming: false,
        providerStatus: null,
        activity: s.activity.map((a) =>
          a.status === 'running' ? { ...a, status: ev.success === false ? 'error' : 'done' } : a,
        ),
      }));
      {
        const chatTaskId = activeChatTaskBySession.get(sessionId);
        if (chatTaskId) {
          if (ev.success === false) {
            useAgentsStore.getState().failChatTask(chatTaskId, ev.reason || 'The task ended without verified success.');
          } else {
            useAgentsStore.getState().completeChatTask(chatTaskId, filesByChatTask.get(chatTaskId));
          }
          filesByChatTask.delete(chatTaskId);
          activeChatTaskBySession.delete(sessionId);
        }
      }
      break;
    case 'fallback_required':
    case 'error': {
      // The agent loop attaches the real diagnosis (models tried + last
      // error) as ev.error. That must reach the user verbatim — never hide
      // a model failure behind a substituted local answer.
      clearSafetyTimer(sessionId);
      const realError = typeof ev.error === 'string' && ev.error.trim() ? ev.error.trim() : '';
      if (ev.type === 'error' && !realError) console.error('[stream] Background recovery exhausted:', ev.error);
      if (realError) {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: [{ type: 'text', text: `**The selected model could not complete this request.**\n\n${realError}` }],
          timestamp: Date.now(),
          provider: 'error',
          model: 'provider-failure',
        };
        const currentMessages = getState().messages;
        const lastMessage = currentMessages.at(-1);
        const cleanMessages = lastMessage?.role === 'assistant'
          ? currentMessages.slice(0, -1)
          : currentMessages;
        setState({
          streaming: false,
          providerStatus: null,
          messages: [...cleanMessages, errorMessage],
          activity: getState().activity.map((item) =>
            item.status === 'running' ? { ...item, status: 'done' as const } : item,
          ),
        });
        await window.api.appendSessionMessage({ sessionId, message: errorMessage }).catch(() => undefined);
        const chatTaskId = activeChatTaskBySession.get(sessionId);
        if (chatTaskId) {
          useAgentsStore.getState().failChatTask(chatTaskId, realError);
          filesByChatTask.delete(chatTaskId);
          activeChatTaskBySession.delete(sessionId);
        }
        break;
      }
      if (ev.type === 'error') console.error('[stream] Background recovery exhausted:', ev.error);
      const currentMessages = getState().messages;
      const lastUserMsg = [...currentMessages].reverse().find((message) => message.role === 'user');
      const userInput = lastUserMsg ? textFromMessage(lastUserMsg) : '';
      const fallbackText = userInput
        ? await useBrainStore.getState().generateOfflineResponse(userInput)
        : 'Ready.';
      // Prefix with short provider hint, not the raw error
      const providerHint = ev.type === 'error'
        ? '**The provider timed out or is unavailable.**\n\n'
        : '**Switching to local fallback...**\n\n';
      const fallbackMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: `${providerHint}${fallbackText}` }],
        timestamp: Date.now(),
        provider: 'offline-brain',
        model: 'local-recovery',
      };
      const lastMessage = currentMessages.at(-1);
      const cleanMessages = lastMessage?.role === 'assistant'
        ? currentMessages.slice(0, -1)
        : currentMessages;
      setState({
        streaming: false,
        providerStatus: null,
        messages: [...cleanMessages, fallbackMessage],
        activity: getState().activity.map((item) =>
          item.status === 'running' ? { ...item, status: 'done' as const } : item,
        ),
      });
      await window.api.appendSessionMessage({ sessionId, message: fallbackMessage }).catch(() => undefined);
      if (userInput) {
        await distillInteraction(userInput, fallbackText, {
          source: 'system',
          provider: 'offline-brain',
          model: 'local-recovery',
        });
      }
      const chatTaskId = activeChatTaskBySession.get(sessionId);
      if (chatTaskId) {
        useAgentsStore.getState().completeChatTask(chatTaskId, filesByChatTask.get(chatTaskId));
        filesByChatTask.delete(chatTaskId);
        activeChatTaskBySession.delete(sessionId);
      }
      break;
    }
  }
}
