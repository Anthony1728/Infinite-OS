// OpenRouter as a TTS source: the saved OpenRouter provider key must
// synthesize through https://openrouter.ai/api/v1/audio/speech with Bearer
// auth, honor an explicit source pin and a custom model slug, follow key
// rotation/deletion — and a pinned source must NEVER silently fall through
// to another provider (in tests that especially means never spawning the
// real `python -m edge_tts` process, which is installed on dev machines).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// VoiceManager writes temp audio under the profile home — never the real one.
const savedHome = process.env.INFINITE_TEST_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'infinite-or-tts-'));

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

let lastUrl = '';
let lastAuth = '';
let lastBody: Record<string, unknown> | null = null;
let fetchCalls = 0;

/** In-memory secrets: dedicated voice keys never exist here, so any key is
 *  the saved provider key from Settings → Providers. */
const store = (keys: Record<string, string>) => async (id: string) => keys[id] ?? '';

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown, init?: { headers?: Record<string, string>; body?: unknown }) => {
      fetchCalls += 1;
      lastUrl = String(url);
      lastAuth = init?.headers?.Authorization ?? '';
      lastBody = null;
      if (typeof init?.body === 'string') {
        try {
          lastBody = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          /* STT multipart bodies land here — not a JSON payload */
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'transcribed' }),
        // Real TTS payloads are KB-scale; VoiceManager's silence guard
        // (buffers < 1024 bytes count as a provider miss) skips tiny ones
        // and falls through the chain — which would spawn the real Edge TTS
        // process on dev machines (exactly what these tests forbid).
        arrayBuffer: async () => new Uint8Array(2048).fill(1).buffer,
      } as unknown as Response;
    }),
  );
});

beforeEach(() => {
  lastUrl = '';
  lastAuth = '';
  lastBody = null;
  fetchCalls = 0;
});

describe('OpenRouter TTS', () => {
  it('synthesizes through OpenRouter on the saved provider key (auto chain, no OpenAI key)', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openrouter: 'sk-or-v1' }));

    // The OpenRouter key lights up TTS only — STT is untouched (deferred).
    expect(voice.hasTtsKey()).toBe(true);
    expect(voice.hasSttKey()).toBe(false);
    expect(voice.getDefaultVoice()).toBe('alloy');

    const buffer = await voice.textToSpeech('hello world');

    expect(lastUrl).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(lastAuth).toBe('Bearer sk-or-v1');
    expect(lastBody).toMatchObject({
      model: 'deepgram/flux-tts:free',
      input: 'hello world',
      voice: 'flux-alexis-en',
      response_format: 'mp3',
    });
    expect(buffer.length).toBeGreaterThan(0);
    // Only the one HTTP call — the chain never reached Edge TTS.
    expect(fetchCalls).toBe(1);
  });

  it('honors an explicit source pin and a custom model slug', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openrouter: 'sk-or-v1' }));

    await voice.textToSpeech('pin me', 'nova', {
      source: 'openrouter',
      model: 'elevenlabs/eleven-turbo-v2',
    });

    expect(lastUrl).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(lastAuth).toBe('Bearer sk-or-v1');
    expect(lastBody).toMatchObject({
      model: 'elevenlabs/eleven-turbo-v2',
      voice: 'nova',
      response_format: 'mp3',
    });
    expect(fetchCalls).toBe(1);
  });

  it('an OpenAI key still wins auto order before OpenRouter', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openai: 'sk-oa', openrouter: 'sk-or-v1' }));

    await voice.textToSpeech('hi');

    expect(lastUrl).toContain('api.openai.com');
    expect(lastAuth).toBe('Bearer sk-oa');
    expect(fetchCalls).toBe(1);
  });

  it('a pinned unavailable source fails loudly instead of switching providers', async () => {
    const voice = new VoiceManager();
    // OpenAI key present — but a pinned openrouter call must NOT fall back
    // to it (or to Edge TTS).
    await voice.syncKeysFromSecrets(store({ openai: 'sk-oa' }));

    await expect(voice.textToSpeech('hi', undefined, { source: 'openrouter' })).rejects.toThrow(
      /\(source: openrouter\)/,
    );
    expect(fetchCalls).toBe(0);
  });

  it('follows OpenRouter key rotation and revocation', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openrouter: 'sk-or-old' }));
    await voice.textToSpeech('hi');
    expect(lastAuth).toBe('Bearer sk-or-old');

    await voice.syncKeysFromSecrets(store({ openrouter: 'sk-or-new' }));
    await voice.textToSpeech('hi');
    expect(lastAuth).toBe('Bearer sk-or-new');

    await voice.syncKeysFromSecrets(store({}));
    expect(voice.hasTtsKey()).toBe(false);
    expect(voice.getDefaultVoice()).not.toBe('alloy');

    // Pinned openrouter with the key revoked: error, no fetch, no Edge spawn.
    fetchCalls = 0;
    lastUrl = '';
    await expect(voice.textToSpeech('hi', undefined, { source: 'openrouter' })).rejects.toThrow(
      /\(source: openrouter\)/,
    );
    expect(fetchCalls).toBe(0);
    expect(lastUrl).toBe('');
  });

  it('an unknown voice name falls back to the OpenRouter model default', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openrouter: 'sk-or-v1' }));

    await voice.textToSpeech('hi', 'en-US-AvaNeural'); // an Edge-only id

    // The default model lists flux voices — 'alloy' isn't one of them.
    expect(lastBody).toMatchObject({ voice: 'flux-alexis-en' });
  });
});
