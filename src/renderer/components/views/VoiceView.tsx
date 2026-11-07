// Voice conversation tab — talk to Infinite AI and have it talk back.
//
// Parity with the chat interface comes from routing every utterance through
// the same chat store pipeline (same provider, model, tools, sessions). The
// speech side is deliberately provider-flexible: local Windows dictation
// works with no key at all, a keyless local Whisper handles buffered audio,
// and replies are spoken by the TTS chain (local Piper → OpenAI →
// OpenRouter → Edge TTS → browser voice) with every key optional.
// OpenRouter TTS rides the OpenRouter key saved in Settings → Providers;
// its model slug is chosen below (slugs aren't enumerable via /models, so
// the input holds suggestions rather than a live list).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Command, Loader2, Mic, MicOff, Plus, Settings, Square, Trash2, Volume2, VolumeX } from 'lucide-react';
import { useVoiceAssistant } from '../../hooks/useVoiceAssistant';
import { useChatStore } from '../../stores/chat';
import { InfiniteLogo } from '../brand/InfiniteLogo';
import { CodeBlock } from '../chat/CodeBlock';
import { MermaidDiagram } from '../chat/MermaidDiagram';
import { ToolCallCard } from '../tools/ToolCallCard';
import { useVoiceSessionStore } from '../../stores/voice-session';
import {
  audioDataMime,
  contentToPlainText,
  extractSpeakableSentences,
  isSilentCapture,
  isUtteranceComplete,
  spokenReplyText,
  speakWithBrowserVoice,
  ttsProviderLabel,
} from '../../lib/voiceConversation';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';
type SttMode = 'auto' | 'local' | 'cloud';
type TtsMode = 'local' | 'kokoro' | 'auto' | 'openrouter' | 'openai' | 'edge';

interface VoicePanelConfig {
  sttMode: SttMode;
  ttsMode: TtsMode;
  ttsModel: string;
  voice: string;
  muted: boolean;
  autoContinue: boolean;
  // Browser-fallback speech shaping (also scales main-process audio volume).
  rate: number;
  pitch: number;
  volume: number;
}

interface VoiceCustomCommand {
  id: string;
  trigger: string;
  action: string;
}

interface VoiceHistoryEntry {
  id: string;
  transcript: string;
  intent: string;
  response?: string;
  timestamp: number;
}

interface VoiceProcessResult {
  intent: 'wake_word_detected' | 'custom_command' | 'stop_listening' | 'chat';
  text: string;
  response?: string;
  trigger?: string;
}

/** Local Faster-Whisper models the offline engine accepts (main config). */
const STT_MODELS = [
  { value: 'tiny.en', label: 'tiny.en — fastest, least accurate' },
  { value: 'base.en', label: 'base.en — recommended (fast + exact)' },
  { value: 'small.en', label: 'small.en — slower, more accurate' },
  { value: 'base', label: 'base — multilingual' },
  { value: 'small', label: 'small — multilingual, slow' },
  { value: 'medium', label: 'medium — very slow on CPU' },
  { value: 'large-v3', label: 'large-v3 — best quality, too slow here' },
];

const INTENT_META: Record<string, { label: string; className: string }> = {
  chat: { label: 'chat', className: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25' },
  custom_command: { label: 'command', className: 'bg-amber-500/15 text-amber-300 border-amber-500/25' },
  wake_word_detected: { label: 'wake', className: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25' },
  stop_listening: { label: 'stop', className: 'bg-rose-500/15 text-rose-300 border-rose-500/25' },
};

const CONFIG_KEY = 'infinite:voice-panel';

const LANGUAGES = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'es-ES', label: 'Spanish' },
  { id: 'fr-FR', label: 'French' },
  { id: 'de-DE', label: 'German' },
  { id: 'it-IT', label: 'Italian' },
  { id: 'pt-BR', label: 'Portuguese' },
  { id: 'ja-JP', label: 'Japanese' },
  { id: 'ko-KR', label: 'Korean' },
  { id: 'zh-CN', label: 'Chinese' },
  { id: 'hi-IN', label: 'Hindi' },
  { id: 'ar-SA', label: 'Arabic' },
];

// A spoken turn is only "heard" once the recognizer stops changing its
// mind: SAPI interim hypotheses flicker word-to-word, and submitting one
// mid-flicker is the classic "I said X, it wrote something completely
// different". Final text wins; combined text needs a long stable standstill.
// Silence windows for ending a spoken turn.
const LOCAL_SILENCE_MS = 1_400;
const INTERIM_STABLE_FALLBACK_MS = 6_000;
const INTERIM_SILENCE_FALLBACK_MS = 2_000;

const MIC_KEY = 'infinite:voice-mic';

// -- Voice surface styling ----------------------------------------------------
// Shares the Power Center's language: hairline borders, #12131a glass cards,
// spectrum accents (violet ? cyan ? magenta) and mono micro-labels. Motion is
// carried by the orb and the level bars, never by decoration.
const VOICE_STYLES = `
@keyframes voice-twinkle { 0%,100% { opacity: 0.15; transform: scale(0.85); } 50% { opacity: 0.85; transform: scale(1.1); } }
@keyframes voice-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes voice-breathe {
  0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.26); }
  50% { box-shadow: 0 0 0 15px rgba(52,211,153,0); }
}
.voice-ambient { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.voice-card { position: relative; border-radius: 1rem; border: 1px solid rgba(255,255,255,0.07); background: #12131a; transition: border-color 0.2s, background 0.2s; }
.voice-card:hover { border-color: rgba(255,255,255,0.12); }
.voice-label { display: block; font-size: 11px; color: #a1a1aa; }
.voice-field { width: 100%; height: 34px; padding: 0 10px; border-radius: 10px; background: #101014; border: 1px solid rgba(255,255,255,0.08); color: #e4e4e7; font-size: 12px; outline: none; transition: border-color 0.18s, background 0.18s; }
.voice-field:focus { border-color: rgba(139,92,246,0.55); background: #0d0d12; }
.voice-field::placeholder { color: #52525b; }
.voice-note { margin-top: 10px; border-radius: 10px; border: 1px solid rgba(251,191,36,0.18); background: rgba(251,191,36,0.07); padding: 8px 10px; font-size: 11px; line-height: 1.5; color: rgba(252,211,77,0.9); }
.voice-note code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #fde68a; }
.voice-note--quiet { border-color: rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); color: #52525b; }
.voice-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 9px; background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #fff; font-size: 11px; font-weight: 500; transition: filter 0.18s; }
.voice-btn:hover { filter: brightness(1.12); }
.voice-btn--ghost { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.09); color: #d4d4d8; }
.voice-btn--ghost:hover { background: rgba(255,255,255,0.09); }
.voice-chip-btn { height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); font-size: 10px; color: #a1a1aa; transition: color 0.18s, border-color 0.18s; }
.voice-chip-btn:hover { color: #e4e4e7; border-color: rgba(255,255,255,0.16); }
.voice-toggle { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px; border-radius: 9999px; border: 1px solid rgba(255,255,255,0.08); font-size: 10px; color: #a1a1aa; transition: color 0.18s, border-color 0.18s, background 0.18s; }
.voice-toggle:hover { color: #e4e4e7; border-color: rgba(255,255,255,0.16); }
.voice-toggle--live { border-color: rgba(52,211,153,0.28); background: rgba(16,185,129,0.1); color: #6ee7b7; }
.voice-toggle--warn { border-color: rgba(251,191,36,0.3); background: rgba(245,158,11,0.1); color: #fcd34d; }
.voice-orb { position: relative; display: grid; place-items: center; width: 116px; height: 116px; border-radius: 9999px; border: 1px solid var(--ring); background: radial-gradient(circle at 32% 28%, rgba(30,27,75,0.92), #09090c 72%); cursor: pointer; transition: border-color 0.35s, transform 0.2s; }
.voice-orb:hover { transform: scale(1.03); }
.voice-orb:focus-visible { outline: 2px solid rgba(139,92,246,0.7); outline-offset: 4px; }
.voice-orb[data-phase='listening'] { animation: voice-breathe 2.4s ease-in-out infinite; }
.voice-orb[data-phase='speaking'] { animation: voice-breathe 3.6s ease-in-out infinite; }
.voice-orb-halo { position: absolute; inset: -6%; border-radius: 9999px; background: radial-gradient(circle, var(--halo), transparent 68%); filter: blur(16px); transition: transform 0.12s linear; }
.voice-orb-ring { position: absolute; border-radius: 9999px; pointer-events: none; }
.voice-orb-ring--outer { inset: -20px; border: 1px dashed var(--ring); opacity: 0.75; animation: voice-spin 30s linear infinite; }
.voice-orb-ring--mid { inset: -9px; border: 1px solid var(--ring); opacity: 0.35; }
.voice-orb-core { position: relative; display: flex; flex-direction: column; align-items: center; gap: 5px; }
.voice-orb-glyph { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 9999px; border: 1px solid var(--ring); color: #e4e4e7; background: rgba(9,9,12,0.85); }
.voice-bars { display: flex; align-items: flex-end; justify-content: center; gap: 3px; height: 28px; }
.voice-bar { width: 3px; border-radius: 9999px; background: linear-gradient(180deg, var(--tone), rgba(255,255,255,0.12)); height: calc(4px + var(--w) * var(--amp) * 30px); transform-origin: center; animation: voice-bar 0.9s ease-in-out infinite alternate; opacity: 0.9; }
@keyframes voice-bar { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }
@media (prefers-reduced-motion: reduce) {
  /* The orb's ring is the point of the orb — it keeps a slow turn under reduced
     motion (the global stylesheet would otherwise freeze every animation), while
     the level bars and breathing pulse stop. */
  .voice-orb-ring--outer {
    animation-name: voice-spin !important;
    animation-duration: 200s !important;
    animation-iteration-count: infinite !important;
    animation-timing-function: linear !important;
  }
  .voice-orb, .voice-bar { animation: none !important; }
}
`;

