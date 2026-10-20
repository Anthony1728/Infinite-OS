// Persistent faster-whisper STT worker: asset gating, warmup hooks, and the
// transcribe request/response protocol over the shared JSON-line session.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// VoiceManager resolves every local asset under the profile home — point it
// at a temp directory so these tests see no Whisper model and can never
// touch the real profile.
const savedHome = process.env.INFINITE_TEST_HOME;
const testHome = mkdtempSync(join(tmpdir(), 'infinite-whisper-worker-'));

import { VoiceManager } from './index.js';
import { WhisperWorkerSession, findWhisperModel, resolveWhisperAssets } from './whisper-worker.js';

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

describe('whisper worker assets', () => {
  it('resolves nothing on a fresh home (no Python spawned)', () => {
    expect(resolveWhisperAssets()).toBe(null);
    const voice = new VoiceManager();
    expect(voice.hasLocalStt()).toBe(false);
  });

  it('warmup is a silent no-op without assets', async () => {
    const voice = new VoiceManager();
    await expect(voice.warmupLocalStt()).resolves.toBe(false);
    await expect(voice.warmupLocalTts()).resolves.toBe(false);
  });
});

describe('WhisperWorkerSession protocol', () => {
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

  // transcribe() chains through promises: yield so the session spawns and
  // attaches its stdout listeners before the fake worker talks.
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('sends audio + language and resolves the transcript', async () => {
    const fake = fakeSpawn();
    const session = new WhisperWorkerSession(
      { script: 'worker.py', downloadRoot: '/models', model: 'base.en' },
      (() => fake.child) as never,
    );
    const pending = session.transcribe('aGVsbG8=', { format: 'webm', language: 'en' });
    await tick();
    fake.stdout.emit('data', '{"ready": true}\n');
    await tick();
    const req = JSON.parse(fake.written[0]) as { id: number; audio: string; format: string; language: string };
    expect(req.audio).toBe('aGVsbG8=');
    expect(req.format).toBe('webm');
    expect(req.language).toBe('en');
    fake.stdout.emit('data', `${JSON.stringify({ id: req.id, ok: true, text: 'hello' })}\n`);
    await expect(pending).resolves.toBe('hello');
    session.shutdown();
  });

  it('warmup loads the model without transcribing', async () => {
    const fake = fakeSpawn();
    const session = new WhisperWorkerSession(
      { script: 'worker.py', downloadRoot: '/models', model: 'base.en' },
      (() => fake.child) as never,
    );
    const warming = session.warmup();
    await tick();
    expect(fake.written).toHaveLength(0);
    fake.stdout.emit('data', '{"ready": true}\n');
    await expect(warming).resolves.toBe(undefined);
    expect(session.running).toBe(true);
    session.shutdown();
  });
});

describe('findWhisperModel', () => {
  const root = mkdtempSync(join(tmpdir(), 'infinite-whisper-models-'));

  const writeModel = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'model.bin'), 'weights');
    writeFileSync(join(dir, 'config.json'), '{}');
  };

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('finds nothing on an empty installer root with the cache disabled', () => {
    expect(findWhisperModel(join(root, 'empty'), null)).toBe(null);
  });

  it('finds a model the installer downloaded, however deep', () => {
    writeModel(join(root, 'a', 'base.en'));
    expect(findWhisperModel(join(root, 'a'), null)).toBe(join(root, 'a', 'base.en'));
  });

  it('ignores half-downloaded directories', () => {
    mkdirSync(join(root, 'b', 'small'), { recursive: true });
    writeFileSync(join(root, 'b', 'small', 'model.bin'), 'weights');
    expect(findWhisperModel(join(root, 'b'), null)).toBe(null);
  });

  it('prefers the default model when a root holds several sizes', () => {
    writeModel(join(root, 'c', 'tiny.en'));
    writeModel(join(root, 'c', 'base.en'));
    expect(findWhisperModel(join(root, 'c'), null)).toBe(join(root, 'c', 'base.en'));
  });

  it('falls back to the hub cache when the installer root is empty', () => {
    writeModel(join(root, 'cache', 'snapshots', 'abc123'));
    expect(findWhisperModel(join(root, 'not-there'), join(root, 'cache'))).toBe(
      join(root, 'cache', 'snapshots', 'abc123'),
    );
  });

  it('never reaches the hub cache when it is disabled', () => {
    expect(findWhisperModel(join(root, 'not-there'), null)).toBe(null);
  });
});
