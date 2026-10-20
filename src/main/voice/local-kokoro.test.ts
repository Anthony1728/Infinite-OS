// Local Kokoro TTS: model-gated availability (filesystem first, so tests and
// fresh installs never spawn Python), voice allow-listing, loud pinned
// failures, and the persistent worker's request/response protocol.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// VoiceManager resolves every local asset under the profile home — point it
// at a temp directory so these tests see no Kokoro model and can never touch
// the real profile.
const savedHome = process.env.INFINITE_TEST_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'infinite-local-kokoro-'));

import { KokoroTTSProvider, VoiceManager, resolveKokoroVoice } from './index.js';
import { KokoroWorkerSession, hasKokoroAssets, resolveKokoroAssets } from './kokoro-worker.js';

beforeAll(() => {
  process.env.INFINITE_TEST_HOME = testHome;
});

afterAll(() => {
  if (savedHome === undefined) delete process.env.INFINITE_TEST_HOME;
  else process.env.INFINITE_TEST_HOME = savedHome;
  try {
    rmSync(testHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const store = (keys: Record<string, string>) => async (id: string) => keys[id] ?? '';

describe('local Kokoro assets', () => {
  it('reports unavailable when no model is on disk (no Python spawned)', () => {
    expect(hasKokoroAssets()).toBe(false);
    expect(resolveKokoroAssets()).toBe(null);
    expect(new KokoroTTSProvider().isAvailable()).toBe(false);
    const voice = new VoiceManager();
    expect(voice.hasLocalKokoro()).toBe(false);
  });

  it('finds the model in the Node layout (<home>/voices/kokoro)', () => {
    const dir = join(testHome, 'voices', 'kokoro');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(dir, 'voices-v1.0.bin'), '');
    expect(hasKokoroAssets()).toBe(true);
    expect(resolveKokoroAssets()?.model).toBe(join(dir, 'kokoro-v1.0.onnx'));
    rmSync(join(testHome, 'voices'), { recursive: true, force: true });
  });

  // local_voice_server.py writes to the singular voice/kokoro — looking only
  // at voices/kokoro reported "no Kokoro" and silently skipped the offline
  // voice for every synthesis.
  it('finds the model in the Python server layout (<home>/voice/kokoro)', () => {
    const dir = join(testHome, 'voice', 'kokoro');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'kokoro-v1.0.int8.onnx'), '');
    writeFileSync(join(dir, 'voices-v1.0.bin'), '');
    expect(hasKokoroAssets()).toBe(true);
    expect(resolveKokoroAssets()?.model).toBe(join(dir, 'kokoro-v1.0.int8.onnx'));
    rmSync(join(testHome, 'voice'), { recursive: true, force: true });
  });

  it('reports unavailable again once both layouts are empty', () => {
    expect(hasKokoroAssets()).toBe(false);
    expect(resolveKokoroAssets()).toBe(null);
  });

  it('a pinned kokoro source fails loudly instead of switching providers', async () => {
    const voice = new VoiceManager();
    await voice.syncKeysFromSecrets(store({ openai: 'sk-oa', openrouter: 'sk-or-v1' }));

    // Even with cloud keys present, pinning 'kokoro' must not fall through
    // to OpenAI/OpenRouter/Edge.
    await expect(voice.textToSpeech('hi', undefined, { source: 'kokoro' })).rejects.toThrow(
      /\(source: kokoro\)/,
    );
  });
});

describe('resolveKokoroVoice', () => {
  it('keeps listed voices and defaults the rest', () => {
    expect(resolveKokoroVoice('af_heart')).toBe('af_heart');
    expect(resolveKokoroVoice('bm_george')).toBe('bm_george');
    expect(resolveKokoroVoice('alloy')).toBe('af_heart');
    expect(resolveKokoroVoice('')).toBe('af_heart');
    expect(resolveKokoroVoice(undefined)).toBe('af_heart');
  });
});

describe('KokoroWorkerSession protocol', () => {
  function fakeSpawn() {
    const stdout = new EventEmitter() as EventEmitter & { setEncoding: (_e: string) => void };
    stdout.setEncoding = () => undefined;
    const stderr = new EventEmitter() as EventEmitter & { setEncoding: (_e: string) => void };
    stderr.setEncoding = () => undefined;
    const written: string[] = [];
    const child = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      stderr: typeof stderr;
      stdin: { write: (s: string) => boolean };
      kill: () => void;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
      write: (s: string) => {
        written.push(s);
        return true;
      },
    };
    child.kill = () => undefined;
    return { child, stdout, written };
  }

  // synthesize() chains through promises: yield so the session spawns and
  // attaches its stdout listeners before the fake worker talks.
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('correlates responses by id and decodes base64 audio', async () => {
    const fake = fakeSpawn();
    const session = new KokoroWorkerSession(
      { script: 'worker.py', model: 'm.onnx', voices: 'v.bin' },
      (() => fake.child) as never,
    );
    const pending = session.synthesize('hello world');
    await tick();
    fake.stdout.emit('data', '{"ready": true}\n');
    await tick();
    const req = JSON.parse(fake.written[0]) as { id: number; text: string; voice: string };
    expect(req.text).toBe('hello world');
    expect(req.voice).toBe('af_heart');
    const wav = Buffer.from('RIFF-test-audio-payload');
    fake.stdout.emit('data', `${JSON.stringify({ id: req.id, ok: true, audio: wav.toString('base64') })}\n`);
    await expect(pending).resolves.toEqual(wav);
    session.shutdown();
    expect(fake.written.some((w) => w.includes('"shutdown"'))).toBe(true);
  });

  it('surfaces worker errors instead of hanging', async () => {
    const fake = fakeSpawn();
    const session = new KokoroWorkerSession(
      { script: 'worker.py', model: 'm.onnx', voices: 'v.bin' },
      (() => fake.child) as never,
    );
    const pending = session.synthesize('boom');
    await tick();
    fake.stdout.emit('data', '{"ready": true}\n');
    await tick();
    const req = JSON.parse(fake.written[0]) as { id: number };
    fake.stdout.emit('data', `${JSON.stringify({ id: req.id, ok: false, error: 'bad voice' })}\n`);
    await expect(pending).rejects.toThrow('bad voice');
    session.shutdown();
  });

  it('serializes concurrent syntheses in order', async () => {
    const fake = fakeSpawn();
    const session = new KokoroWorkerSession(
      { script: 'worker.py', model: 'm.onnx', voices: 'v.bin' },
      (() => fake.child) as never,
    );
    const first = session.synthesize('one');
    const second = session.synthesize('two');
    await tick();
    fake.stdout.emit('data', '{"ready": true}\n');
    await tick();
    // Only the first request has been written — the second waits its turn.
    expect(fake.written).toHaveLength(1);
    const req1 = JSON.parse(fake.written[0]) as { id: number };
    fake.stdout.emit('data', `${JSON.stringify({ id: req1.id, ok: true, audio: Buffer.from('a1').toString('base64') })}\n`);
    await expect(first).resolves.toEqual(Buffer.from('a1'));
    await tick();
    expect(fake.written).toHaveLength(2);
    const req2 = JSON.parse(fake.written[1]) as { id: number };
    expect(req2.id).not.toBe(req1.id);
    fake.stdout.emit('data', `${JSON.stringify({ id: req2.id, ok: true, audio: Buffer.from('a2').toString('base64') })}\n`);
    await expect(second).resolves.toEqual(Buffer.from('a2'));
    session.shutdown();
  });
});
