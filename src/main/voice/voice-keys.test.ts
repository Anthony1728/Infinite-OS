// The saved OpenAI provider key must light up STT/TTS — with no separate
// voice key, no restart, and without ever clobbering a key set live this
// session (persistence is best-effort by contract).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// VoiceManager writes temp audio under the profile home — never the real one.
const savedHome = process.env.INFINITE_TEST_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'infinite-voice-keys-'));

import { VoiceManager } from './index.js';

beforeAll(() => {
  process.env.INFINITE_TEST_HOME = testHome;
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
  vi.unstubAllGlobals();
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch { /* best-effort */ }
});

let lastAuth = '';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      lastAuth = init?.headers?.Authorization ?? '';
      return {
        ok: true,
        json: async () => ({ text: 'transcribed' }),
        // Real TTS payloads are KB-scale; VoiceManager's silence guard
        // (buffers < 1024 bytes count as a provider miss) skips tiny ones
        // and falls through the chain — which would spawn Edge TTS here.
        arrayBuffer: async () => new Uint8Array(2048).fill(1).buffer,
      } as unknown as Response;
    }),
  );
});

/** Run a transcription against a throwaway fetch stub; return the auth header used. */
async function sttAuth(voice: VoiceManager): Promise<string> {
  lastAuth = '';
  await voice.speechToText(Buffer.from('audio'));
  return lastAuth;
}

async function ttsAuth(voice: VoiceManager): Promise<string> {
  lastAuth = '';
  await voice.textToSpeech('hello');
  return lastAuth;
}

function store(keys: Record<string, string>) {
  return async (id: string) => keys[id] ?? '';
}

describe('VoiceManager secret-key sync', () => {
  it('adopts the saved OpenAI provider key for both sides', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openai: 'sk-provider' }));

    expect(voice.hasSttKey()).toBe(true);
    expect(voice.hasTtsKey()).toBe(true);
    expect(voice.getDefaultVoice()).toBe('alloy');
    expect(await sttAuth(voice)).toBe('Bearer sk-provider');
    expect(await ttsAuth(voice)).toBe('Bearer sk-provider');
  });

  it('prefers dedicated voice keys over the provider key', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(
      store({ 'voice-stt': 'sk-dedicated', 'voice-tts': 'sk-voice-tts', openai: 'sk-provider' }),
    );

    expect(await sttAuth(voice)).toBe('Bearer sk-dedicated');
    expect(await ttsAuth(voice)).toBe('Bearer sk-voice-tts');
  });

  it('ignores the synced provider key when a transcript is pinned local', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openai: 'sk-provider' }));
    lastAuth = '';

    // Temp home → no local model → fails on the local path with the local
    // message, and the stubbed fetch never sees a cloud request.
    await expect(
      voice.speechToText(Buffer.from('audio'), 'mp3', { local: true }),
    ).rejects.toThrow(/Local speech-to-text is not installed/);
    expect(lastAuth).toBe('');
  });

  it('follows a rotated provider key without a restart', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openai: 'sk-old' }));
    expect(await sttAuth(voice)).toBe('Bearer sk-old');

    // The user edited their key in Settings → Providers mid-session.
    await voice.syncKeysFromSecrets(store({ openai: 'sk-new' }));
    expect(await sttAuth(voice)).toBe('Bearer sk-new');
  });

  it('revokes voice when the provider key is deleted', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openai: 'sk-only' }));
    expect(voice.hasSttKey()).toBe(true);
    expect(voice.hasTtsKey()).toBe(true);

    await voice.syncKeysFromSecrets(store({}));
    expect(voice.hasSttKey()).toBe(false);
    expect(voice.hasTtsKey()).toBe(false);
  });

  it('never clobbers a live key whose persistence failed', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({}));
    // keys:set applied this key live; the secrets write then failed, so a
    // later sync still reads an empty store — the session key must survive.
    voice.setSttKey('sk-live');
    await voice.syncKeysFromSecrets(store({}));

    expect(voice.hasSttKey()).toBe(true);
    expect(await sttAuth(voice)).toBe('Bearer sk-live');
  });
});
