/**
 * Persistent faster-whisper STT worker — one Python process serves every
 * utterance of the session.
 *
 * The one-shot script paid interpreter + ~145MB model load per turn
 * (measured ~6s of an ~8.5s transcription on an i5-4210U). This session
 * keeps a single long-lived `local-whisper-worker.py` child: base64 audio
 * on stdin, transcript JSON on stdout, correlated by id. Lazy (never
 * spawned until first transcription — ideally pre-warmed on mic tap while
 * the user is still speaking), FIFO-serialized, with the shared
 * circuit-breaker so a broken install fails fast into cloud/SAPI instead
 * of burning a model-load per utterance.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { resolveScriptOrFirst } from './script-paths.js';
import { JsonLineWorkerSession, type WorkerSpawnFn } from './stdio-worker.js';

export interface WhisperAssets {
  script: string;
  downloadRoot: string;
  model: string;
}

/** Worker script candidates — dev tree first, then the user-data copy. */
export function whisperWorkerScript(): string {
  return resolveScriptOrFirst('local-whisper-worker.py');
}

/** Local STT model id (faster-whisper, CPU int8). */
export const DEFAULT_LOCAL_WHISPER_MODEL = 'base.en';

/**
 * Every directory under `dir` holding one converted CTranslate2 model
 * (`config.json` + `model.bin`). Both files are required so a half-downloaded
 * directory can never be mistaken for a usable model. Never spawns Python.
 */
function findModelDirs(dir: string, depth: number, found: string[] = []): string[] {
  if (depth < 0 || !existsSync(dir)) return found;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((e) => e.isFile() && e.name === 'model.bin') &&
      entries.some((e) => e.isFile() && e.name === 'config.json')) {
    found.push(dir);
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    findModelDirs(join(dir, entry.name), depth - 1, found);
  }
  return found;
}

/** Prefer the default model when a root happens to contain several sizes. */
function pickModelDir(dirs: string[]): string | null {
  if (dirs.length === 0) return null;
  return (
    dirs.find((d) => d.includes(DEFAULT_LOCAL_WHISPER_MODEL)) ?? dirs[0] ?? null
  );
}

/** Hugging Face hub cache root, honouring the standard overrides. */
function hfHubCache(): string {
  const explicit = process.env['HUGGINGFACE_HUB_CACHE'] || process.env['HF_HUB_CACHE'];
  if (explicit) return explicit;
  const hfHome = process.env['HF_HOME'];
  if (hfHome) return join(hfHome, 'hub');
  return join(homedir(), '.cache', 'huggingface', 'hub');
}

/**
 * Model resolution across the two layouts we search. Pure so both branches are
 * testable without touching the machine's real caches.
 *
 *  1. `localRoot` — `<home>/models/whisper`, what the installer/worker
 *     downloads into.
 *  2. `cacheRoot` — the Hugging Face hub cache, where `faster-whisper` lands
 *     a model when it is loaded without an explicit `download_root` (the
 *     common case: anything that already ran Whisper). `WhisperModel` loads a
 *     directory directly, so a snapshot dir is passed as the model and no
 *     re-download happens. Null disables the fallback (hermetic test homes).
 */
export function findWhisperModel(localRoot: string, cacheRoot: string | null): string | null {
  const local = pickModelDir(findModelDirs(localRoot, 4));
  if (local) return local;
  if (!cacheRoot) return null;
  return pickModelDir(findModelDirs(cacheRoot, 3));
}

/**
 * Model resolution. Test homes stay hermetic: `INFINITE_TEST_HOME` points at
 * a throwaway directory and must not reach out to the real machine cache,
 * otherwise a "no model installed" assertion would silently start finding the
 * host's.
 */
export function resolveWhisperAssets(): WhisperAssets | null {
  const downloadRoot = join(infiniteHome(), 'models', 'whisper');
  const cacheRoot = process.env['INFINITE_TEST_HOME']
    ? null
    : join(hfHubCache(), `models--Systran--faster-whisper-${DEFAULT_LOCAL_WHISPER_MODEL}`);
  const model = findWhisperModel(downloadRoot, cacheRoot);
  return model ? { script: whisperWorkerScript(), downloadRoot, model } : null;
}

/** True when a usable local Whisper model exists on disk (never spawns Python). */
export function hasLocalWhisperModel(): boolean {
  return resolveWhisperAssets() !== null;
}

export interface WhisperTranscribeOptions {
  /** Audio container the bytes are in (what the recorder produced). */
  format?: string;
  /** BCP-47 primary tag for English ('en') — pinned for accuracy. */
  language?: string;
  timeoutMs?: number;
}

/**
 * One managed worker process. Not exported as a singleton here — the voice
 * module owns the instance lifetime (lazy start, process-lifetime reuse).
 */
export class WhisperWorkerSession extends JsonLineWorkerSession {
  constructor(assets: WhisperAssets, spawnImpl?: WorkerSpawnFn) {
    super(assets.script, [assets.downloadRoot, assets.model], spawnImpl);
  }

  /** Transcribe base64 audio; resolves '' when nothing speech-like is found. */
  transcribe(audioBase64: string, opts: WhisperTranscribeOptions = {}): Promise<string> {
    return this.enqueue(async () => {
      const res = await this.request(
        { audio: audioBase64, format: opts.format ?? 'webm', language: opts.language ?? '' },
        opts.timeoutMs,
      );
      return typeof res.text === 'string' ? res.text : '';
    });
  }
}
