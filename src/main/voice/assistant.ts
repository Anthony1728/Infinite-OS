import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface VoiceConfig {
  language: string;
  rate: number;
  pitch: number;
  volume: number;
  autoSpeak: boolean;
  wakeWord: string;
  voice: string;
  /** Local Faster-Whisper model used by the on-device dictation pipeline. */
  sttModel: string;
}

/**
 * Models the local Faster-Whisper engine will accept. Mirrors the server's
 * allow-list — an unknown value would reach Python and fail at load time.
 */
export const KNOWN_STT_MODELS = [
  'tiny',
  'tiny.en',
  'base',
  'base.en',
  'small',
  'small.en',
  'medium',
  'large-v3',
  'distil-large-v3',
] as const;

export interface VoiceCustomCommand {
  id: string;
  trigger: string;
  action: string;
}

export interface VoiceHistoryEntry {
  id: string;
  transcript: string;
  intent: string;
  response?: string;
  timestamp: number;
}

export type VoiceIntent = 'wake_word_detected' | 'custom_command' | 'stop_listening' | 'chat';

export interface VoiceProcessResult {
  intent: VoiceIntent;
  text: string;
  response?: string;
  trigger?: string;
}

export interface VoiceAssistantState {
  config: VoiceConfig;
  customCommands: VoiceCustomCommand[];
  history: VoiceHistoryEntry[];
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  language: 'en-US',
  rate: 1,
  pitch: 1,
  volume: 1,
  autoSpeak: true,
  wakeWord: 'hey infinite',
  voice: 'ava',
  sttModel: 'base.en',
};

const HISTORY_LIMIT = 200;
const STOP_EXACT = /^(stop( listening| dictation| mic(ophone)?)?|mute|be quiet|quiet( down)?|silence)$/i;

function voiceDir(): string {
  return join(infiniteHome(), 'voice');
}

function statePath(): string {
  return join(voiceDir(), 'assistant.json');
}

function freshState(): VoiceAssistantState {
  return { config: { ...DEFAULT_VOICE_CONFIG }, customCommands: [], history: [] };
}

function readState(): VoiceAssistantState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<VoiceAssistantState>;
    const config: VoiceConfig = { ...DEFAULT_VOICE_CONFIG, ...(parsed.config ?? {}) };
    // Older persisted configs predate sttModel (or carry a stale one).
    config.sttModel = normalizeSttModel(config.sttModel, DEFAULT_VOICE_CONFIG.sttModel);
    return {
      config,
      customCommands: Array.isArray(parsed.customCommands) ? parsed.customCommands : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return freshState();
  }
}

function writeState(next: VoiceAssistantState): void {
  const dir = voiceDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(next, null, 2), 'utf8');
}

let cached: VoiceAssistantState | null = null;

function state(): VoiceAssistantState {
  if (!cached) cached = readState();
  return cached;
}

export function resetVoiceAssistantForTests(): void {
  cached = null;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(num, min), max);
}

/** Reject anything the local engine would refuse at load time. */
function normalizeSttModel(value: unknown, fallback: string): string {
  const raw = String(value ?? '').trim();
  if ((KNOWN_STT_MODELS as readonly string[]).includes(raw)) return raw;
  if ((KNOWN_STT_MODELS as readonly string[]).includes(fallback)) return fallback;
  return DEFAULT_VOICE_CONFIG.sttModel;
}

export function getVoiceConfig(): VoiceConfig {
  return { ...state().config };
}

export function setVoiceConfig(patch: Partial<VoiceConfig>): VoiceConfig {
  const current = state().config;
  const merged = { ...current, ...patch };
  const next: VoiceConfig = {
    language: String(merged.language || current.language).slice(0, 16),
    rate: clamp(merged.rate, 0.5, 2, current.rate),
    pitch: clamp(merged.pitch, 0.5, 2, current.pitch),
    volume: clamp(merged.volume, 0, 1, current.volume),
    autoSpeak: merged.autoSpeak !== false,
    wakeWord: String(merged.wakeWord ?? current.wakeWord).trim().slice(0, 64) || current.wakeWord,
    voice: String(merged.voice ?? current.voice).trim().slice(0, 64),
    sttModel: normalizeSttModel(merged.sttModel, current.sttModel),
  };
  state().config = next;
  writeState(state());
  return { ...next };
}

export function listCustomCommands(): VoiceCustomCommand[] {
  return [...state().customCommands];
}

export function addCustomCommand(trigger: string, action: string): VoiceCustomCommand[] {
  const trimmedTrigger = trigger.trim();
  const trimmedAction = action.trim();
  if (!trimmedTrigger || !trimmedAction) return listCustomCommands();
  const s = state();
  s.customCommands = s.customCommands.filter(
    (cmd) => cmd.trigger.toLowerCase() !== trimmedTrigger.toLowerCase(),
  );
  s.customCommands.push({
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: trimmedTrigger,
    action: trimmedAction,
  });
  writeState(s);
  return listCustomCommands();
}

export function removeCustomCommand(trigger: string): VoiceCustomCommand[] {
  const key = trigger.trim().toLowerCase();
  if (!key) return listCustomCommands();
  const s = state();
  s.customCommands = s.customCommands.filter(
    (cmd) => cmd.id !== trigger && cmd.trigger.toLowerCase() !== key,
  );
  writeState(s);
  return listCustomCommands();
}

export function listHistory(): VoiceHistoryEntry[] {
  return [...state().history];
}

export function clearHistory(): void {
  const s = state();
  s.history = [];
  writeState(s);
}

function pushHistory(transcript: string, intent: string, response?: string): void {
  const s = state();
  s.history.push({
    id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    transcript,
    intent,
    ...(response ? { response } : {}),
    timestamp: Date.now(),
  });
  if (s.history.length > HISTORY_LIMIT) s.history = s.history.slice(-HISTORY_LIMIT);
  writeState(s);
}

export function processTranscript(raw: string): VoiceProcessResult {
  const text = (raw ?? '').trim();
  if (!text) return { intent: 'chat', text: '' };

  const wake = (state().config.wakeWord || DEFAULT_VOICE_CONFIG.wakeWord).toLowerCase();
  const lower = text.toLowerCase();

  let commandText = text;
  let woke = false;
  if (wake && lower.includes(wake)) {
    woke = true;
    const index = lower.indexOf(wake);
    commandText = text.slice(index + wake.length).replace(/^[\s,.!?;:'"]+/, '').trim();
    if (!commandText) {
      const response = 'Yes? Listening.';
      pushHistory(text, 'wake_word_detected', response);
      return { intent: 'wake_word_detected', text, response };
    }
  }

  if (STOP_EXACT.test(text) || (woke && STOP_EXACT.test(commandText))) {
    const response = 'Stopped listening.';
    pushHistory(text, 'stop_listening', response);
    return { intent: 'stop_listening', text, response };
  }

  const haystack = commandText.toLowerCase();
  for (const cmd of state().customCommands) {
    const trigger = cmd.trigger.trim().toLowerCase();
    if (trigger && haystack.includes(trigger)) {
      pushHistory(text, 'custom_command', cmd.action);
      return {
        intent: 'custom_command',
        text: commandText,
        trigger: cmd.trigger,
        response: cmd.action,
      };
    }
  }

  pushHistory(text, 'chat');
  return { intent: 'chat', text: commandText };
}
