import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '../../shared/types';
import {
  audioDataMime,
  contentToPlainText,
  extractSpeakableSentences,
  isSilentCapture,
  isUtteranceComplete,
  lastAssistantReply,
  pickVoice,
  speakWithBrowserVoice,
  spokenReplyText,
  ttsProviderLabel,
} from './voiceConversation';

const text = (value: string): ContentBlock => ({ type: 'text', text: value });
const toolUse: ContentBlock = { type: 'tool_use', id: 't1', name: 'read', input: {} };

describe('contentToPlainText', () => {
  it('joins text blocks and skips tool blocks', () => {
    expect(contentToPlainText([toolUse, text('Hello'), text('world')])).toBe('Hello\nworld');
  });

  it('handles legacy string content and empty input', () => {
    expect(contentToPlainText('  direct  ')).toBe('direct');
    expect(contentToPlainText(undefined)).toBe('');
    expect(contentToPlainText([toolUse])).toBe('');
  });
});

describe('spokenReplyText', () => {
  it('drops code fences so TTS never reads source aloud', () => {
    const spoken = spokenReplyText('Done! ```js\nconst x = 1;\n```\nFile saved.');
    expect(spoken).toBe('Done! File saved.');
  });

  it('strips emphasis, headers, and collapses links to their label', () => {
    const spoken = spokenReplyText('## **Results**\nSee [the docs](https://example.com) for `details`.');
    expect(spoken).toBe('Results See the docs for details.');
  });

  it('returns plain text unchanged apart from whitespace', () => {
    expect(spokenReplyText('All   set.')).toBe('All set.');
  });
});

describe('lastAssistantReply', () => {
  it('returns the newest non-empty assistant reply', () => {
    const messages = [
      { role: 'user', content: [text('hi')] },
      { role: 'assistant', content: [text('first')] },
      { role: 'assistant', content: [toolUse] },
      { role: 'assistant', content: [text('second')] },
    ];
    expect(lastAssistantReply(messages)).toBe('second');
  });

  it('returns empty when there is no assistant reply', () => {
    expect(lastAssistantReply([{ role: 'user', content: [text('hi')] }])).toBe('');
    expect(lastAssistantReply([])).toBe('');
  });
});

describe('isUtteranceComplete', () => {
  it('requires a real pause after the last speech', () => {
    const now = 10_000;
    expect(isUtteranceComplete(now - 500, now)).toBe(false);
    expect(isUtteranceComplete(now - 1_400, now)).toBe(true);
    expect(isUtteranceComplete(0, now)).toBe(false);
  });

  it('honors a custom silence window', () => {
    expect(isUtteranceComplete(8_000, 10_000, 3_000)).toBe(false);
    expect(isUtteranceComplete(6_000, 10_000, 3_000)).toBe(true);
  });
});

describe('audioDataMime + ttsProviderLabel', () => {
  it('sniffs WAV vs MP3 from magic bytes', () => {
    expect(audioDataMime('UklGRi4AAABXQVZFZm10IA==')).toBe('audio/wav');
    expect(audioDataMime('//uQxAAAAAAAAAAAAAAAAAAAA')).toBe('audio/mpeg');
  });

  it('names every TTS provider for status lines', () => {
    expect(ttsProviderLabel('piper-tts')).toBe('Local Piper (offline)');
    expect(ttsProviderLabel('kokoro-tts')).toBe('Local Kokoro (offline)');
    expect(ttsProviderLabel('openai-tts')).toBe('OpenAI');
    expect(ttsProviderLabel('openrouter-tts')).toBe('OpenRouter');
    expect(ttsProviderLabel('edge-tts')).toBe('Edge (free)');
    expect(ttsProviderLabel(undefined)).toBe('Browser voice');
    expect(ttsProviderLabel('something-new')).toBe('Browser voice');
  });
});

describe('extractSpeakableSentences', () => {
  it('releases complete sentences and holds the half-spoken tail', () => {
    const { chunks, consumed } = extractSpeakableSentences('Hello world. How are');
    expect(chunks).toEqual(['Hello world.']);
    expect(consumed).toBe('Hello world.'.length);
  });

  it('releases a sentence at the very end of the buffer', () => {
    const { chunks, consumed } = extractSpeakableSentences('First. Second.');
    expect(chunks).toEqual(['First.', 'Second.']);
    expect(consumed).toBe('First. Second.'.length);
  });

  it('never splits decimals or abbreviations', () => {
    // The unterminated "Great" stays held for the turn-end flush.
    const { chunks, consumed } = extractSpeakableSentences('Pi is about 3.5 stars. Great');
    expect(chunks).toEqual(['Pi is about 3.5 stars.']);
    expect(consumed).toBe('Pi is about 3.5 stars.'.length);
    // "e.g." followed by lowercase is not a boundary — held for more text.
    const held = extractSpeakableSentences('Use e.g. stuff');
    expect(held.chunks).toEqual([]);
    expect(held.consumed).toBe(0);
  });

  it('holds everything from an unclosed code fence, speaks the prose before it', () => {
    const { chunks, consumed } = extractSpeakableSentences('Intro sentence. ```js\nconst x = 1;');
    expect(chunks).toEqual(['Intro sentence.']);
    expect(consumed).toBe('Intro sentence. '.length);
  });

  it('strips complete code fences instead of speaking them', () => {
    const { chunks } = extractSpeakableSentences('Say this. ```js\nvar x = 1;\n``` Done now.');
    expect(chunks).toEqual(['Say this.', 'Done now.']);
  });

  it('keeps parenthesized endings with their sentence', () => {
    const { chunks } = extractSpeakableSentences('Done (mostly). Next step.');
    expect(chunks).toEqual(['Done (mostly).', 'Next step.']);
  });

  it('returns nothing for empty input', () => {
    expect(extractSpeakableSentences('   ')).toEqual({ chunks: [], consumed: 0 });
  });
});

