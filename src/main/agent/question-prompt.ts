// Blocking question cards — the AskUserQuestion tool pauses here until the user
// answers in the renderer. Mirrors permission-prompt.ts: a registry of pending
// requests, an IPC resolver, and a timeout/abort safety net.
//
// Flow:
//   1. Tool calls `askUserQuestions()` → emits a `question_request` event on the
//      chat event bus (renderer renders clickable cards) and blocks on a promise.
//   2. Renderer collects answers per question and invokes CHAT_QUESTION_RESOLVE.
//   3. `resolveUserQuestions()` settles the promise; the tool returns the answers
//      to the model as its tool result — no extra user message round-trip.

import { IPC, QUESTION_TIMEOUT_MS } from '../../shared/ipc.js';
import type { BrowserWindow } from 'electron';

/** Window lookup — injectable for tests (defaults to the focused/first window). */
let getWindow: () => BrowserWindow | null = () => {
  // Lazy require keeps module import side-effect free outside Electron.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { BrowserWindow } = require('electron') as typeof import('electron');
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  } catch {
    return null;
  }
};

/** Test seam: override the target window (pass null to disable IPC push). */
export function setQuestionTargetWindow(fn: () => BrowserWindow | null): void {
  getWindow = fn;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionSpec {
  id: string;
  header: string;
  question: string;
  multiple: boolean;
  options: QuestionOption[];
  allowCustom: boolean;
}

export interface QuestionResolution {
  /** questionId -> user's answer (selected labels joined, or custom text) */
  answers: Record<string, string>;
  /** questionId -> true when the user explicitly skipped that question */
  skipped: Record<string, boolean>;
  /** true when the whole card set timed out or the run was aborted */
  timedOut?: boolean;
}

type Resolver = (resolution: QuestionResolution) => void;

interface PendingRequest {
  id: string;
  questionIds: string[];
  resolve: Resolver;
  timer: ReturnType<typeof setTimeout>;
  onAbort?: () => void;
  signal?: AbortSignal;
}

const pending = new Map<string, PendingRequest>();

/** Emitter for question_request events — wired to the chat event bus in main/index.ts. */
export type QuestionEventEmitter = (event: { type: 'question_request'; request_id: string; questions: QuestionSpec[] }) => void;
let emitter: QuestionEventEmitter | null = null;

export function setQuestionEventEmitter(fn: QuestionEventEmitter | null): void {
  emitter = fn;
}

/**
 * Ask the user 1-4 questions and block until they answer, skip, or the
 * timeout/abort fires. Never throws: on timeout/abort it resolves with
 * `timedOut: true` so the tool can degrade gracefully.
 */
export async function askUserQuestions(
  questions: Array<Omit<QuestionSpec, 'id'>>,
  opts: { sessionId: string; signal?: AbortSignal; timeoutMs?: number } = { sessionId: '' },
): Promise<QuestionResolution> {
  const specs: QuestionSpec[] = questions.slice(0, 4).map((q, i) => ({
    ...q,
    id: `q-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
    options: q.options.slice(0, 5),
  }));
  if (specs.length === 0) {
    return { answers: {}, skipped: {}, timedOut: true };
  }

  const id = crypto.randomUUID();
  const target = getWindow();

  return new Promise<QuestionResolution>((resolve) => {
    let settled = false;
    const settle = (resolution: QuestionResolution) => {
      if (settled) return;
      settled = true;
      clearTimeout(entry.timer);
      opts.signal?.removeEventListener('abort', onAbort);
      pending.delete(id);
      resolve(resolution);
    };
    const onAbort = () => settle({ answers: {}, skipped: {}, timedOut: true });
    const timer = setTimeout(() => settle({ answers: {}, skipped: {}, timedOut: true }), opts.timeoutMs ?? QUESTION_TIMEOUT_MS);
    const entry: PendingRequest = {
      id,
      questionIds: specs.map((q) => q.id),
      resolve: settle,
      timer,
      signal: opts.signal,
    };
    pending.set(id, entry);
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    if (target) {
      // Spread the event into the payload, do NOT nest it under `event`.
      //
      // Every other producer on this channel (plan-mode-events, todo-store,
      // whatsapp-link, evolution-loop, the main chat loop) sends
      // `{ sessionId, ...event }`, and the renderer listener reads
      // `payload.type` to switch on. This one nested the event instead, so
      // `payload.type` was undefined, the store fell through its switch, and
      // the answer cards never rendered — the agent would block on a question
      // the user could never see. Keep this in step with the other producers.
      target.webContents.send(IPC.CHAT_STREAM_EVENT, {
        sessionId: opts.sessionId,
        type: 'question_request',
        request_id: id,
        questions: specs,
      });
    }
    try {
      emitter?.({ type: 'question_request', request_id: id, questions: specs });
    } catch { /* emitter must never break the ask */ }
  });
}

/**
 * Resolve a pending question set. Returns false when the id is unknown
 * (already resolved, timed out, or stale renderer).
 * The request only settles once EVERY question has an answer or an explicit skip.
 */
export function resolveUserQuestions(id: string, resolution: { answers?: Record<string, string>; skipped?: Record<string, boolean> }): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  const answers = resolution.answers ?? {};
  const skipped = resolution.skipped ?? {};
  const allAnswered = entry.questionIds.every((qid) => answers[qid] !== undefined || skipped[qid]);
  if (!allAnswered) return false; // partial answers: keep waiting for the rest
  entry.resolve({ answers, skipped });
  return true;
}

/** Test/teardown hook: drop every pending request. */
export function clearPendingQuestions(): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    entry.resolve({ answers: {}, skipped: {}, timedOut: true });
  }
  pending.clear();
}