/** Phase palette — one source of truth for orb, bars and status dot. */
const PHASE_TONE: Record<Phase, { label: string; dot: string; ring: string; halo: string; tone: string }> = {
  idle: { label: 'Idle', dot: 'bg-zinc-500', ring: 'rgba(255,255,255,0.12)', halo: 'rgba(139,92,246,0.10)', tone: '#a1a1aa' },
  listening: { label: 'Listening', dot: 'bg-emerald-400', ring: 'rgba(52,211,153,0.45)', halo: 'rgba(52,211,153,0.22)', tone: '#34d399' },
  thinking: { label: 'Thinking', dot: 'bg-amber-400', ring: 'rgba(251,191,36,0.45)', halo: 'rgba(251,191,36,0.16)', tone: '#fbbf24' },
  speaking: { label: 'Speaking', dot: 'bg-violet-400', ring: 'rgba(167,139,250,0.45)', halo: 'rgba(167,139,250,0.20)', tone: '#a78bfa' },
};

const VOICE_STARS = Array.from({ length: 22 }, (_, i) => ({
  i,
  x: (i * 173.7) % 100,
  y: (i * 83.3) % 100,
  size: 1 + (i % 3),
  dur: 2.8 + (i % 5) * 0.8,
  delay: i * 0.17,
}));

/** Fixed bar weights — a symmetric spectrum, so the meter reads as an instrument. */
const VOICE_BARS = Array.from({ length: 34 }, (_, i) => {
  const centre = 1 - Math.abs(i - 16.5) / 16.5;
  return Number((0.3 + centre * 0.7).toFixed(3));
});

function loadMicId(): string {
  try {
    return localStorage.getItem(MIC_KEY) ?? '';
  } catch {
    return '';
  }
}
const CLOUD_SILENCE_MS = 1_500;
const CLOUD_RMS_THRESHOLD = 0.012;
const CLOUD_MAX_UTTERANCE_MS = 45_000;

function loadConfig(): VoicePanelConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') as Partial<VoicePanelConfig>;
    return {
      // Fresh profiles dictate locally: cloud dictation only happens when the
      // user explicitly picks Automatic/Cloud with a key saved. A stored
      // 'auto' still round-trips — only missing/garbage falls back to local.
      sttMode:
        raw.sttMode === 'auto' || raw.sttMode === 'local' || raw.sttMode === 'cloud'
          ? raw.sttMode
          : 'local',
      ttsMode:
        raw.ttsMode === 'local' ||
        raw.ttsMode === 'kokoro' ||
        raw.ttsMode === 'openrouter' ||
        raw.ttsMode === 'openai' ||
        raw.ttsMode === 'edge'
          ? raw.ttsMode
          : 'auto',
      ttsModel: typeof raw.ttsModel === 'string' ? raw.ttsModel : '',
      voice: typeof raw.voice === 'string' ? raw.voice : '',
      muted: raw.muted === true,
      autoContinue: raw.autoContinue !== false,
      rate: typeof raw.rate === 'number' ? raw.rate : 1,
      pitch: typeof raw.pitch === 'number' ? raw.pitch : 1,
      volume: typeof raw.volume === 'number' ? raw.volume : 1,
    };
  } catch {
    return {
      sttMode: 'local',
      ttsMode: 'auto',
      ttsModel: '',
      voice: '',
      muted: false,
      autoContinue: true,
      rate: 1,
      pitch: 1,
      volume: 1,
    };
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the recording.'));
    reader.readAsDataURL(blob);
  });
}

function pickRecorderMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const mime of candidates) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      return '';
    }
  }
  return '';
}

