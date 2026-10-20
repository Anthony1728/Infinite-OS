import { useCallback, useEffect, useRef, useState } from 'react';
import { audioDataMime, speakWithBrowserVoice } from '../lib/voiceConversation';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface NativeDictationEventLike {
  type: string;
  transcript?: string;
  confidence?: number;
  final?: boolean;
  language?: string;
  message?: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

const SPEECH_LANGUAGE_KEY = 'infinite:speech-language';

function preferredLanguage() {
  if (typeof window === 'undefined') return 'en-US';
  return localStorage.getItem(SPEECH_LANGUAGE_KEY) || navigator.language || 'en-US';
}

function recognitionErrorMessage(error: string) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow microphone access for Infinite OS, then try again.';
    case 'audio-capture':
      return 'No working microphone was found. Check the selected Windows input device.';
    case 'network':
      return 'The system speech service is unavailable. Check the connection and try again.';
    case 'no-speech':
      return 'No speech was detected. Speak clearly and keep the microphone close.';
    default:
      return 'Dictation stopped unexpectedly. Try again.';
  }
}

function bestAlternative(result: SpeechRecognitionResultLike) {
  let best = result[0];
  for (let index = 1; index < result.length; index += 1) {
    if ((result[index]?.confidence ?? 0) > (best?.confidence ?? 0)) best = result[index];
  }
  return best?.transcript?.trim() ?? '';
}

export function transcriptFromResults(results: SpeechRecognitionEventLike['results']) {
  const finalParts: string[] = [];
  const interimParts: string[] = [];
  for (let index = 0; index < results.length; index += 1) {
    const text = bestAlternative(results[index]);
    if (!text) continue;
    (results[index].isFinal ? finalParts : interimParts).push(text);
  }
  return {
    finalTranscript: finalParts.join(' ').trim(),
    interimTranscript: interimParts.join(' ').trim(),
    transcript: [...finalParts, ...interimParts].join(' ').trim(),
  };
}

