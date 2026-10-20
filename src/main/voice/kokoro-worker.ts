/**
 * Persistent Kokoro TTS worker — one Python process serves a whole turn.
 *
 * Spawning a process per sentence would pay the ~114MB ONNX model load on
 * every chunk and destroy the speak-as-it-streams benefit, so this session
 * keeps a single long-lived `local-kokoro-worker.py` child: JSON-line
 * requests on stdin, JSON-line WAV responses on stdout, correlated by id.
 * The worker is lazy (never spawned until first synthesis), serializes
 * requests (speech chunks are sequential anyway), restarts once on an
 * unexpected exit, and surfaces worker errors as plain Errors so the TTS
 * chain can fall through to the next provider.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { resolveScriptOrFirst } from './script-paths.js';
import { JsonLineWorkerSession, type WorkerSpawnFn } from './stdio-worker.js';

export interface KokoroAssets {
  script: string;
  model: string;
  voices: string;
}

/** Worker script candidates — dev tree first, then the user-data copy. */
export function kokoroWorkerScript(): string {
  return resolveScriptOrFirst('local-kokoro-worker.py');
}

/**
 * Model + voices resolution. Accepts the int8 build (fastest on CPU-only
 * machines like the i5-4210U) and the full fp32 build, v1.0 voices first.
 * Filesystem only — never spawns Python, so status checks stay instant.
 *
 * Two directories are checked because the downloader and the Python server
 * disagree on the singular: the Node side always used `voices/kokoro`, while
 * local_voice_server.py downloads to `voice/kokoro`. Looking in only one of
 * them reported "no Kokoro" on a machine that had it installed, silently
 * skipping the offline voice for every synthesis.
 */
export function resolveKokoroAssets(): KokoroAssets | null {
  const dirs = [
    join(infiniteHome(), 'voices', 'kokoro'),
    join(infiniteHome(), 'voice', 'kokoro'),
  ];
  const models = ['kokoro-v1.0.int8.onnx', 'kokoro-v1.0.onnx'];
  const voices = ['voices-v1.0.bin', 'voices.bin'];
  for (const dir of dirs) {
    let model: string | null = null;
    let voiceFile: string | null = null;
    for (const m of models) {
      const p = join(dir, m);
      if (existsSync(p)) {
        model = p;
        break;
      }
    }
    for (const v of voices) {
      const p = join(dir, v);
      if (existsSync(p)) {
        voiceFile = p;
        break;
      }
    }
    if (model && voiceFile) return { script: kokoroWorkerScript(), model, voices: voiceFile };
  }
  return null;
}

/** True when the Kokoro model + voices sit on disk (import checked separately). */
export function hasKokoroAssets(): boolean {
  return resolveKokoroAssets() !== null;
}

export interface KokoroSynthOptions {
  voice?: string;
  speed?: number;
  lang?: string;
  /** Per-request ceiling; the default covers slow CPUs on long sentences. */
  timeoutMs?: number;
}

/**
 * One managed worker process. Not exported as a singleton here — the voice
 * module owns the instance lifetime (lazy start, process-lifetime reuse).
 */
export class KokoroWorkerSession extends JsonLineWorkerSession {
  constructor(assets: KokoroAssets, spawnImpl?: WorkerSpawnFn) {
    super(assets.script, [assets.model, assets.voices], spawnImpl);
  }

  /** Serialize syntheses — speech chunks play in order, so requests go FIFO. */
  synthesize(text: string, opts: KokoroSynthOptions = {}): Promise<Buffer> {
    return this.enqueue(async () => {
      const res = await this.request(
        { text, voice: opts.voice ?? 'af_heart', speed: opts.speed ?? 1.0, lang: opts.lang ?? 'en-us' },
        opts.timeoutMs,
      );
      if (typeof res.audio !== 'string' || !res.audio) {
        throw new Error('Kokoro worker returned no audio.');
      }
      try {
        return Buffer.from(res.audio, 'base64');
      } catch (e) {
        throw e instanceof Error ? e : new Error(String(e));
      }
    });
  }
}
