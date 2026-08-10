import { useCallback, useEffect, useRef, useState } from 'react';

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
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguageState] = useState(preferredLanguage);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldListenRef = useRef(false);
  const nativeActiveRef = useRef(false);
  const nativeFinalPartsRef = useRef<string[]>([]);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!window.api?.onVoiceTranscript) return undefined;
    setIsSupported(true);
    return window.api.onVoiceTranscript((event: NativeDictationEventLike) => {
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
    setError(null);
    nativeFinalPartsRef.current = [];
    shouldListenRef.current = true;
    nativeActiveRef.current = true;
    setIsListening(true);

    void window.api.voiceStartListening().then((result: { ok?: boolean; error?: string }) => {
      if (result?.ok) {
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
      } catch {
        shouldListenRef.current = false;
        setIsListening(false);
        setError('The microphone is already busy. Wait a moment and try again.');
      }
    }).catch((cause: unknown) => {
      shouldListenRef.current = false;
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
      // Try main-process TTS first (Edge TTS / OpenAI) — returns base64 mp3.
      const result = await window.api.voiceTTS({ text });
      if (result && typeof result === 'string') {
        const audio = new Audio(`data:audio/mpeg;base64,${result}`);
        await audio.play();
        return;
      }
    } catch {
      // Fall through to browser SpeechSynthesis.
    }
    // Fallback: browser built-in speech synthesis.
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      window.speechSynthesis.speak(utterance);
    }
  }, [language]);

  return {
    error,
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