export function useVoiceAssistant() {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [engine, setEngine] = useState<'local-whisper' | 'windows-local' | 'browser' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguageState] = useState(preferredLanguage);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldListenRef = useRef(false);
  const nativeActiveRef = useRef(false);
  // Set when native (Windows) dictation fails and the browser engine takes
  // over: late events from the failed native attempt must be ignored so they
  // cannot clobber the browser session's state.
  const demotedRef = useRef(false);
  const nativeFinalPartsRef = useRef<string[]>([]);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.api?.onVoiceTranscript) return undefined;
    setIsSupported(true);
    const dispose = window.api.onVoiceTranscript((event: NativeDictationEventLike) => {
      if (demotedRef.current) return;
      if (event.type === 'ready') {
        nativeActiveRef.current = true;
        setIsListening(true);
        setError(null);
        if (event.language) setLanguageState(event.language);
        return;
      }
      if (event.type === 'result' && event.transcript) {
        const phrase = event.transcript.trim();
        if (event.final) {
          nativeFinalPartsRef.current.push(phrase);
          setInterimTranscript('');
          setFinalTranscript(nativeFinalPartsRef.current.join(' ').trim());
        } else {
          setInterimTranscript(phrase);
        }
        setTranscript([...nativeFinalPartsRef.current, ...(event.final ? [] : [phrase])].join(' ').trim());
        setError(null);
        return;
      }
      if (event.type === 'error') {
        setError(event.message || 'Windows could not recognize that speech clearly.');
        return;
      }
      if (event.type === 'ended') {
        nativeActiveRef.current = false;
        setIsListening(false);
        if (event.message) setError(event.message);
      }
    });
    return () => {
      dispose();
      // Never leave the main-process recognizer running after unmount.
      if (nativeActiveRef.current) {
        nativeActiveRef.current = false;
        shouldListenRef.current = false;
        void window.api.voiceStopListening();
      }
    };
  }, []);

  useEffect(() => {
    const win = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRecognition = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRecognition) return undefined;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;
    recognition.lang = language;
    recognition.onresult = (event) => {
      const next = transcriptFromResults(event.results);
      setTranscript(next.transcript);
      setInterimTranscript(next.interimTranscript);
      setFinalTranscript(next.finalTranscript);
      setError(null);
    };
    recognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      const recoverable = event.error === 'no-speech';
      setError(recognitionErrorMessage(event.error));
      if (!recoverable) {
        shouldListenRef.current = false;
        setIsListening(false);
      }
    };
    recognition.onend = () => {
      if (!shouldListenRef.current) {
        setIsListening(false);
        return;
      }
      restartTimerRef.current = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          shouldListenRef.current = false;
          setIsListening(false);
          setError('Dictation could not restart. Press Dictate to try again.');
        }
      }, 180);
    };
    recognitionRef.current = recognition;
    setIsSupported(true);

    return () => {
      shouldListenRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognition.onend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.abort?.();
      recognitionRef.current = null;
    };
  }, [language]);

  useEffect(() => {
    if (recognitionRef.current) recognitionRef.current.lang = language;
  }, [language]);

  const startListening = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setFinalTranscript('');
    setError(null);
    setEngine(null);
    nativeFinalPartsRef.current = [];
    shouldListenRef.current = true;
    nativeActiveRef.current = true;
    setIsListening(true);

    void window.api.voiceStartListening().then((result: { ok?: boolean; error?: string; engine?: string }) => {
      // The user may have pressed Stop while the engine was still starting;
      // a late "ok" must not re-arm a session nobody wants any more.
      if (!shouldListenRef.current) {
        nativeActiveRef.current = false;
        void window.api.voiceStopListening();
        return;
      }
      if (result?.ok) {
        setEngine(result.engine === 'local-whisper' ? 'local-whisper' : 'windows-local');
        return;
      }
      nativeActiveRef.current = false;
      const recognition = recognitionRef.current;
      if (!recognition) {
        shouldListenRef.current = false;
        setIsListening(false);
        setError(result?.error || 'No standalone speech recognizer is available.');
        return;
      }
      try {
        recognition.start();
        setEngine('browser');
      } catch {
        shouldListenRef.current = false;
        setIsListening(false);
        setError('The microphone is already busy. Wait a moment and try again.');
      }
    }).catch((cause: unknown) => {
      if (!shouldListenRef.current) return;
      shouldListenRef.current = false;
      nativeActiveRef.current = false;
      demotedRef.current = true;
      setIsListening(false);
      setError(cause instanceof Error ? cause.message : 'Windows dictation could not start.');
    });
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    if (nativeActiveRef.current) {
      nativeActiveRef.current = false;
      void window.api.voiceStopListening();
    } else {
      recognitionRef.current?.stop();
    }
    setInterimTranscript('');
    setIsListening(false);
  }, []);

  const setLanguage = useCallback((nextLanguage: string) => {
    setLanguageState(nextLanguage);
    localStorage.setItem(SPEECH_LANGUAGE_KEY, nextLanguage);
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      // Try main-process TTS first (local Piper / OpenAI / Edge) — base64 WAV or MP3.
      const result = (await window.api.voiceTTS({ text })) as
        | string
        | { audio?: string; provider?: string }
        | null
        | undefined;
      const encoded = typeof result === 'string' ? result : result?.audio;
      if (encoded) {
        const audio = new Audio(`data:${audioDataMime(encoded)};base64,${encoded}`);
        await audio.play();
        return;
      }
    } catch {
      // Fall through to browser SpeechSynthesis.
    }
    // Fallback: browser built-in speech synthesis. The helper waits for
    // Chromium's voice list to finish loading and only reports success when
    // audio actually came out — the old inline version spoke into an empty
    // list (cold start) and returned as if it had spoken.
    await speakWithBrowserVoice(text, { lang: language }).done;
  }, [language]);

  return {
    engine,
    error,
    finalTranscript,
    interimTranscript,
    isListening,
    isSupported,
    language,
    setLanguage,
    speak,
    startListening,
    stopListening,
    transcript,
  };
}