describe('isSilentCapture', () => {
  it('skips transcription for room-tone takes', () => {
    // Never loud, peaked at a quarter of the threshold: pure silence.
    expect(isSilentCapture(0.003, false)).toBe(true);
    expect(isSilentCapture(0, false)).toBe(true);
  });

  it('transcribes anything that got loud, however briefly', () => {
    expect(isSilentCapture(0.003, true)).toBe(false);
    expect(isSilentCapture(0.05, true)).toBe(false);
  });

  it('transcribes the grey band — possibly a quiet voice', () => {
    // Between half and full threshold: distant speech Whisper hears fine.
expect(isSilentCapture(0.008, false)).toBe(false);
    expect(isSilentCapture(0.011, false)).toBe(false);
  });
});

describe('speakWithBrowserVoice', () => {
  const david = { name: 'Microsoft David', lang: 'en-US', default: true } as SpeechSynthesisVoice;
  const zira = { name: 'Microsoft Zira', lang: 'en-US', default: false } as SpeechSynthesisVoice;

  /** Minimal stand-in for Chromium: voices arrive late, via `voiceschanged`. */
  function stubChromium() {
    let voices: SpeechSynthesisVoice[] = [];
    const listeners = new Set<() => void>();
    const spoken: SpeechSynthesisUtterance[] = [];
    const fake = {
      getVoices: () => voices,
      addEventListener: (_e: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_e: string, fn: () => void) => listeners.delete(fn),
      // Chromium fires `onend` when the utterance finishes; without it the
      // handle's `done` promise can never settle and the test hangs.
      speak: (u: SpeechSynthesisUtterance) => {
        spoken.push(u);
        queueMicrotask(() => u.onend?.({} as SpeechSynthesisEvent));
      },
      cancel: () => {},
    };
    const win = {
      speechSynthesis: fake,
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      setInterval: globalThis.setInterval.bind(globalThis),
      clearInterval: globalThis.clearInterval.bind(globalThis),
    };
    (globalThis as Record<string, unknown>).window = win;
    (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = function (this: Record<string, unknown>, text: string) {
      Object.assign(this, { text, onend: null, onerror: null, voice: null });
    };
    const publish = (next: SpeechSynthesisVoice[]) => {
      voices = next;
      listeners.forEach((fn) => fn());
    };
    return { spoken, publish };
  }

  it('waits for a cold-start empty voice list instead of giving up', async () => {
    const { spoken, publish } = stubChromium();
    // The regression: Chromium reads back ZERO voices right after launch.
    // The old code read once, saw empty, and abandoned a working voice.
    const handle = speakWithBrowserVoice('hello there', { voiceLoadTimeoutMs: 2_000 });
    expect(spoken).toHaveLength(0);

    publish([david, zira]); // voices land a moment later
    const result = await handle.done;

    expect(result.ok).toBe(true);
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('hello there');
  });

  it('polls even when no voiceschanged event fires', async () => {
    const { spoken } = stubChromium();
    const handle = speakWithBrowserVoice('polled', { voiceLoadTimeoutMs: 2_000 });

    // Some platforms populate the list WITHOUT announcing it.
    (globalThis as never as { window: { speechSynthesis: { getVoices: () => SpeechSynthesisVoice[] } } }).window.speechSynthesis.getVoices =
      () => [david];

    const result = await handle.done;
    expect(result.ok).toBe(true);
    expect(spoken).toHaveLength(1);
  });

  it('reports honestly when no system voice exists at all', async () => {
    stubChromium();
    const result = await speakWithBrowserVoice('anyone home?', { voiceLoadTimeoutMs: 300 }).done;

    // Must NOT claim success: callers used to report "Speaking" into silence.
    expect(result.ok).toBe(false);
    expect(result.noVoices).toBe(true);
    expect(result.error).toMatch(/no system voice/i);
  });

  it('applies rate, pitch and volume to the utterance', async () => {
    const { spoken } = stubChromium();
    const handle = speakWithBrowserVoice('shape me', {
      rate: 1.4,
      pitch: 0.8,
      volume: 0.5,
    });
    // Voices are already present? No — publish via the poll by stubbing sync.
    (globalThis as never as { window: { speechSynthesis: { getVoices: () => SpeechSynthesisVoice[] } } }).window.speechSynthesis.getVoices =
      () => [david];

    await handle.done;
    expect(spoken[0].rate).toBeCloseTo(1.4);
    expect(spoken[0].pitch).toBeCloseTo(0.8);
    expect(spoken[0].volume).toBeCloseTo(0.5);
  });

  it('resolves immediately for blank text without touching the engine', async () => {
    stubChromium();
    const result = await speakWithBrowserVoice('   ').done;
    expect(result.ok).toBe(true);
  });
});

describe('pickVoice', () => {
  const en = { name: 'en', lang: 'en-US', default: false } as SpeechSynthesisVoice;
  const enDefault = { name: 'enDef', lang: 'en-GB', default: true } as SpeechSynthesisVoice;
  const fr = { name: 'fr', lang: 'fr-FR', default: false } as SpeechSynthesisVoice;

  it('prefers an exact language match over the default voice', () => {
    expect(pickVoice([enDefault, en], 'en-US')?.name).toBe('en');
  });

  it('falls back to any voice for the same base language', () => {
    expect(pickVoice([enDefault, fr], 'en-AU')?.name).toBe('enDef');
  });

  it('prefers a same-language voice when the exact tag is missing', () => {
    expect(pickVoice([en, fr], 'fr-CA')?.name).toBe('fr');
  });

  it('returns null when nothing is installed', () => {
    expect(pickVoice([], 'en-US')).toBeNull();
  });
});