export function VoiceView({ onViewChange }: { onViewChange?: (view: string) => void }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [stageHint, setStageHint] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<VoicePanelConfig>(loadConfig);
  const [keys, setKeys] = useState<{
    stt: boolean;
    tts: boolean;
    sttSource?: 'dedicated' | 'provider' | 'openrouter' | null;
    ttsSource?: 'dedicated' | 'provider' | 'openrouter' | null;
  }>({ stt: false, tts: false });
  const [sttDraft, setSttDraft] = useState('');
  const [ttsDraft, setTtsDraft] = useState('');
  const [keysStatus, setKeysStatus] = useState<string | null>(null);
  const [voices, setVoices] = useState<string[]>([]);
  const [whisperOk, setWhisperOk] = useState(false);
  const [whisperChecked, setWhisperChecked] = useState(false);
  const [kokoroOk, setKokoroOk] = useState(false);
  const [mics, setMics] = useState<Array<{ id: string; label: string }>>([]);
  const [micId, setMicId] = useState(loadMicId);
  const [modelBadge, setModelBadge] = useState('');
  // ── Assistant layer (wake word, custom commands, history) ──
  const [customCommands, setCustomCommands] = useState<VoiceCustomCommand[]>([]);
  const [history, setHistory] = useState<VoiceHistoryEntry[]>([]);
  const [wakeWordDraft, setWakeWordDraft] = useState('hey infinite');
  const [mainSttModel, setMainSttModel] = useState('base.en');
  const [newTrigger, setNewTrigger] = useState('');
  const [newAction, setNewAction] = useState('');

  const {
    error: dictationError,
    finalTranscript,
    interimTranscript,
    language,
    setLanguage,
    startListening,
    stopListening,
    transcript,
  } = useVoiceAssistant();

  const voiceState = useVoiceSessionStore((s) => s.state);

  // Two-model split: the communication model speaks, the main model works.
  const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
  const [commProvider, setCommProvider] = useState('');
  const [commModel, setCommModel] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.api
      .listProviders()
      .then((list: Array<{ id: string; name: string }>) => {
        if (!cancelled) setProviders(list);
      })
      .catch(() => undefined);
    void Promise.all([
      window.api.getSetting({ scope: 'user', key: 'voiceCommunicationProvider' }),
      window.api.getSetting({ scope: 'user', key: 'voiceCommunicationModel' }),
    ])
      .then(([provider, model]) => {
        if (cancelled) return;
        setCommProvider(typeof provider === 'string' ? provider : '');
        setCommModel(typeof model === 'string' ? model : '');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const saveCommsModel = async (provider: string, model: string) => {
    setCommProvider(provider);
    setCommModel(model);
    await window.api.setSetting({ scope: 'user', key: 'voiceCommunicationProvider', value: provider, cwd: '.' }).catch(() => undefined);
    await window.api.setSetting({ scope: 'user', key: 'voiceCommunicationModel', value: model, cwd: '.' }).catch(() => undefined);
  };

  const toggleAlwaysOnVoice = async () => {
    // Reflect immediately for responsiveness; the main process is the source of
    // truth and broadcasts the settled state a moment later.
    const next = !voiceState.enabled;
    useVoiceSessionStore.getState().setSnapshot({ ...voiceState, enabled: next });
    await window.api.voiceSessionSetEnabled({ enabled: next }).catch(() => undefined);
  };

  const streaming = useChatStore((s) => s.streaming);
  const messages = useChatStore((s) => s.messages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const abort = useChatStore((s) => s.abort);
  const activity = useChatStore((s) => s.activity);

  // Bind this page to the always-on conversation.
  //
  // Background voice turns run in main and are mirrored onto the chat stream;
  // the stream listener only renders events for the session it currently has
  // open. So while the background loop is armed, this page opens that loop's
  // conversation — which also means typed messages here land in the same thread
  // the AI is listening to, instead of a separate one.
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  useEffect(() => {
    const target = voiceState.sessionId;
    // 'voice' is the placeholder before main resolves a real session id.
    if (!voiceState.enabled || !target || target === 'voice') return;
    if (useChatStore.getState().currentSessionId === target) return;
    void useChatStore.getState().selectSession(target).catch(() => undefined);
  }, [voiceState.enabled, voiceState.sessionId, currentSessionId]);

  // ── Refs (callbacks and timers must never read stale state) ──
  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>('idle');
  const configRef = useRef(config);
  const conversationRef = useRef(false);
  const awaitingReplyRef = useRef(false);
  const sawRunRef = useRef(false);
  const submittingRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const transcriptRef = useRef('');
  const finalRef = useRef('');
  const stableTextRef = useRef('');
  const stableSinceRef = useRef(0);
  const audioErrorRef = useRef('');
  // ── Speak-as-it-streams ──
  // The cloud reply streams token-by-token; instead of waiting for the whole
  // answer, complete sentences are spoken the moment they arrive. Raw (not
  // sanitized) text is tracked so offsets into the growing transcript stay
  // exact; each extracted chunk is sanitized right before synthesis.
  // messageId → raw chars already fed to the speech buffer.
  const speechConsumedRef = useRef(new Map<string, number>());
  // Raw leftover the extractor held back (half sentence, open code fence).
  const pendingSpeechRef = useRef('');
  const speechQueueRef = useRef<string[]>([]);
  const pumpActiveRef = useRef(false);
  // One failure notice per turn — a dead voice must not spam the status line
  // once per sentence.
  const streamSpeechFailedRef = useRef(false);
  const stopSpeakRef = useRef<(() => void) | null>(null);
  const stopConversationRef = useRef<((abortRun: boolean) => void) | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pollRef = useRef<number | null>(null);
  const heardLoudRef = useRef(false);
  const maxRmsRef = useRef(0);
  const lastLoudRef = useRef(0);
  const startedAtRef = useRef(0);
  const finishingRef = useRef(false);
  const formatRef = useRef('webm');
  const beginListeningRef = useRef<(() => void) | null>(null);
  const finishCloudRef = useRef<(() => void) | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  configRef.current = config;
  transcriptRef.current = transcript;
  finalRef.current = finalTranscript;
  const langRef = useRef(language);
  langRef.current = language;
  const micRef = useRef(micId);
  micRef.current = micId;

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // Buffered transcription runs when a cloud key exists or the local Whisper
  // model is installed. 'local' prefers the accurate offline Whisper model
  // and only falls back to live Windows dictation when it isn't downloaded —
  // SAPI dictation hears ambient noise and invents words, Whisper does not.
  // 'auto' upgrades from dictation to the recorder the moment either becomes
  // true; 'cloud' keeps its contract and needs the key.
  const useCloudStt =
    config.sttMode === 'local'
      ? whisperOk
      : config.sttMode === 'cloud'
        ? keys.stt
        : keys.stt || whisperOk;
  const useCloudRef = useRef(useCloudStt);
  useCloudRef.current = useCloudStt;

  const refreshModelBadge = useCallback(() => {
    try {
      const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}') as {
        provider?: string;
        model?: string;
      };
      setModelBadge([current.provider, current.model].filter(Boolean).join(' · '));
    } catch {
      setModelBadge('');
    }
  }, []);

  const refreshKeys = useCallback(() => {
    void window.api
      .voiceKeysGet()
      .then(setKeys)
      .catch(() => undefined);
  }, []);

  // Microphone picker: the #2 "wrong words" cause after the SAPI fallback is
  // simply the wrong input (Stereo Mix, a webcam mic across the room).
  // Labels need mic permission first — before that, devices still list as
  // "Microphone 1…".
  const refreshMics = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      setMics(
        inputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      );
    } catch {
      /* enumeration unavailable — recorder falls back to the default input */
    }
  }, []);

  const chooseMic = useCallback((id: string) => {
    setMicId(id);
    try {
      localStorage.setItem(MIC_KEY, id);
    } catch { /* private mode — keep in memory */ }
  }, []);

  // ── Assistant layer (wake word / custom commands / history) ──
  // Rides the same main-process intent router the classic panel used, so
  // "hey infinite", "stop listening", and taught phrases keep working inside
  // the hands-free conversation loop.
  const refreshCommands = useCallback(async () => {
    try {
      const commands = (await window.api.voiceCustomCommands()) as VoiceCustomCommand[] | null;
      setCustomCommands(commands ?? []);
    } catch { /* keep existing commands on failure */ }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const entries = (await window.api.voiceHistory()) as VoiceHistoryEntry[] | null;
      setHistory(entries ?? []);
    } catch { /* keep existing history on failure */ }
  }, []);

  const addCommand = useCallback(async () => {
    const trigger = newTrigger.trim();
    const action = newAction.trim();
    if (!trigger || !action) return;
    try {
      const result = (await window.api.voiceAddCustomCommand({ trigger, action })) as {
        commands?: VoiceCustomCommand[];
      } | null;
      if (result?.commands) setCustomCommands(result.commands);
      else await refreshCommands();
      setNewTrigger('');
      setNewAction('');
    } catch {
      await refreshCommands();
    }
  }, [newAction, newTrigger, refreshCommands]);

  const removeCommand = useCallback(
    async (trigger: string) => {
      try {
        const result = (await window.api.voiceRemoveCustomCommand({ trigger })) as {
          commands?: VoiceCustomCommand[];
        } | null;
        if (result?.commands) setCustomCommands(result.commands);
        else await refreshCommands();
      } catch {
        await refreshCommands();
      }
    },
    [refreshCommands],
  );

  const clearHistory = useCallback(async () => {
    try {
      await window.api.voiceClearHistory();
      setHistory([]);
    } catch {
      await refreshHistory();
    }
  }, [refreshHistory]);

  const saveWakeWord = useCallback(async () => {
    const word = wakeWordDraft.trim();
    if (!word) return;
    try {
      await window.api.voiceSetWakeWord({ word });
      setWakeWordDraft(word);
    } catch { /* keep draft */ }
  }, [wakeWordDraft]);

  const saveMainSttModel = useCallback(async (model: string) => {
    setMainSttModel(model);
    try {
      const current = (await window.api.voiceConfigGet()) as { sttModel?: string } | null;
      await window.api.voiceConfigSet({
        config: { ...(current ?? {}), language: langRef.current, sttModel: model },
      });
    } catch { /* keep local value */ }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    refreshModelBadge();
    refreshKeys();
    void (async () => {
      // Assistant-layer state: persisted main config (wake word + offline STT
      // model), custom commands, and intent history.
      try {
        const cfg = (await window.api.voiceConfigGet()) as { wakeWord?: string; sttModel?: string } | null;
        if (cfg) {
          setWakeWordDraft(cfg.wakeWord || 'hey infinite');
          setMainSttModel(cfg.sttModel || 'base.en');
        }
      } catch { /* defaults remain */ }
      await Promise.all([refreshHistory(), refreshCommands()]);
    })();
  }, [refreshModelBadge, refreshKeys, refreshCommands, refreshHistory]);

  useEffect(() => {
    if (settingsOpen) {
      refreshKeys();
      void refreshMics();
    }
    void window.api
      .voiceStatus()
      .then((status: { voices?: string[]; whisper?: boolean; kokoro?: boolean } | undefined) => {
        setVoices(status?.voices ?? []);
        setWhisperOk(status?.whisper === true);
        setWhisperChecked(true);
        setKokoroOk(status?.kokoro === true);
      })
      .catch(() => setWhisperChecked(true));
  }, [settingsOpen, refreshKeys, refreshMics]);

  // Live transcript feeds the pause detector (local dictation mode).
  useEffect(() => {
    if (transcript) lastSpeechAtRef.current = Date.now();
  }, [transcript]);

  const updateConfig = useCallback((patch: Partial<VoicePanelConfig>) => {
    setConfig((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      } catch { /* private mode — keep in memory */ }
      return next;
    });
  }, []);

  // ── Speaking ──
  // Every path reports how it did: 'audio' (main-process TTS file played),
  // 'browser' (system voice fallback), or 'failed' with the reason. Silence
  // is never swallowed — a failed reply surfaces in the status line so "the
  // AI answered but stayed quiet" is always diagnosable, never a mystery.
  interface SpeakResult {
    ok: boolean;
    via?: 'audio' | 'browser';
    provider?: string;
    error?: string;
  }

  const speakText = useCallback(
    (text: string): Promise<SpeakResult> =>
      new Promise<SpeakResult>((resolve) => {
        if (!text) {
          resolve({ ok: true, via: 'browser' });
          return;
        }
        let settled = false;
        const finish = (result: SpeakResult) => {
          if (settled) return;
          settled = true;
          stopSpeakRef.current = null;
          resolve(result);
        };
        // Interruptions (tap to stop, new turn) resolve quietly — the caller
        // moving on IS the outcome, not a failure to report.
        stopSpeakRef.current = () => finish({ ok: true });

        const speakViaBrowser = (): void => {
          if (settled) return;
          // The shared helper waits for Chromium's voice list to finish
          // loading and reports honestly; the previous inline version read
          // getVoices() once, saw the cold-start empty list, and abandoned a
          // working Windows voice instead of retrying.
          const handle = speakWithBrowserVoice(text, {
            lang: language,
            rate: configRef.current.rate,
            pitch: configRef.current.pitch,
            volume: configRef.current.volume,
          });
          stopSpeakRef.current = () => handle.cancel();
          void handle.done.then((result) => {
            finish({ ok: result.ok, via: 'browser', error: result.error });
          });
        };

        void (async () => {
          let audioError = '';
          try {
            const args: { text: string; voice?: string; source?: TtsMode; model?: string } = {
              text,
              source: configRef.current.ttsMode,
              model: configRef.current.ttsModel,
            };
            if (configRef.current.voice) args.voice = configRef.current.voice;
            const result = (await window.api.voiceTTS(args)) as
              | { audio?: string; provider?: string }
              | string
              | null
              | undefined;
            // Lenient shape: older mains return a bare base64 string.
            const encoded = typeof result === 'string' ? result : result?.audio;
            const provider = typeof result === 'string' ? undefined : result?.provider;
            if (settled) return; // interrupted while synthesizing
            if (encoded) {
              const audio = new Audio(`data:${audioDataMime(encoded)};base64,${encoded}`);
              audio.volume = Math.min(1, Math.max(0, configRef.current.volume));
              audioRef.current = audio;
              const started = await audio.play().then(
                () => true,
                (playError: unknown) => {
                  audioError = playError instanceof Error ? playError.message : String(playError ?? 'playback blocked');
                  return false;
                },
              );
              if (started) {
                const label = ttsProviderLabel(provider);
                audio.onended = () => finish({ ok: true, via: 'audio', provider: label });
                audio.onerror = () => {
                  if (audioRef.current === audio) audioRef.current = null;
                  speakViaBrowser();
                };
                return;
              }
              // Playback could not start (autoplay block, bad payload) — fall
              // through to the browser voice below; silence is never an
              // acceptable TTS result.
              if (audioRef.current === audio) audioRef.current = null;
            } else {
              audioError = 'The voice service returned no audio.';
            }
          } catch (error) {
            // No network TTS provider — fall through to the browser voice.
            audioError = error instanceof Error ? error.message : String(error ?? 'TTS failed');
          }
          if (settled) return;
          if (audioError) {
            // Remember why the file path failed so the browser fallback (or
            // the final failure) can name it instead of swallowing it.
            audioErrorRef.current = audioError;
          }
          speakViaBrowser();
        })();
      }),
    [language],
  );

  const stopSpeaking = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch { /* already stopped */ }
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    stopSpeakRef.current?.();
  }, []);

  // ── Speak-as-it-streams ──
  // Sequential pump over the sentence queue: one chunk synthesizes and plays
  // at a time, in arrival order. Re-entrancy guarded — the accumulation
  // effect below re-kicks it after every store update; overlapping pumps
  // would double-speak.
  const pumpSpeech = useCallback(async () => {
    if (pumpActiveRef.current) return;
    pumpActiveRef.current = true;
    try {
      while (speechQueueRef.current.length > 0) {
        if (!conversationRef.current || !mountedRef.current) break;
        if (configRef.current.muted) break;
        const chunk = speechQueueRef.current.shift();
        if (!chunk) break;
        const result = await speakText(chunk);
        if (!mountedRef.current) break;
        if (!result.ok) {
          if (!streamSpeechFailedRef.current) {
            streamSpeechFailedRef.current = true;
            // Transient failure (one bad payload, a momentary device loss):
            // re-queue the failed chunk plus everything behind it for one
            // retry. The text is already sanitized (fence-free), so
            // prepending it to the raw pending buffer is offset-safe — and
            // the per-message consumed map is deliberately NOT rewound (that
            // raw was already counted), so a second failure still drops to a
            // consistent tail instead of double-speaking.
            const backlog = [chunk, ...speechQueueRef.current].filter(Boolean);
            speechQueueRef.current = [];
            if (backlog.length > 0) {
              pendingSpeechRef.current = `${backlog.join(' ')}${pendingSpeechRef.current ? ` ${pendingSpeechRef.current}` : ''}`;
              const retry = extractSpeakableSentences(pendingSpeechRef.current);
              pendingSpeechRef.current = pendingSpeechRef.current.slice(retry.consumed);
              if (retry.chunks.length > 0) speechQueueRef.current.push(...retry.chunks);
            }
            const fileWhy = audioErrorRef.current ? ` Voice file failed: ${audioErrorRef.current}` : '';
            setPanelError(`Live speech failed: ${result.error ?? 'unknown voice failure'}.${fileWhy} Retrying once — anything still unspoken is covered at the end of the turn.`);
            continue;
          }
          speechQueueRef.current = [];
          pendingSpeechRef.current = '';
          break;
        }
      }
    } finally {
      pumpActiveRef.current = false;
    }
  }, [speakText]);

  const pumpSpeechRef = useRef(pumpSpeech);
  pumpSpeechRef.current = pumpSpeech;

  /** Drop everything not yet spoken (mute toggle, interrupt). */
  const dropSpeechBacklog = useCallback(() => {
    speechQueueRef.current = [];
    pendingSpeechRef.current = '';
    const messages = useChatStore.getState().messages;
    for (const m of messages) {
      if (m.role === 'assistant') speechConsumedRef.current.set(m.id, contentToPlainText(m.content).length);
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !configRef.current.muted;
    updateConfig({ muted: next });
    if (next) {
      // Muting mid-reply kills audio now AND drops the backlog (with the
      // consumed map advanced past it) so unmuting later doesn't unleash a
      // burst of stale sentences.
      stopSpeaking();
      dropSpeechBacklog();
    }
  }, [updateConfig, stopSpeaking, dropSpeechBacklog]);

  // Feed newly streamed reply text into the speech queue, sentence by
  // sentence. Runs on every transcript/store update while a voice turn is
  // live — the extractor only releases complete sentences, so partial tokens
  // accumulate silently in the pending buffer.
  useEffect(() => {
    if (!awaitingReplyRef.current || !conversationRef.current) return;
    if (configRef.current.muted) return;
    const messages = useChatStore.getState().messages;
    let combined = pendingSpeechRef.current;
    const takes: Array<{ id: string; take: number }> = [];
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      const raw = contentToPlainText(m.content);
      const prev = speechConsumedRef.current.get(m.id) ?? 0;
      if (raw.length > prev) {
        combined += raw.slice(prev);
        takes.push({ id: m.id, take: raw.length - prev });
      }
    }
    if (!combined.trim()) return;
    const { chunks, consumed } = extractSpeakableSentences(combined);
    if (consumed > 0) {
      let left = consumed;
      for (const t of takes) {
        const adv = Math.min(t.take, left);
        speechConsumedRef.current.set(t.id, (speechConsumedRef.current.get(t.id) ?? 0) + adv);
        left -= adv;
        if (left <= 0) break;
      }
      pendingSpeechRef.current = combined.slice(consumed);
    }
    if (chunks.length > 0) {
      speechQueueRef.current.push(...chunks);
      void pumpSpeechRef.current();
    }
  }, [messages, streaming, config.muted]);

  // ── Input: local dictation and cloud recorder ──

  const stopCloudInput = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setLevel(0);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch { /* already stopped */ }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    void ctx?.close().catch(() => undefined);
  }, []);

  const beginListening = useCallback(() => {
    if (!conversationRef.current) return;
    setPanelError(null);
    setStageHint(null);
    audioErrorRef.current = '';
    stableTextRef.current = '';
    stableSinceRef.current = 0;
    lastSpeechAtRef.current = Date.now();
    changePhase('listening');
    if (useCloudRef.current) {
      void startCloudRecorderRef.current?.();
    } else {
      startListening();
    }
  }, [changePhase, startListening]);

  const startCloudRecorder = useCallback(async () => {
    try {
      // `ideal` (not `exact`): a missing/unplugged picker mic falls back to
      // the default input instead of failing the whole turn.
      const mic = micRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: mic ? { deviceId: { ideal: mic } } : true,
      });
      if (!conversationRef.current || phaseRef.current !== 'listening') {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      recorderRef.current = recorder;
      formatRef.current = mimeType.includes('ogg') ? 'ogg' : 'webm';

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      const samples = new Float32Array(analyser.fftSize);
      heardLoudRef.current = false;
      maxRmsRef.current = 0;
      lastLoudRef.current = Date.now();
      startedAtRef.current = Date.now();

      pollRef.current = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        setLevel(rms);
        const now = Date.now();
        if (rms > maxRmsRef.current) maxRmsRef.current = rms;
        if (rms > CLOUD_RMS_THRESHOLD) {
          heardLoudRef.current = true;
          lastLoudRef.current = now;
        }
        if (now - startedAtRef.current >= CLOUD_MAX_UTTERANCE_MS) {
          finishCloudRef.current?.();
          return;
        }
        if (heardLoudRef.current && now - lastLoudRef.current >= CLOUD_SILENCE_MS) {
          finishCloudRef.current?.();
        }
      }, 100);
    } catch (error) {
      conversationRef.current = false;
      changePhase('idle');
      setPanelError(
        error instanceof Error ? `Microphone unavailable: ${error.message}` : 'Microphone unavailable.',
      );
    }
  }, [changePhase]);

  const startCloudRecorderRef = useRef(startCloudRecorder);
  startCloudRecorderRef.current = startCloudRecorder;

  const finishCloudUtterance = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setLevel(0);
      const recorder = recorderRef.current;
      const stream = streamRef.current;
      if (recorder && recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          try {
            recorder.stop();
          } catch {
            resolve();
          }
        });
      }
      recorderRef.current = null;
      streamRef.current = null;
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      void ctx?.close().catch(() => undefined);
      stream?.getTracks().forEach((track) => track.stop());

      if (!conversationRef.current || !mountedRef.current) return;

      // VAD gate: a take that never got loud and peaked at room-tone levels
      // is silence, not speech — skip the transcription cycle entirely
      // (model load + inference for nothing) and keep listening.
      if (isSilentCapture(maxRmsRef.current, heardLoudRef.current, CLOUD_RMS_THRESHOLD)) {
        beginListeningRef.current?.();
        return;
      }

      const blob = new Blob(chunksRef.current, { type: recorder?.mimeType || 'audio/webm' });
      chunksRef.current = [];
      if (blob.size < 500) {
        // Nothing usable was captured — go straight back to listening.
        beginListeningRef.current?.();
        return;
      }

      changePhase('thinking');
      setStageHint('Transcribing your voice…');
      const audioBuffer = await blobToBase64(blob);
      const text = String(
        await window.api.voiceSTT({
          audioBuffer,
          format: formatRef.current,
          // Pinned-local turns must never touch a saved cloud key.
          local: configRef.current.sttMode === 'local',
          language: langRef.current,
        }),
      ).trim();
      if (!conversationRef.current || !mountedRef.current) return;
      if (!text) {
        beginListeningRef.current?.();
        return;
      }
      setStageHint(null);
      await submitUtteranceRef.current?.(text);
    } catch (error) {
      if (!mountedRef.current) return;
      conversationRef.current = false;
      changePhase('idle');
      setStageHint(null);
      setPanelError(
        error instanceof Error ? error.message : 'Speech-to-text failed. Check the STT key in Settings.',
      );
    } finally {
      finishingRef.current = false;
    }
  }, [changePhase]);

  const finishCloudUtteranceRef = useRef(finishCloudUtterance);
  finishCloudUtteranceRef.current = finishCloudUtterance;
  finishCloudRef.current = () => {
    void finishCloudUtteranceRef.current();
  };

  const submitUtterance = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (submittingRef.current || !conversationRef.current || !text) return;
      submittingRef.current = true;
      try {
        // Stop whichever input is live (idempotent).
        if (recorderRef.current) stopCloudInput();
        else stopListening();
        setStageHint(null);
        setPanelError(null);

        // Assistant layer first: wake word, taught phrases, and the stop
        // command are handled by the same main-process router the classic
        // voice panel used — they never reach the chat model.
        let result: VoiceProcessResult | null = null;
        try {
          result = (await window.api.voiceProcessTranscript({ transcript: text })) as VoiceProcessResult | null;
        } catch { /* router unavailable — treat as chat */ }
        const intent = result?.intent ?? 'chat';

        if (intent === 'stop_listening') {
          const response = result?.response ?? 'Stopped listening.';
          stopConversationRef.current?.(false);
          await speakText(response);
          await refreshHistory();
          return;
        }
        if (intent === 'wake_word_detected') {
          const response = result?.response ?? 'Yes? Listening.';
          changePhase('speaking');
          await speakText(response);
          await refreshHistory();
          if (!mountedRef.current) return;
          if (phaseRef.current === 'speaking' && conversationRef.current) {
            beginListeningRef.current?.();
          }
          return;
        }
        if (intent === 'custom_command') {
          const response = result?.response ?? `Ran ${result?.trigger ?? ''}`;
          changePhase('speaking');
          await speakText(response);
          await refreshHistory();
          if (!mountedRef.current) return;
          if (phaseRef.current === 'speaking') {
            if (conversationRef.current && configRef.current.autoContinue) {
              beginListeningRef.current?.();
            } else {
              changePhase('idle');
            }
          }
          return;
        }

        const chatText = (result?.text ?? text).trim();
        if (!chatText) {
          beginListeningRef.current?.();
          return;
        }
        changePhase('thinking');
        awaitingReplyRef.current = true;
        sawRunRef.current = false;
        // Fresh turn, fresh speech cursor: everything already on screen is
        // history, only text streamed from here on may speak. Without this,
        // the pump would read the whole session transcript aloud.
        speechConsumedRef.current.clear();
        pendingSpeechRef.current = '';
        speechQueueRef.current = [];
        streamSpeechFailedRef.current = false;
        for (const m of useChatStore.getState().messages) {
          if (m.role === 'assistant') speechConsumedRef.current.set(m.id, contentToPlainText(m.content).length);
        }
        // Warm the TTS worker now — the voice model loads while the cloud
        // model thinks, so the first streamed sentence synthesizes at once.
        void window.api.voiceWarmup({ which: 'tts' }).catch(() => undefined);
        // Voice shares the chat session; make sure one exists before the
        // first spoken turn (same behavior as the chat view's first send).
        if (!useChatStore.getState().currentSessionId) {
          const settings = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
          await useChatStore.getState().createSession(
            settings.cwd ?? '.',
            settings.model ?? 'meta-llama/llama-3.3-70b-instruct:free',
            settings.provider ?? 'openrouter',
          );
        }
        // sendMessage marks `streaming` synchronously, so the watcher below
        // cannot miss the run even if it finishes instantly.
        void sendMessage(chatText);
        sawRunRef.current = true;
      } finally {
        submittingRef.current = false;
      }
    },
    [changePhase, refreshHistory, sendMessage, speakText, stopCloudInput, stopListening],
  );

  const submitUtteranceRef = useRef(submitUtterance);
  submitUtteranceRef.current = submitUtterance;

  beginListeningRef.current = beginListening;

  // Local-dictation pause detector: submit only once the recognizer has
  // settled. FINAL text is trusted after a short hush; combined (interim)
  // text must stand perfectly still for much longer first — submitting a
  // flickering interim hypothesis is what produces "completely different"
  // words from what was said.
  useEffect(() => {
    if (phase !== 'listening' || useCloudStt) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const finalText = finalRef.current.trim();
      const combined = transcriptRef.current.trim();
      const candidate = finalText || combined;
      if (!candidate) {
        stableTextRef.current = '';
        return;
      }
      if (candidate !== stableTextRef.current) {
        stableTextRef.current = candidate;
        stableSinceRef.current = now;
        return;
      }
      const quietFor = now - lastSpeechAtRef.current;
      if (finalText && isUtteranceComplete(lastSpeechAtRef.current, now, LOCAL_SILENCE_MS)) {
        void submitUtteranceRef.current?.(finalText);
        return;
      }
      if (
        !finalText &&
        now - stableSinceRef.current >= INTERIM_STABLE_FALLBACK_MS &&
        quietFor >= INTERIM_SILENCE_FALLBACK_MS
      ) {
        void submitUtteranceRef.current?.(combined);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [phase, useCloudStt]);

  // ── Reply watcher: streaming true → false means the turn is complete ──

  useEffect(() => {
    if (!awaitingReplyRef.current) return;
    if (streaming) {
      sawRunRef.current = true;
      return;
    }
    if (!sawRunRef.current) return;
    awaitingReplyRef.current = false;
    sawRunRef.current = false;

    void (async () => {
      // The live pump already spoke every complete sentence as it streamed.
      // Wait for its queue to drain first (re-kicking in case it stalled),
      // then speak only the unspoken tail — never the whole reply twice.
      for (;;) {
        if (!mountedRef.current || !conversationRef.current) return;
        if (speechQueueRef.current.length === 0 && !pumpActiveRef.current) break;
        void pumpSpeechRef.current();
        await new Promise((r) => setTimeout(r, 150));
      }
      const tailRaw = (() => {
        // Every turn's unspoken remainder, in order: with a slow provider the
        // live pump can lag whole turns behind, and the tail must not drop
        // them. (The live pump already played everything before each
        // message's consumed offset, so joining tails never double-speaks.)
        const parts: string[] = [];
        for (const m of useChatStore.getState().messages) {
          if (m.role !== 'assistant') continue;
          const raw = contentToPlainText(m.content);
          const prev = speechConsumedRef.current.get(m.id) ?? 0;
          const tail = raw.slice(Math.min(prev, raw.length)).trim();
          if (!tail) continue;
          // Code-fence tails and markdown noise are not speech: sanitize and
          // skip when nothing speakable remains.
          const speakable = spokenReplyText(tail).replace(/`/g, '').replace(/\s+/g, ' ').trim();
          if (speakable) parts.push(speakable);
        }
        return parts.join(' ').trim();
      })();
      const spoken = tailRaw;
      if (spoken && !configRef.current.muted && mountedRef.current) {
        changePhase('speaking');
        const result = await speakText(spoken);
        if (!mountedRef.current) return;
        if (!result.ok) {
          // Audible failure, stated plainly: the #1 voice complaint is
          // silence with no explanation.
          const fileWhy = audioErrorRef.current ? ` Voice file failed: ${audioErrorRef.current}` : '';
          setPanelError(`Couldn't speak that reply out loud: ${result.error ?? 'unknown voice failure'}.${fileWhy}`);
        } else if (result.via === 'browser') {
          const fileWhy = audioErrorRef.current ? ` (${audioErrorRef.current})` : '';
          setStageHint(`Spoken with the Windows system voice${fileWhy} — switch TTS to Local for the offline voice.`);
        } else {
          setStageHint(null);
        }
      }
      if (!mountedRef.current) return;
      // If the user interrupted (or a stop landed while we were speaking) the
      // phase has already moved on — never double-start a listening round.
      const current = phaseRef.current;
      if (current !== 'speaking' && current !== 'thinking') return;
      if (conversationRef.current && configRef.current.autoContinue) {
        beginListeningRef.current?.();
      } else {
        changePhase('idle');
      }
    })();
  }, [streaming, changePhase, speakText]);

  // ── Conversation lifecycle ──

  const stopConversation = useCallback(
    (abortRun: boolean) => {
      conversationRef.current = false;
      awaitingReplyRef.current = false;
      sawRunRef.current = false;
      // The pump loop observes conversationRef and exits on its own; clear
      // the backlog so a restarted turn never replays stale sentences.
      speechQueueRef.current = [];
      pendingSpeechRef.current = '';
      stopSpeaking();
      if (recorderRef.current) stopCloudInput();
      else stopListening();
      setStageHint(null);
      setLevel(0);
      changePhase('idle');
      if (abortRun) void abort();
    },
    [abort, changePhase, stopCloudInput, stopListening, stopSpeaking],
  );
  stopConversationRef.current = stopConversation;

  const handlePrimary = useCallback(() => {
    if (phaseRef.current === 'speaking') {
      // Barge-in: stop this utterance cold and drop anything queued behind
      // it — the user is talking now, stale sentences must not play after.
      speechQueueRef.current = [];
      pendingSpeechRef.current = '';
      stopSpeaking();
      if (conversationRef.current) beginListeningRef.current?.();
      else changePhase('idle');
      return;
    }
    if (phaseRef.current === 'thinking') {
      stopConversation(true);
      return;
    }
    if (phaseRef.current === 'listening') {
      stopConversation(false);
      return;
    }
    // Never dispatch a second agent run on top of one still streaming from
    // another view — the voice turn would interleave with it.
    if (useChatStore.getState().streaming) {
      setPanelError('A reply is still in progress — wait for it to finish, or stop it from Chats.');
      return;
    }
    // idle → start a conversation turn
    conversationRef.current = true;
    setPanelError(null);
    refreshModelBadge();
    // Warm the STT worker now — the model loads while the user is still
    // speaking, so transcription starts the instant they pause.
    void window.api.voiceWarmup({ which: 'stt' }).catch(() => undefined);
    beginListeningRef.current?.();
  }, [changePhase, refreshModelBadge, stopConversation, stopSpeaking]);

  // Unmount: never leave a microphone, recorder, or voice hanging.
  useEffect(
    () => () => {
      conversationRef.current = false;
      awaitingReplyRef.current = false;
      stopListening();
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch { /* already stopped */ }
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioCtxRef.current?.close().catch(() => undefined);
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    },
    [stopListening],
  );

  // Follow the conversation. Pinning on `streaming` alone only catches the two
  // edges of a run — mid-run text (a token every few ms, plus the live
  // transcript) grows the scroll height without firing that effect, so the view
  // sat still while the newest words scrolled past out of sight. This is the
  // same behaviour as a voice chat anywhere else: you always see the newest
  // text, unless you deliberately scroll up to read back.
  const [pinned, setPinned] = useState(true);
  // The transcript pane is the first child of the body grid; a ref is the only
  // reliable way to reach it from an effect that runs before the render below.
  const pinnedRef = useRef(true);
  pinnedRef.current = pinned;

  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const onScroll = () => {
      // 64px of slack so a tiny scroll jitter doesn't unpin the view.
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setPinned(distanceFromBottom < 64);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Every source of new text, plus a ResizeObserver for growth that happens
  // without a state change (syntax-highlighted code re-measuring, an image
  // decoding, a markdown table expanding).
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    const stick = () => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    };
    stick();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(stick);
      observer.observe(el);
      for (const child of Array.from(el.children)) observer.observe(child);
    }
    return () => observer?.disconnect();
  }, [messages.length, streaming, interimTranscript, transcript, stageHint]);

  const saveKeys = async () => {
    const sttKey = sttDraft.trim();
    const ttsKey = ttsDraft.trim();
    await window.api.voiceKeysSet({
      ...(sttKey ? { sttKey } : {}),
      ...(!sttKey && keys.stt ? { clearStt: true } : {}),
      ...(ttsKey ? { ttsKey } : {}),
      ...(!ttsKey && keys.tts ? { clearTts: true } : {}),
    });
    setSttDraft('');
    setTtsDraft('');
    setKeysStatus('Keys saved.');
    refreshKeys();
    window.setTimeout(() => setKeysStatus(null), 3_000);
  };

  const testVoice = () => {
    setPanelError(null);
    audioErrorRef.current = '';
    setStageHint('Speaking the test line…');
    void speakText('Hey — this is Infinite AI. Your voice is all set.').then((result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        setStageHint(
          result.via === 'audio'
            ? `Test spoken via ${result.provider ?? 'the voice file'}.`
            : 'Test spoken via the Windows system voice.',
        );
      } else {
        setStageHint(null);
        const fileWhy = audioErrorRef.current ? ` Voice file failed: ${audioErrorRef.current}` : '';
        setPanelError(`Voice test failed: ${result.error ?? 'unknown error'}.${fileWhy}`);
      }
    });
  };

  const turns = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => {
          const blocks = (message.content ?? []).filter(
            (block) => block.type === 'text' || block.type === 'tool_use',
          ) as Array<
            | { type: 'text'; text: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
          >;
          return {
            id: message.id,
            role: message.role as 'user' | 'assistant',
            // Kept for the spoken path and for "did anything get said" checks.
            text: contentToPlainText(message.content),
            // Rendered blocks: markdown + code + the tool calls that ran.
            blocks,
          };
        })
        // A turn survives if it said anything OR it did something — a reply that
        // is purely tool_use blocks is a real answer and must stay visible.
        .filter((turn) => turn.text || turn.blocks.some((b) => b.type === 'tool_use')),
    [messages],
  );

  // Tool calls still running, so their cards can show the live state exactly as
  // they do in chat.
  const runningToolIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of activity) {
      if (entry.status === 'running' && entry.toolUseId) ids.add(entry.toolUseId);
    }
    return ids;
  }, [activity]);

  // Say which ear is listening: "Windows dictation" explains a bad
  // transcript at a glance; "Local Whisper" confirms the accurate path.
  const sttEngine = (() => {
    if (!whisperChecked) return 'checking voice setup…';
    if (config.sttMode === 'local') return whisperOk ? 'Local Whisper (offline)' : 'Windows dictation';
    if (config.sttMode === 'cloud') return keys.stt ? 'Cloud transcription' : 'Windows dictation (no STT key saved)';
    return keys.stt ? 'Cloud transcription' : whisperOk ? 'Local Whisper (offline)' : 'Windows dictation';
  })();
  const whisperMissing = whisperChecked && !whisperOk;

  // Replies are silenced while muted — say so in every phase, not just idle,
  // so a muted panel never reads as "the AI answered but stayed quiet".
  const mutedNote = config.muted ? ' · muted — tap Muted to unmute' : '';
  const statusLine = (() => {
    if (panelError) return panelError;
    if (dictationError && phase === 'listening' && !useCloudStt) return dictationError;
    if (stageHint) return `${stageHint}${mutedNote}`;
    if (phase === 'listening') return `Listening (${sttEngine}) — speak, then pause to send.${mutedNote}`;
    if (phase === 'thinking') return `Infinite AI is working on it…${mutedNote}`;
    // (No muted note while speaking: replies never enter this phase muted.)
    if (phase === 'speaking') return 'Speaking — tap the mic to jump back in.';
    const idle = conversationRef.current
      ? 'Ready for your next turn — tap the mic.'
      : 'Tap the mic and just talk to Infinite AI.';
    return `${idle}${mutedNote}`;
  })();

  const liveLine = phase === 'listening' ? (useCloudStt ? '' : interimTranscript || transcript) : '';

  const phaseLabel: Record<Phase, string> = {
    idle: 'Talk',
    listening: 'Stop',
    thinking: 'Stop',
    speaking: 'Talk',
  };

  // Key badges: say out loud when voice is riding on the OpenAI chat key from
  // Settings → Providers (the whole point of saving it — no second key needed).
  const sttKeyClass = !keys.stt ? 'text-zinc-600' : keys.sttSource === 'provider' ? 'text-sky-400' : 'text-emerald-400';
  const sttKeyBadge = !keys.stt
    ? '· not set (local Whisper used)'
    : keys.sttSource === 'provider'
      ? '· using your OpenAI key from Settings'
      : '· saved';
  const sttKeyPlaceholder = !keys.stt
    ? 'Whisper-compatible key (optional)'
    : keys.sttSource === 'provider'
      ? 'Blank keeps your OpenAI key — type to override'
      : 'Enter a new key to replace it, or clear';
  const ttsKeyClass = !keys.tts
    ? 'text-zinc-600'
    : keys.ttsSource === 'provider' || keys.ttsSource === 'openrouter'
      ? 'text-sky-400'
      : 'text-emerald-400';
  const ttsKeyBadge = !keys.tts
    ? '· not set (local voice first, no key)'
    : keys.ttsSource === 'openrouter'
      ? '· using your OpenRouter key from Settings'
      : keys.ttsSource === 'provider'
        ? '· using your OpenAI key from Settings'
        : '· saved';
  const ttsKeyPlaceholder = !keys.tts
    ? 'OpenAI-compatible TTS key (optional)'
    : keys.ttsSource === 'openrouter'
      ? 'Blank keeps your OpenRouter key — type to override'
      : keys.ttsSource === 'provider'
        ? 'Blank keeps your OpenAI key — type to override'
        : 'Enter a new key to replace it, or clear';

  const orbTone = PHASE_TONE[phase];
  // Equalizer amplitude: real mic level while recording, a steady hum while it
  // speaks, near-flat otherwise. Fed to CSS as --amp so the bars stay smooth.
  const amp = phase === 'listening' ? 0.24 + level * 8 : phase === 'speaking' ? 0.58 : phase === 'thinking' ? 0.26 : 0.14;
  const orbScale = 1 + Math.min(0.55, level * 3.2);

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c]">
      <style>{VOICE_STYLES}</style>

      {/* Same open-space field as the Power Center — one system, not two apps. */}
      <div className="voice-ambient" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 60% 45% at 22% 8%, rgba(139,92,246,0.11) 0%, transparent 58%),
              radial-gradient(ellipse 50% 40% at 82% 22%, rgba(34,211,238,0.07) 0%, transparent 52%),
              radial-gradient(ellipse 60% 40% at 50% 108%, rgba(236,72,153,0.05) 0%, transparent 55%)
            `,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.28]"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse 85% 70% at 50% 12%, black, transparent)',
          }}
        />
        {VOICE_STARS.map((s) => (
          <span
            key={s.i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: `${s.size}px`,
              height: `${s.size}px`,
              animation: `voice-twinkle ${s.dur}s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-lg" />
            <InfiniteLogo className="relative h-5 w-11" variant="spectrum" animated />
          </div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-white">
              Voice Assistant
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-zinc-400">
                hands-free
              </span>
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-zinc-500">
              Same brain as your chats — it hears you, works, and answers out loud.
              {modelBadge ? <span className="text-zinc-400"> · {modelBadge}</span> : null}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className="hidden items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-400 sm:inline-flex"
            title={`Listening engine: ${sttEngine}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${phase === 'listening' ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600'}`} />
            {sttEngine}
          </span>
          {onViewChange ? (
            <button type="button" onClick={() => onViewChange('settings')} className="voice-chip-btn">
              Change model
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-label="Voice settings"
            aria-expanded={settingsOpen}
            className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${
              settingsOpen
                ? 'border-violet-400/40 bg-violet-500/10 text-violet-300'
                : 'border-white/[0.08] text-zinc-400 hover:border-white/[0.16] hover:text-zinc-200'
            }`}
          >
            <Settings size={13} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* ── Settings sheet ─────────────────────────────────────────────────── */}
      {settingsOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="relative z-10 shrink-0 overflow-hidden border-b border-white/[0.06]"
        >
          <div className="grid max-h-[46vh] gap-3 overflow-y-auto px-5 py-4 lg:grid-cols-3">
            {/* Ears */}
            <section className="voice-card p-4">
              <GroupHead kicker="Ears" title="How it hears you" />
              <label className="voice-label mt-3">
                Dictation language
                <select value={language} onChange={(event) => setLanguage(event.target.value)} className="voice-field mt-1">
                  {LANGUAGES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="voice-label mt-2.5">
                Speech-to-text source
                <select value={config.sttMode} onChange={(event) => updateConfig({ sttMode: event.target.value as SttMode })} className="voice-field mt-1">
                  <option value="auto">Automatic (Whisper offline without a key, cloud with one)</option>
                  <option value="local">Local Whisper offline (free, no key; Windows dictation if not installed)</option>
                  <option value="cloud">Cloud transcription (needs an STT key)</option>
                </select>
              </label>
              <label className="voice-label mt-2.5">
                Microphone
                <select value={micId} onChange={(event) => chooseMic(event.target.value)} className="voice-field mt-1">
                  <option value="">System default</option>
                  {mics.map((mic) => (
                    <option key={mic.id} value={mic.id}>{mic.label}</option>
                  ))}
                </select>
              </label>
              {whisperMissing && (
                <p className="voice-note">
                  Local Whisper model not found — install once with <code>pip install faster-whisper</code> (free, offline, no key).
                  Until then {sttEngine} is used, which is less accurate.
                </p>
              )}
              {config.ttsMode === 'kokoro' && whisperChecked && !kokoroOk && (
                <p className="voice-note">
                  Local Kokoro voice not found — install once with <code>pip install kokoro-onnx</code> plus the v1.0 model +
                  voices files under voices/kokoro/. Until then replies fall back to the next available voice.
                </p>
              )}
              {!useCloudStt && (
                <p className="voice-note voice-note--quiet">
                  Windows dictation always uses the system default input (Settings → System → Sound) — the picker applies to
                  Whisper/cloud recording.
                </p>
              )}
            </section>

            {/* Mouth */}
            <section className="voice-card p-4">
              <GroupHead kicker="Mouth" title="How it answers" />
              <label className="voice-label mt-3">
                Text-to-speech source
                <select value={config.ttsMode} onChange={(event) => updateConfig({ ttsMode: event.target.value as TtsMode })} className="voice-field mt-1">
                  <option value="auto">Automatic (Piper → Kokoro → OpenAI → OpenRouter → Edge)</option>
                  <option value="local">Local only (Piper → Kokoro, offline, no key)</option>
                  <option value="kokoro">Kokoro (offline, no key — best quality, slower)</option>
                  <option value="openrouter">OpenRouter (uses your OpenRouter key)</option>
                  <option value="openai">OpenAI (uses your OpenAI key)</option>
                  <option value="edge">Edge (free, no key)</option>
                </select>
              </label>
              {(config.ttsMode === 'auto' || config.ttsMode === 'openrouter') && (
                <label className="voice-label mt-2.5">
                  OpenRouter TTS model
                  <input
                    type="text"
                    list="openrouter-tts-models"
                    value={config.ttsModel}
                    onChange={(event) => updateConfig({ ttsModel: event.target.value })}
                    placeholder="deepgram/flux-tts:free (default)"
                    autoComplete="off"
                    spellCheck={false}
                    className="voice-field mt-1"
                  />
                  <datalist id="openrouter-tts-models">
                    <option value="deepgram/flux-tts:free" />
                    <option value="mistralai/voxtral-mini-tts-2603" />
                    <option value="hexgrad/kokoro-82m" />
                    <option value="google/gemini-3.8-flash-tts" />
                    <option value="x-ai/grok-voice-tts-1.0" />
                  </datalist>
                </label>
              )}
              <label className="voice-label mt-2.5">
                Infinite AI voice
                <select value={config.voice} onChange={(event) => updateConfig({ voice: event.target.value })} className="voice-field mt-1">
                  <option value="">Automatic (best available)</option>
                  {voices.map((voice) => (
                    <option key={voice} value={voice}>{voice}</option>
                  ))}
                </select>
              </label>

              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {([
                  { key: 'rate' as const, label: 'Rate', min: 0.5, max: 2, step: 0.1 },
                  { key: 'pitch' as const, label: 'Pitch', min: 0.5, max: 2, step: 0.1 },
                  { key: 'volume' as const, label: 'Volume', min: 0, max: 1, step: 0.1 },
                ]).map((slider) => (
                  <div key={slider.key}>
                    <label className="voice-label">
                      {slider.label} <span className="font-mono text-zinc-300">{Number(config[slider.key]).toFixed(1)}</span>
                    </label>
                    <input
                      type="range"
                      min={slider.min}
                      max={slider.max}
                      step={slider.step}
                      value={config[slider.key]}
                      onChange={(event) => {
                        const value = parseFloat(event.target.value);
                        if (slider.key === 'rate') updateConfig({ rate: value });
                        else if (slider.key === 'pitch') updateConfig({ pitch: value });
                        else updateConfig({ volume: value });
                      }}
                      className="mt-2 w-full accent-violet-400"
                    />
                  </div>
                ))}
              </div>

              <button type="button" onClick={testVoice} className="voice-btn voice-btn--ghost mt-3 w-full">
                <Volume2 size={12} /> Test voice
              </button>
            </section>

            {/* Always on — the main-process loop. One switch: does the AI keep hearing
                you when you leave this page? */}
            <section className="voice-card shrink-0 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <GroupHead kicker="Always on" title="Listen in any section" />
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                    The microphone moves to the app itself, so Infinite AI keeps hearing you in Chats, the browser, the terminal —
                    anywhere. It runs the same agent with your full tool access and answers out loud.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={voiceState.enabled}
                  aria-label="Always-on voice"
                  onClick={() => void toggleAlwaysOnVoice()}
                  className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
                    voiceState.enabled ? 'border-emerald-400/40 bg-emerald-500/80' : 'border-white/[0.12] bg-white/[0.06]'
                  }`}
                >
                  <span
                    className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-all ${
                      voiceState.enabled ? 'left-[18px] bg-white' : 'left-[3px] bg-zinc-500'
                    }`}
                  />
                </button>
              </div>

              {voiceState.enabled ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
                        voiceState.listening
                          ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
                          : voiceState.phase === 'error'
                            ? 'border-rose-400/25 bg-rose-500/10 text-rose-300'
                            : 'border-white/[0.08] bg-white/[0.03] text-zinc-400'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          voiceState.listening ? 'animate-pulse bg-emerald-400' : voiceState.phase === 'error' ? 'bg-rose-400' : 'bg-zinc-600'
                        }`}
                      />
                      {voiceState.listening ? 'Listening now' : voiceState.phase === 'error' ? 'Mic unavailable' : voiceState.phase}
                    </span>
                    {voiceState.listening ? (
                      <button type="button" onClick={() => void window.api.voiceSessionPause()} className="voice-toggle">
                        <MicOff size={11} /> Pause
                      </button>
                    ) : (
                      <button type="button" onClick={() => void window.api.voiceSessionResume()} className="voice-toggle">
                        <Mic size={11} /> Resume
                      </button>
                    )}
                  </div>
                  {voiceState.error && (
                    <p className="mt-2 text-[11px] leading-relaxed text-rose-300">{voiceState.error}</p>
                  )}
                  <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                    Wake word “{voiceState.wakeWord}” · say “stop listening” to halt · the mic is released the moment you switch this off.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-600">
                  Off — the microphone only opens while you are on this page.
                </p>
              )}
            </section>

            {/* Two models: a fast one talks, the main one works. */}
            <section className="voice-card p-4">
              <GroupHead kicker="Speed" title="Two models: talk & do" />
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Optional. Give voice a small, fast model to <em>talk</em> with you while your main model keeps doing the
                work. Replies come faster and are built from the real tool calls, so it tells you what it actually did,
                in words meant for hearing.
              </p>

              <div className="mt-3 grid grid-cols-1 gap-2.5">
                <label className="voice-label">
                  Communication model — speaks to you
                  <select
                    value={commProvider}
                    onChange={(event) => void saveCommsModel(event.target.value, commModel)}
                    className="voice-field mt-1"
                  >
                    <option value="">Same model as everything else</option>
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>

                {commProvider && (
                  <label className="voice-label">
                    Model
                    <input
                      value={commModel}
                      onChange={(event) => setCommModel(event.target.value)}
                      onBlur={(event) => void saveCommsModel(commProvider, event.target.value)}
                      placeholder="e.g. nvidia/nemotron-nano-9b-v2"
                      className="voice-field mt-1 font-mono text-[11px]"
                    />
                  </label>
                )}
              </div>

              {voiceState.communicationModel && (
                <p className="mt-2 text-[10px] leading-relaxed text-emerald-300/80">
                  In use — {voiceState.communicationModel.model} speaks, your main model works.
                </p>
              )}
            </section>

            {/* Assistant layer */}
            <section className="voice-card shrink-0 p-4">
              <GroupHead kicker="Assistant layer" title="Wake word & keys" />
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <label className="voice-label">
                  Offline Whisper model
                  <select value={mainSttModel} onChange={(event) => void saveMainSttModel(event.target.value)} className="voice-field mt-1">
                    {STT_MODELS.map((model) => (
                      <option key={model.value} value={model.value}>{model.label}</option>
                    ))}
                  </select>
                </label>
                <label className="voice-label">
                  Wake word
                  <div className="mt-1 flex gap-1.5">
                    <input
                      type="text"
                      value={wakeWordDraft}
                      onChange={(event) => setWakeWordDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') void saveWakeWord(); }}
                      placeholder="hey infinite"
                      className="voice-field min-w-0 flex-1"
                    />
                    <button type="button" onClick={() => void saveWakeWord()} className="voice-btn shrink-0">Save</button>
                  </div>
                </label>
              </div>

              <label className="voice-label mt-2.5">
                Speech-to-text API key <span className={sttKeyClass}>{sttKeyBadge}</span>
                <input
                  type="password"
                  value={sttDraft}
                  onChange={(event) => setSttDraft(event.target.value)}
                  placeholder={sttKeyPlaceholder}
                  autoComplete="off"
                  className="voice-field mt-1"
                />
              </label>
              <label className="voice-label mt-2.5">
                Text-to-speech API key <span className={ttsKeyClass}>{ttsKeyBadge}</span>
                <input
                  type="password"
                  value={ttsDraft}
                  onChange={(event) => setTtsDraft(event.target.value)}
                  placeholder={ttsKeyPlaceholder}
                  autoComplete="off"
                  className="voice-field mt-1"
                />
              </label>

              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => void saveKeys()} className="voice-btn">Save keys</button>
                {keysStatus ? <span className="text-[11px] text-emerald-400">{keysStatus}</span> : null}
                <span className="ml-auto text-[10px] text-zinc-600">Empty + save clears a key.</span>
              </div>
            </section>
          </div>
        </motion.div>
      )}

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="relative z-10 grid min-h-0 flex-1 gap-4 overflow-hidden px-5 py-4 lg:grid-cols-[minmax(0,1fr)_336px]">
        {/* Transcript */}
        <div ref={transcriptScrollRef} className="min-h-0 overflow-y-auto pr-1 custom-scrollbar">
          {turns.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="relative grid h-24 w-24 place-items-center">
                <div className="absolute inset-0 animate-[voice-spin_28s_linear_infinite] rounded-full border border-dashed border-white/[0.09]" />
                <div className="absolute inset-4 rounded-full border border-white/[0.06]" />
                <div className="absolute inset-0 rounded-full bg-violet-500/10 blur-2xl" />
                <InfiniteLogo className="relative h-5 w-11" variant="spectrum" animated />
              </div>
              <div className="max-w-sm">
                <div className="text-[15px] font-medium tracking-tight text-white">Your voice, Infinite AI on the job</div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-500">
                  Ask anything — draft an email, search your files, build something, drive the computer.
                  The same agent that runs your chats answers here, and it speaks back.
                </p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-600">Try saying</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {['Draft an email to Sam', 'What’s on my plate today?', 'Open my last project', 'Summarize my desktop'].map((sample) => (
                    <span key={sample} className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-[11px] text-zinc-400">
                      <Mic size={10} className="text-cyan-400/70" strokeWidth={1.8} />
                      {sample}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-3 py-1">
              {turns.slice(-40).map((turn) => (
                <div key={turn.id} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {turn.role === 'user' ? (
                    <div className="max-w-[85%] rounded-2xl rounded-br-md border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-[13px] leading-relaxed text-zinc-100">
                      <div className="mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                        <Mic size={9} strokeWidth={2} /> you
                      </div>
                      <div className="whitespace-pre-wrap break-words">{turn.text}</div>
                    </div>
                  ) : (
                    /* Assistant turns keep the SAME block stream as chat — text,
                       fenced code, and the tool_use blocks that ran to produce
                       the answer. Spoken turns used to render contentToPlainText,
                       so a spoken "I installed the package" hid the install: the
                       code and every tool call were invisible even though the
                       agent had done the work. */
                    <div className="w-full max-w-full">
                      <div className="mb-1.5 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-zinc-500">
                        {streaming ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" /> : <Volume2 size={9} strokeWidth={2} />}
                        infinite ai
                      </div>
                      <VoiceAssistantBlocks blocks={turn.blocks} runningToolIds={runningToolIds} streaming={streaming} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Instrument rail */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1 custom-scrollbar">
          {/* Orb */}
          <section className="voice-card relative shrink-0 overflow-hidden p-5">
            <div className="pointer-events-none absolute inset-x-0 -top-16 h-32 opacity-70" style={{ background: `radial-gradient(ellipse at 50% 100%, ${orbTone.halo}, transparent 70%)` }} />

            <div className="relative flex flex-col items-center pt-1">
              <button
                type="button"
                onClick={handlePrimary}
                aria-pressed={phase !== 'idle'}
                aria-label={phaseLabel[phase]}
                title={phaseLabel[phase]}
                className="voice-orb"
                data-phase={phase}
                style={{ ['--ring' as string]: orbTone.ring, ['--halo' as string]: orbTone.halo }}
              >
                <span className="voice-orb-halo" style={{ transform: `scale(${orbScale})` }} aria-hidden="true" />
                <span className="voice-orb-ring voice-orb-ring--outer" aria-hidden="true" />
                <span className="voice-orb-ring voice-orb-ring--mid" aria-hidden="true" />
                <span className="voice-orb-core">
                  <InfiniteLogo className="h-5 w-11" variant="spectrum" animated />
                  <span className="voice-orb-glyph">
                    {phase === 'thinking' ? (
                      <Loader2 size={11} className="animate-spin" strokeWidth={2.4} />
                    ) : phase === 'speaking' ? (
                      <Volume2 size={11} strokeWidth={2.2} />
                    ) : phase === 'listening' ? (
                      <Square size={9} fill="currentColor" strokeWidth={0} />
                    ) : (
                      <Mic size={11} strokeWidth={2.2} />
                    )}
                  </span>
                </span>
              </button>

              <div className="mt-4 text-center">
                <div className="flex items-center justify-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${orbTone.dot}`} />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-300">{orbTone.label}</span>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500" role="status" aria-live="polite">{statusLine}</p>
              </div>
            </div>

            {/* Level */}
            <div className="voice-bars mt-4" style={{ ['--amp' as string]: amp, ['--tone' as string]: orbTone.tone }} aria-hidden="true">
              {VOICE_BARS.map((weight, i) => (
                <span
                  key={i}
                  className="voice-bar"
                  style={{ ['--w' as string]: weight, animationDelay: `${i * 45}ms`, animationDuration: `${620 + (i % 6) * 130}ms` }}
                />
              ))}
            </div>

            {/* Live transcript while listening */}
            {(liveLine || (useCloudStt && phase === 'listening')) && (
              <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/25 px-3.5 py-2.5">
                {useCloudStt && phase === 'listening' ? (
                  <div className="flex items-center gap-3">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(level * 900))}%` }} />
                    </div>
                    <span className="shrink-0 text-[10px] text-zinc-500">recording · pause to send</span>
                  </div>
                ) : (
                  <div className="text-[12px] leading-relaxed text-zinc-200">
                    {liveLine || interimTranscript}
                    <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-cyan-400/70 align-middle" />
                  </div>
                )}
              </div>
            )}

            {/* Modes */}
            <div className="mt-4 flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                aria-pressed={config.muted}
                title={config.muted ? 'AI replies are muted' : 'AI replies are spoken aloud'}
                className={`voice-toggle ${config.muted ? 'voice-toggle--warn' : ''}`}
              >
                {config.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                {config.muted ? 'Muted' : 'Voice on'}
              </button>
              <button
                type="button"
                onClick={() => updateConfig({ autoContinue: !config.autoContinue })}
                aria-pressed={config.autoContinue}
                title={config.autoContinue ? 'Hands-free: Infinite AI listens again after replying' : 'Push-to-talk: tap the mic for each new question'}
                className={`voice-toggle ${config.autoContinue ? 'voice-toggle--live' : ''}`}
              >
                {config.autoContinue ? 'Hands-free' : 'Push-to-talk'}
              </button>
            </div>

            <div className="mt-3 text-center text-[10px] leading-relaxed text-zinc-600">
              {phase === 'idle' && 'Tap the orb and just talk to Infinite AI'}
              {phase === 'listening' && (useCloudStt ? 'Recording — pause a moment to send' : 'Listening — pause a moment to send')}
              {phase === 'thinking' && 'Tap to stop the run'}
              {phase === 'speaking' && 'Tap to interrupt and talk back'}
            </div>
          </section>

          {/* Taught commands */}
          <section className="voice-card shrink-0 p-4">
            <div className="flex items-center gap-2">
              <Command size={12} className="text-amber-300" strokeWidth={1.9} />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Taught commands</h3>
              <span className="ml-auto font-mono text-[10px] text-zinc-600">{customCommands.length}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
              Say the phrase, Infinite AI answers with what you taught it.
            </p>
            <div className="mt-3 space-y-2">
              {customCommands.length === 0 && (
                <p className="rounded-lg border border-dashed border-white/[0.08] px-2.5 py-2 text-[11px] text-zinc-600">
                  Nothing taught yet — try “open email” → a spoken confirmation.
                </p>
              )}
              {customCommands.map((cmd) => (
                <div key={cmd.id} className="group flex items-start justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                  <div className="min-w-0 text-[11px] leading-relaxed">
                    <span className="font-mono text-amber-300/90">“{cmd.trigger}”</span>
                    <span className="mx-1.5 text-zinc-600">→</span>
                    <span className="break-words text-zinc-400">{cmd.action}</span>
                  </div>
                  <button
                    onClick={() => void removeCommand(cmd.trigger)}
                    className="mt-0.5 flex-shrink-0 text-zinc-600 opacity-0 transition-all hover:text-rose-400 group-hover:opacity-100"
                    aria-label={`Remove command ${cmd.trigger}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <div className="flex gap-1.5 pt-0.5">
                <input
                  type="text"
                  placeholder="Trigger phrase"
                  value={newTrigger}
                  onChange={(e) => setNewTrigger(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addCommand(); }}
                  className="voice-field min-w-0 flex-1 !text-[11px]"
                />
                <input
                  type="text"
                  placeholder="What to respond"
                  value={newAction}
                  onChange={(e) => setNewAction(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addCommand(); }}
                  className="voice-field min-w-0 flex-1 !text-[11px]"
                />
                <button
                  onClick={() => void addCommand()}
                  disabled={!newTrigger.trim() || !newAction.trim()}
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-amber-500/90 text-white transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Add command"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          </section>

          {/* Heard intents */}
          <section className="voice-card shrink-0 p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300">Heard intents</h3>
              <span className="font-mono text-[10px] text-zinc-600">{history.length}</span>
              {history.length > 0 && (
                <button onClick={() => void clearHistory()} className="ml-auto text-[10px] text-zinc-600 transition-colors hover:text-rose-400">
                  Clear
                </button>
              )}
            </div>
            <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
              {history.length === 0 && <p className="text-[11px] text-zinc-600">Phrases you speak show up here.</p>}
              {[...history].reverse().slice(0, 30).map((entry) => {
                const meta = INTENT_META[entry.intent] ?? INTENT_META.chat;
                return (
                  <div key={entry.id} className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5">
                    <span className={`mt-0.5 flex-shrink-0 rounded-full border px-1.5 py-px text-[9px] uppercase tracking-wide ${meta.className}`}>
                      {meta.label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-zinc-300">{entry.transcript}</p>
                      {entry.response && <p className="truncate text-[10px] text-zinc-600">{entry.response}</p>}
                    </div>
                    <span className="mt-0.5 flex-shrink-0 font-mono text-[9px] text-zinc-700">
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/**
 * Renders an assistant turn's content blocks the same way chat does: markdown
 * text, fenced code (syntax highlighted, copyable), and a live ToolCallCard for
 * every `tool_use`. This is what makes a spoken answer auditable — you can see
 * the commands it ran and the code it wrote, not just the sentence it read out.
 */
function VoiceAssistantBlocks({
  blocks,
  runningToolIds,
  streaming,
}: {
  blocks: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
  >;
  runningToolIds: Set<string>;
  streaming: boolean;
}) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        if (block.type === 'tool_use') {
          const id = block.id || `tool-${i}`;
          return (
            <ToolCallCard
              key={`tool-${id}`}
              name={block.name}
              input={block.input}
              status={runningToolIds.has(block.id) ? 'running' : 'done'}
              startTime={runningToolIds.has(block.id) ? Date.now() - 1000 : undefined}
            />
          );
        }
        const text = block.text ?? '';
        if (!text.trim()) return null;
        return (
          <div key={i} className="relative rounded-2xl rounded-bl-md border border-white/[0.07] bg-[#12131a] py-2.5 pl-4 pr-4">
            <span
              className={`absolute bottom-3 left-0 top-3 w-px ${streaming ? 'animate-pulse bg-cyan-400/70' : 'bg-gradient-to-b from-violet-400/60 to-cyan-400/20'}`}
            />
            <div className="text-[13px] leading-relaxed text-zinc-200">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  code({ className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || '');
                    const rawCode = String(children).replace(/\n$/, '');
                    // Inline code stays inline; fenced blocks get the real
                    // highlighter with a copy button.
                    if (!match) {
                      return (
                        <code className={`${className ?? ''} rounded bg-white/[0.07] px-1 py-0.5 font-mono text-[12px] text-cyan-200`} {...props}>
                          {children}
                        </code>
                      );
                    }
                    if (match[1]?.toLowerCase() === 'mermaid') {
                      return <MermaidDiagram code={rawCode} />;
                    }
                    return <CodeBlock code={rawCode} language={match[1]} />;
                  },
                  pre({ children }) {
                    // CodeBlock already renders its own chrome.
                    return <>{children}</>;
                  },
                  a({ children, href, ...props }) {
                    return (
                      <a href={href} target="_blank" rel="noreferrer" className="text-cyan-300 underline decoration-cyan-400/40 underline-offset-2 hover:decoration-cyan-300" {...props}>
                        {children}
                      </a>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-2 last:mb-0">{children}</p>;
                  },
                  ul({ children }) {
                    return <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>;
                  },
                  ol({ children }) {
                    return <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>;
                  },
                  table({ children }) {
                    return (
                      <div className="my-2 overflow-x-auto">
                        <table className="w-full border-collapse text-[12px]">{children}</table>
                      </div>
                    );
                  },
                  th({ children }) {
                    return <th className="border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-left font-medium text-zinc-200">{children}</th>;
                  },
                  td({ children }) {
                    return <td className="border border-white/[0.08] px-2 py-1 text-zinc-300">{children}</td>;
                  },
                }}
              >
                {text}
              </ReactMarkdown>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Section heading used across the settings sheet — kicker + plain title. */
function GroupHead({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.16em] text-zinc-300">
        {kicker}
      </span>
      <span className="text-[11px] text-zinc-500">{title}</span>
    </div>
  );
}