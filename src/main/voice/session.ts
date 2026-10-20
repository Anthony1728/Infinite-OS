// Always-on voice — the agent keeps listening with the Voice view closed.
//
// The whole conversation loop used to live inside VoiceView, which meant the mic
// died the moment you navigated away and the AI could only hear you on one
// screen. This moves the loop into the main process: it owns the microphone,
// routes utterances through the same wake-word/command router the view used,
// runs the SAME agent turn (`runAgent`, so tools and permissions behave
// identically), streams progress into the UI from anywhere, and speaks the reply.
//
// The renderer is now purely an observer: a floating HUD shows the live state in
// any view, and the Voice Assistant page is the detailed surface for the same
// session. Both listen to these events, so there is one conversation and one
// microphone no matter where you are.
//
// Modelled on TelegramInbound (`messaging/telegram-inbound.ts`) — the existing
// always-on service in this app: settings-gated, idempotent start/stop, a
// persisted config file, and unref'd timers so it never holds the app open.

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { getLocalVoice, isLocalVoiceScriptAvailable } from './local-voice.js';
import { windowsDictation } from './windows-dictation.js';
import { getVoiceConfig, processTranscript, listHistory } from './assistant.js';
import { getVoiceAsync } from './index.js';
import { runAgent } from '../agent/loop.js';
import { resolveActiveModel, type ActiveModel } from '../agent/active-model.js';
import {
  appendMessage,
  createSession,
  listSessions,
  loadMessages,
  loadSessionMeta,
} from '../session/store.js';
import { extractSpeakableSentences, spokenReplyText } from '../../shared/voice-text.js';
import { settings } from '../settings/store.js';
import {
  narrateResult,
  resolveCommunicationModel,
  type CommunicationModel,
  type ToolActivity,
} from './narration.js';

export type VoicePhase = 'idle' | 'starting' | 'listening' | 'thinking' | 'speaking' | 'error';

export interface VoiceSessionState {
  /** True when the background loop is armed (setting on). */
  enabled: boolean;
  /** True while the mic is actually capturing. */
  listening: boolean;
  phase: VoicePhase;
  /** Interim text as it is recognised. */
  interim: string;
  /** Which engine won: local Whisper, Windows dictation, or none. */
  engine: 'local-whisper' | 'windows-local' | null;
  wakeWord: string;
  /** Last error, already phrased for a human. */
  error: string | null;
  /** Session the conversation is stored under. */
  sessionId: string;
  /** Set while a reply is being spoken. */
  speaking: boolean;
  muted: boolean;
  /** The fast model chosen to speak, when the split is in use. */
  communicationModel: { provider: string; model: string } | null;
}

const SETTING_KEY = 'alwaysOnVoice';
/** Silence that ends a spoken turn. Mirrors the view's LOCAL_SILENCE_MS. */
const SILENCE_MS = 1400;
/** Longest single turn before the agent is cut off. */
const TURN_BUDGET_MS = 180_000;
const TURN_MAX_TURNS = 24;

type Events = {
  state: [VoiceSessionState];
  /** A final utterance was heard and accepted for routing. */
  utterance: [{ text: string; at: number }];
  /** The agent started/finished a reply. */
  reply: [{ sessionId: string; streaming: boolean }];
};

class VoiceSession extends EventEmitter<Events> {
  private state: VoiceSessionState = {
    enabled: false,
    listening: false,
    phase: 'idle',
    interim: '',
    engine: null,
    wakeWord: 'hey infinite',
    error: null,
    sessionId: 'voice',
    speaking: false,
    muted: false,
    communicationModel: null,
  };

