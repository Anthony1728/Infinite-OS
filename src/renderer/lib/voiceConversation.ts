// Pure helpers for the Voice conversation tab — kept free of React/Electron so
// the turn-taking rules are unit-testable.

import type { ContentBlock } from '../../shared/types';

/** Extract readable text from a message's content blocks (skips tool noise). */
export function contentToPlainText(content: ContentBlock[] | string | undefined): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export { extractSpeakableSentences, spokenReplyText } from '../../shared/voice-text';

/**
 * Base64 audio payload → MIME type: local Piper returns WAV (RIFF…), cloud
 * providers return MP3 — sniff the magic bytes instead of assuming mpeg.
 */
export function audioDataMime(base64: string): 'audio/wav' | 'audio/mpeg' {
  return base64.startsWith('UklGR') ? 'audio/wav' : 'audio/mpeg';
}

/** Main-process TTS provider id → human label for status lines. */
export function ttsProviderLabel(provider: string | undefined): string {
  switch (provider) {
    case 'piper-tts':
      return 'Local Piper (offline)';
    case 'kokoro-tts':
      return 'Local Kokoro (offline)';
    case 'openai-tts':
      return 'OpenAI';
    case 'openrouter-tts':
      return 'OpenRouter';
    case 'edge-tts':
      return 'Edge (free)';
    default:
      return 'Browser voice';
  }
}

/** Best installed voice for a language tag: exact, then base, then default. */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  const want = (lang || 'en-US').toLowerCase();
  const base = want.split('-')[0] ?? want;
  return (
    voices.find((v) => v.lang?.toLowerCase() === want) ??
    voices.find((v) => v.lang?.toLowerCase().startsWith(base)) ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

export interface BrowserVoiceResult {
  ok: boolean;
  error?: string;
  voice?: string;
  /** No system voice is installed at all, as opposed to a transient failure. */
  noVoices?: boolean;
}

export interface BrowserVoiceHandle {
  /** Settles once the utterance ends, errors, or is cancelled. */
  done: Promise<BrowserVoiceResult>;
  cancel: () => void;
}

/**
 * Speak through the OS voice Chromium exposes, waiting for the voice list to
 * finish loading first.
 *
 * Chromium fills `speechSynthesis.getVoices()` asynchronously and announces it
 * with `voiceschanged`: on a cold start the list reads back EMPTY for a second
 * or two even when Windows has perfectly good voices installed. A single
 * synchronous read therefore turned a working system voice into dead silence,
 * and callers that skipped the check reported "Speaking" while emitting no
 * sound at all. This polls until the list lands (bounded by a deadline) and
 * resolves truthfully so no caller can claim audio it never produced.
 */
export function speakWithBrowserVoice(
  text: string,
  opts: {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
    voiceLoadTimeoutMs?: number;
    timeoutMs?: number;
  } = {},
): BrowserVoiceHandle {
  const loadTimeout = opts.voiceLoadTimeoutMs ?? 5_000;
  const speakTimeout = opts.timeoutMs ?? 180_000;

  let settled = false;
  let cancelled = false;
  let teardown: () => void = () => {};
  let resolveDone: (result: BrowserVoiceResult) => void = () => {};

  const finish = (result: BrowserVoiceResult): void => {
    if (settled) return;
    settled = true;
    teardown();
    resolveDone(result);
  };

  const done = new Promise<BrowserVoiceResult>((resolve) => {
    resolveDone = resolve;

    if (!text.trim()) {
      finish({ ok: true });
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      finish({ ok: false, error: 'This window has no speech engine available.' });
      return;
    }

    const synth = window.speechSynthesis;
    let pollId = 0;
    let loadTimer = 0;

    function stopWatching(): void {
      window.clearInterval(pollId);
      window.clearTimeout(loadTimer);
      synth.removeEventListener('voiceschanged', onChanged);
    }

    function speakNow(): void {
      if (cancelled || settled) return;
      stopWatching();
      const voices = synth.getVoices();
      if (voices.length === 0) {
        finish({
          ok: false,
          noVoices: true,
          error:
            'Windows has no system voice installed to fall back to. Install one under Settings → Time & language → Speech, then try again.',
        });
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = opts.lang || 'en-US';
      utterance.rate = Math.min(2, Math.max(0.5, opts.rate ?? 1));
      utterance.pitch = Math.min(2, Math.max(0.5, opts.pitch ?? 1));
      utterance.volume = Math.min(1, Math.max(0, opts.volume ?? 1));
      utterance.voice = pickVoice(voices, utterance.lang);
      const safety = window.setTimeout(
        () => finish({ ok: true, voice: utterance.voice?.name }),
        speakTimeout,
      );
      teardown = () => window.clearTimeout(safety);
      utterance.onend = () => finish({ ok: true, voice: utterance.voice?.name });
      utterance.onerror = (event) => {
        const blocked = (event as SpeechSynthesisErrorEvent).error === 'not-allowed';
        finish({
          ok: false,
          error: blocked
            ? 'The browser blocked speech output (autoplay policy). Click Test voice — a click always allows playback.'
            : 'The system voice could not speak that reply.',
        });
      };
      try {
        synth.speak(utterance);
      } catch (error) {
        finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    function onChanged(): void {
      if (synth.getVoices().length > 0) speakNow();
    }

    teardown = stopWatching;
    if (synth.getVoices().length > 0) {
      speakNow();
      return;
    }
    // Listen AND poll: some platforms populate the list without firing
    // `voiceschanged`, and the poll also catches a list that lands instantly.
    synth.addEventListener('voiceschanged', onChanged);
    pollId = window.setInterval(() => {
      if (synth.getVoices().length > 0) speakNow();
    }, 200);
    loadTimer = window.setTimeout(() => speakNow(), loadTimeout);
  });

  return {
    done,
    cancel: () => {
      if (settled) return;
      cancelled = true;
      try {
        window.speechSynthesis.cancel();
      } catch { /* nothing was queued */ }
      finish({ ok: true });
    },
  };
}

/** The most recent assistant reply in a transcript, or '' when there is none. */
export function lastAssistantReply(
  messages: Array<{ role: string; content: ContentBlock[] | string }>,
): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const text = contentToPlainText(message.content);
    if (text) return text;
  }
  return '';
}

/**
 * A spoken turn is complete once the transcript has been quiet for
 * `silenceMs` — the same pause a person leaves before expecting a reply.
 */
export function isUtteranceComplete(lastSpeechAt: number, now: number, silenceMs = 1400): boolean {
  if (!lastSpeechAt) return false;
  return now - lastSpeechAt >= silenceMs;
}

/**
 * Client-side VAD gate: skip transcription entirely when the take was
 * silence. The analyser flags loud frames; anything peaking below half the
 * speech threshold is room tone, not quiet speech — sending it to Whisper
 * burns a full transcription cycle (model load + inference on a slow CPU)
 * to produce nothing. Between half and full threshold, transcribe anyway:
 * that band may be a distant or quiet voice, and Whisper hears it fine.
 */
export function isSilentCapture(maxRms: number, heardLoud: boolean, threshold = 0.012): boolean {
  if (heardLoud) return false;
  return maxRms < threshold * 0.5;
}