  private running = false;
  private unsubLocal: (() => void) | null = null;
  private lastSpeechAt = 0;
  private stableText = '';
  private stableSince = 0;
  private submitted = false;
  private busy = false;
  private settingsWatch: (() => void) | null = null;
  private speechQueue: string[] = [];
  private pumping = false;
  private speechConsumed = new Map<string, number>();
  private speechPending = '';
  /** Raw prose from the work model, held back when a narrator will speak it. */
  private rawAnswer = '';
  /** Real tool activity for the current turn, used to build the narration. */
  private activity: ToolActivity[] = [];
  /** Chosen communication model for this turn, or null to speak directly. */
  private communication: CommunicationModel | null = null;
  private narrationActive = false;
  private lastUserText = '';
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  getState(): VoiceSessionState {
    return { ...this.state };
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Read the persisted preference. Absent or malformed means off. */
  isEnabled(): boolean {
    try {
      return settings.get<boolean>(SETTING_KEY) === true;
    } catch {
      return false;
    }
  }

  /** Persist the preference. Turning on also starts the loop. */
  async setEnabled(enabled: boolean, cwd = '.'): Promise<VoiceSessionState> {
    try {
      await settings.set('user', SETTING_KEY, enabled, cwd);
    } catch {
      // A settings write that fails must not leave the loop running unowned.
      this.patch({ error: 'Could not save the always-on voice preference.' });
    }
    if (enabled) await this.start();
    else this.stop();
    return this.getState();
  }

  /** Arm the loop if the setting says so. Safe to call repeatedly. */
  async init(): Promise<void> {
    this.watchSetting();
    if (this.isEnabled()) {
      // Never block app start on a microphone.
      void this.start().catch(() => undefined);
    }
  }

  /** Hot-reload: flipping the setting in the UI takes effect immediately. */
  private watchSetting(): void {
    if (this.settingsWatch) return;
    let last = this.isEnabled();
    // The settings store is file-backed with chokidar; polling is the cheapest
    // way to notice a change made by any surface (Settings modal, phone, CLI).
    const tick = () => {
      const now = this.isEnabled();
      if (now === last) return;
      last = now;
      if (now) void this.start().catch(() => undefined);
      else this.stop();
    };
    const handle = setInterval(tick, 2_000);
    handle.unref?.();
    this.settingsWatch = () => clearInterval(handle);
  }

  async start(): Promise<VoiceSessionState> {
    if (this.running) return this.getState();
    this.running = true;
    this.patch({ enabled: true, phase: 'starting', error: null });

    const cfg = getVoiceConfig();
    this.patch({ wakeWord: cfg.wakeWord || 'hey infinite' });

    try {
      await getVoiceAsync();
      // Warm both models while the user is still doing something else, so the
      // first utterance doesn't pay a multi-second load.
      void getVoiceAsync().then((v) => {
        void v.warmupLocalStt();
        void v.warmupLocalTts();
      }).catch(() => undefined);
    } catch {
      /* voice still works with local engines */
    }

    const hasLocal = isLocalVoiceScriptAvailable();
    try {
      if (hasLocal) {
        // Subscribe BEFORE start: the server emits `ready` as part of starting.
        this.unsubLocal = getLocalVoice().onEvent((event) => this.onLocalEvent(event));
        const result = await getLocalVoice().start({
          language: cfg.language,
          model: cfg.sttModel,
          hotwords: cfg.wakeWord,
        });
        this.patch({ engine: 'local-whisper', listening: result.ok !== false, phase: result.ok === false ? 'error' : 'listening' });
        if (result.ok === false) throw new Error(result.error ?? 'Local voice engine refused to start.');
      } else {
        this.patch({ engine: 'windows-local' });
        await this.startWindowsDictation();
      }
      this.patch({ error: null });
      this.startIdleWatch();
      // Know the conversation id immediately so the UI can bind to it.
      void this.resolveSession();
      return this.getState();
    } catch (error) {
      // Local Whisper failed — fall back to Windows dictation rather than going
      // dark, exactly like the IPC handler does.
      this.unsubLocal?.();
      this.unsubLocal = null;
      try {
        this.patch({ engine: 'windows-local' });
        await this.startWindowsDictation();
        this.patch({ error: null, phase: 'listening' });
        this.startIdleWatch();
        void this.resolveSession();
        return this.getState();
      } catch (fallbackError) {
        this.patch({
          phase: 'error',
          error: `No dictation engine available: ${(error as Error).message} / ${(fallbackError as Error).message}`,
        });
        this.running = false;
      }
    }
    return this.getState();
  }

  private async startWindowsDictation(): Promise<void> {
    const cfg = getVoiceConfig();
    const result = await windowsDictation.start((event) => this.onDictationEvent(event as never));
    if (!result.ok) throw new Error(result.error ?? 'Windows dictation refused to start.');
    this.patch({ listening: true, phase: 'listening', error: null });
    void cfg;
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.abort?.abort();
    this.abort = null;
    this.speechQueue = [];
    this.speechPending = '';
    this.speechConsumed.clear();
    this.unsubLocal?.();
    this.unsubLocal = null;
    // windowsDictation owns a single listener set per start() and clears it on
    // stop(), so there is nothing to unsubscribe here.
    void getLocalVoice().stop().catch(() => undefined);
    try { windowsDictation.stop(); } catch { /* already stopped */ }
    this.patch({ enabled: false, listening: false, phase: 'idle', interim: '', engine: null, speaking: false });
  }

  /** Stop listening but stay armed — "pause", not "turn off". */
  pause(): void {
    if (!this.running) return;
    void getLocalVoice().stop().catch(() => undefined);
    try { windowsDictation.stop(); } catch { /* already stopped */ }
    this.patch({ listening: false, phase: 'idle', interim: '' });
  }

  async resume(): Promise<VoiceSessionState> {
    if (!this.running) return this.start();
    const cfg = getVoiceConfig();
    try {
      if (isLocalVoiceScriptAvailable()) {
        this.unsubLocal ??= getLocalVoice().onEvent((event) => this.onLocalEvent(event));
        const result = await getLocalVoice().start({
          language: cfg.language,
          model: cfg.sttModel,
          hotwords: cfg.wakeWord,
        });
        if (result.ok === false) throw new Error(result.error ?? 'Local voice engine refused to start.');
        this.patch({ engine: 'local-whisper', listening: true, phase: 'listening' });
      } else {
        await this.startWindowsDictation();
      }
      this.patch({ error: null });
      this.startIdleWatch();
    } catch (error) {
      this.patch({ phase: 'error', error: (error as Error).message });
    }
    return this.getState();
  }

  /** Speak a line immediately (used for wake/stop/command acknowledgements). */
  async say(text: string): Promise<void> {
    if (!text.trim() || this.state.muted) return;
    this.patch({ speaking: true, phase: 'speaking' });
    try {
      const voice = await getVoiceAsync();
      const { buffer } = await voice.synthesizeWithProvider(text);
      // `synthesizeWithProvider` already guards against a silent provider; play
      // it here rather than in the renderer so it works with no window focused.
      const { spawn } = await import('node:child_process');
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const file = join(tmpdir(), `infinite-voice-${randomUUID()}.wav`);
      writeFileSync(file, buffer);
      await new Promise<void>((resolve) => {
        const player = spawn('powershell.exe', [
          '-NoProfile',
          '-Command',
          `(New-Object Media.SoundPlayer '${file}').PlaySync()`,
        ], { windowsHide: true });
        player.on('close', () => resolve());
        player.on('error', () => resolve());
      });
      try { unlinkSync(file); } catch { /* best effort */ }
    } catch (error) {
      this.fail(`Could not speak: ${(error as Error).message}`);
    } finally {
      this.patch({ speaking: false });
    }
  }

  /** Stop the current reply and drop anything queued behind it. */
  interrupt(): void {
    this.speechQueue = [];
    this.speechPending = '';
    this.abort?.abort();
  }

  private onLocalEvent(event: { type: string; transcript?: string; message?: string; error?: string }): void {
    if (event.type === 'ready') {
      this.patch({ listening: true, phase: 'listening', error: null });
      return;
    }
    if (event.type === 'result' && event.transcript) {
      // The Python server is VAD-gated, so a result is a whole utterance.
      this.lastSpeechAt = Date.now();
      this.patch({ interim: event.transcript });
      this.stableText = event.transcript;
      this.stableSince = Date.now();
      this.submitted = false;
      return;
    }
    if (event.type === 'error') {
      this.fail(event.message ?? event.error ?? 'The local voice engine reported an error.');
      return;
    }
    if (event.type === 'ended') {
      this.patch({ listening: false, phase: this.state.phase === 'listening' ? 'idle' : this.state.phase });
    }
  }

  private onDictationEvent(event: {
    type: string; transcript?: string; final?: boolean; message?: string;
  }): void {
    if (event.type === 'ready') {
      this.patch({ listening: true, phase: 'listening', error: null });
      return;
    }
    if (event.type === 'result' && event.transcript) {
      this.lastSpeechAt = Date.now();
      if (event.final) {
        this.patch({ interim: '' });
        void this.handleUtterance(event.transcript);
      } else {
        this.patch({ interim: event.transcript });
      }
      return;
    }
    if (event.type === 'error') {
      this.fail(event.message ?? 'Windows dictation reported an error.');
    }
    if (event.type === 'ended') {
      this.patch({ listening: false });
    }
  }

  /**
   * Fallback turn-end detection for engines that stream rather than VAD-gate:
   * submit once the transcript has stopped changing for a beat.
   */
  private startIdleWatch(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.running || this.submitted || this.busy) return;
      const text = this.state.interim.trim();
      if (!text) return;
      const now = Date.now();
      if (text !== this.stableText) {
        this.stableText = text;
        this.stableSince = now;
        return;
      }
      const settled = now - Math.max(this.lastSpeechAt, this.stableSince);
      if (settled >= SILENCE_MS) {
        this.submitted = true;
        void this.handleUtterance(text);
      }
    }, 250);
    this.timer.unref?.();
  }

  private async handleUtterance(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text || this.busy) return;
    this.patch({ interim: '' });

    let routed: Awaited<ReturnType<typeof processTranscript>> | null = null;
    try {
      routed = await processTranscript(text);
    } catch {
      routed = null;
    }
    if (!routed) {
      // The router is unavailable — treat the utterance as plain chat rather
      // than dropping what the user just said on the floor.
      routed = { intent: 'chat', text };
    }

    this.emit('utterance', { text: routed.text || text, at: Date.now() });

    if (routed.intent === 'stop_listening') {
      await this.say(routed.response ?? 'Stopped listening.');
      this.pause();
      return;
    }
    if (routed.intent === 'wake_word_detected') {
      await this.say(routed.response ?? 'Yes? Listening.');
      return;
    }
    if (routed.intent === 'custom_command') {
      await this.say(routed.response ?? `Ran ${routed.trigger ?? ''}`);
      listHistory(); // keep the file fresh for the view
      return;
    }

    await this.runTurn(routed.text || text);
  }

  /** One full agent turn: same pipeline, same permissions, same tools as chat. */
  private async runTurn(userText: string): Promise<void> {
    this.busy = true;
    this.patch({ phase: 'thinking', error: null });
    const controller = new AbortController();
    this.abort = controller;
    const budget = setTimeout(() => controller.abort(), TURN_BUDGET_MS);
    budget.unref?.();

    try {
      const model = resolveActiveModel((key) => settings.get(key));
      const cwd = model.cwd || '.';
      const sessionId = await this.ensureSession(model);

      // Optional communication-model split: a fast model speaks, the model above
      // does the work. When none is chosen this is null and nothing changes.
      this.communication = resolveCommunicationModel(model);
      this.narrationActive = this.communication !== null;
      this.rawAnswer = '';
      this.activity = [];
      this.lastUserText = userText;
      this.patch({ communicationModel: this.communication });

      // Never resurrect a session the user deleted.
      if (!(await loadSessionMeta(sessionId))) {
        this.patch({ phase: 'error', error: 'The voice session no longer exists.' });
        return;
      }

      const history = (await loadMessages(sessionId)).slice(-24);
      const userMessage = {
        id: randomUUID(),
        role: 'user' as const,
        content: [{ type: 'text' as const, text: userText }],
        timestamp: Date.now(),
      };
      await appendMessage(sessionId, userMessage);

      // Seed the transcript before the first token, so a background turn that
      // begins while the user is on another view still shows what they said.
      await this.mirrorToDesktop(sessionId, {
        type: 'user_message',
        message: userMessage,
      });

      this.emit('reply', { sessionId, streaming: true });
      const completed = await runAgent(history, userMessage, {
        sessionId,
        cwd,
        provider: model.provider,
        model: model.model,
        signal: controller.signal,
        maxTurns: TURN_MAX_TURNS,
        wallClockMs: TURN_BUDGET_MS,
        onEvent: (event) => this.onAgentEvent(sessionId, event),
      });

      for (const message of completed.slice(history.length + 1)) {
        await appendMessage(sessionId, message);
      }
      this.emit('reply', { sessionId, streaming: false });
    } catch (error) {
      const message = (error as Error).message || String(error);
      // An abort is the user talking over the AI, not a failure.
      if (controller.signal.aborted) {
        this.emit('reply', { sessionId: this.state.sessionId, streaming: false });
      } else {
        this.fail(`Voice turn failed: ${message}`);
      }
    } finally {
      clearTimeout(budget);
      this.abort = null;
      this.busy = false;
      if (this.running && this.state.listening) this.patch({ phase: 'listening' });
    }
  }

  /**
   * Streamed reply → speech, and → the desktop chat stream.
   *
   * The mirroring is what makes a background turn visible: the agent runs in
   * main, so without it the transcript stays empty and the user only finds out
   * what the AI did by hearing it speak. Same channel the phone-companion
   * WhatsApp path already uses, so the Voice page renders tool calls and code
   * exactly as chat does.
   */
  private onAgentEvent(sessionId: string, event: { type: string; text?: string; delta?: string; message?: string }): void {
    void this.mirrorToDesktop(sessionId, event);
    // Record what actually ran, so the narration can report it truthfully
    // instead of describing what we hoped happened.
    if (event.type === 'tool_use_start') {
      const name = (event as { name?: string }).name;
      if (name) this.activity.push({ name, detail: '', status: 'running' });
    } else if (event.type === 'tool_use_end') {
      const pending = [...this.activity].reverse().find((a) => a.status === 'running');
      if (pending) pending.status = 'done';
    } else if (event.type === 'tool_result') {
      const pending = [...this.activity].reverse().find((a) => a.status === 'running');
      if (pending) pending.status = (event as { is_error?: boolean }).is_error ? 'error' : 'done';
    }
    if (event.type === 'text_delta') {
      const delta = event.delta ?? event.text ?? '';
      if (!delta) return;
      // With a communication model chosen, the work model's prose is written for
      // reading, not hearing. Hold it back and let the narrator speak instead.
      if (this.narrationActive) {
        this.rawAnswer += delta;
        return;
      }
      this.speechPending += delta;
      const { chunks, consumed } = extractSpeakableSentences(this.speechPending);
      if (consumed > 0) this.speechPending = this.speechPending.slice(consumed);
      if (chunks.length > 0) {
        this.speechQueue.push(...chunks);
        void this.pumpSpeech();
      }
      return;
    }
    if (event.type === 'message_end' || event.type === 'done' || event.type === 'error') {
      if (this.narrationActive) {
        // The work model is done. Speak what actually happened, told by the
        // communication model, built from the real tool activity.
        this.speechPending = '';
        void this.speakNarration(event.type === 'error' ? event.message : undefined);
        return;
      }
      // Flush whatever was held back mid-sentence so nothing is lost.
      const tail = spokenReplyText(this.speechPending).trim();
      if (tail) this.speechQueue.push(tail);
      this.speechPending = '';
      void this.pumpSpeech();
      if (event.type === 'error' && event.message) this.fail(event.message);
      return;
    }
    if (event.type === 'message_start') {
      this.speechConsumed.clear();
      this.speechPending = '';
      this.rawAnswer = '';
    }
  }

  /**
   * Speak the turn through the communication model.
   *
   * Built from the tools that actually ran, never from what we hoped happened,
   * and it falls back to the work model's own words if narration is unavailable
   * — the user must always hear something.
   */
  private async speakNarration(failure?: string): Promise<void> {
    const communication = this.communication;
    // The activity was already accumulated field-by-field as events arrived, so
    // it is used directly rather than re-derived.
    const activity = this.activity;
    const answer = this.rawAnswer.trim();
    this.activity = [];
    if (!communication) {
      if (answer) {
        this.speechQueue.push(...extractSpeakableSentences(answer).chunks);
        void this.pumpSpeech();
      }
      return;
    }
    this.patch({ phase: 'speaking' });
    const spoken = await narrateResult({
      communication,
      userText: this.lastUserText,
      activity,
      answer,
      failure,
    });
    this.speechQueue.push(...extractSpeakableSentences(spoken).chunks);
    void this.pumpSpeech();
  }

  /**
   * Forward a run event to every open window on the chat stream channel. This
   * is the same mirroring the phone-companion WhatsApp path does, and it is
   * best-effort: no window (or no Electron at all, under tests) is not an error.
   */
  private async mirrorToDesktop(sessionId: string, event: unknown): Promise<void> {
    try {
      const { BrowserWindow } = await import('electron');
      const { IPC } = await import('../../shared/ipc.js');
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) continue;
        win.webContents.send(IPC.CHAT_STREAM_EVENT, {
          sessionId,
          ...(event as Record<string, unknown>),
        });
      }
    } catch {
      // Mirroring is a convenience — never let it break a voice turn.
    }
  }

  /** Sequential, re-entrancy-guarded playback of the speech queue. */
  private async pumpSpeech(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.speechQueue.length > 0 && this.running && !this.state.muted) {
        const chunk = this.speechQueue.shift();
        if (!chunk) break;
        await this.say(chunk);
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * One stable session for the always-on conversation, so history accumulates
   * instead of fragmenting a new session per turn. Sessions carry their own
   * cwd/model/provider, so it is created from the same resolved model a turn
   * would use.
   */
  private async ensureSession(model: ActiveModel): Promise<string> {
    const sessions = await listSessions();
    const found = sessions.find((s) => s.title === 'Voice');
    if (found) {
      this.patch({ sessionId: found.id });
      return found.id;
    }
    const created = await createSession({
      cwd: model.cwd || '.',
      model: model.model,
      provider: model.provider,
      title: 'Voice',
    });
    this.patch({ sessionId: created.id });
    return created.id;
  }

  /**
   * Bind the session id as soon as the loop arms, not on the first utterance.
   * The Voice page uses it to bind the transcript to the right conversation
   * before any turn happens, so a background reply lands in the transcript the
   * user is already looking at instead of being silently written to disk.
   */
  private async resolveSession(): Promise<void> {
    try {
      const model = resolveActiveModel((key) => settings.get(key));
      await this.ensureSession(model);
    } catch {
      // Leave the placeholder id; the first turn resolves it again.
    }
  }

  private fail(message: string): void {
    this.patch({ error: message });
    if (this.errorTimer) clearTimeout(this.errorTimer);
    // Errors clear themselves so a stale warning can't sit on the HUD forever.
    this.errorTimer = setTimeout(() => this.patch({ error: null }), 8000);
    this.errorTimer.unref?.();
  }

  private patch(next: Partial<VoiceSessionState>): void {
    this.state = { ...this.state, ...next };
    this.emit('state', this.getState());
  }

  /** Release everything — called on app quit. */
  dispose(): void {
    this.stop();
    if (this.settingsWatch) {
      this.settingsWatch();
      this.settingsWatch = null;
    }
    this.removeAllListeners();
  }
}

export const voiceSession = new VoiceSession();