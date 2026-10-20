// Voice Module — Speech-to-Text and Text-to-Speech with provider fallback
//
// TTS provider priority (auto):
//   1. Local Piper TTS (installed voice model — offline, no key, fastest on
//      old CPUs: a ~15M-param model that synthesizes at/above realtime, so it
//      leads for speak-as-it-streams)
//   2. Local Kokoro TTS (82M params, better quality — offline, no key; needs
//      `pip install kokoro-onnx` + the model under <home>/voices/kokoro/ or
//      <home>/voice/kokoro/. Measured ~15x slower than realtime on an
//      i5-4210U, so it follows Piper in auto: pick the 'kokoro' pin when
//      quality matters more than latency)
//   3. OpenAI TTS (if API key configured) — highest quality
//   4. OpenRouter TTS (if OpenRouter key saved) — bring your own TTS model
//   5. Edge TTS (free neural voices via Microsoft Edge) — keyless cloud
//   6. Browser SpeechSynthesis (renderer fallback) — always available
//
// Callers may pin a source ('local' | 'kokoro' | 'openai' | 'openrouter' |
// 'edge') to skip the chain; a pinned provider that fails surfaces its error
// silently switching providers, and the renderer falls back to the browser
// voice. Speech-to-text is Windows dictation by default; buffered audio with
// no key falls back to local faster-whisper (resources/scripts/local-whisper.py)
// before ever failing.
//
// Edge TTS uses the edge-tts Python package (pip install edge-tts); its
// wrapper script lives at resources/scripts/edge-tts-wrapper.py. Piper is
// `pip install piper-tts` with a voice model under <home>/voices/piper/.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { KokoroWorkerSession, hasKokoroAssets, resolveKokoroAssets } from './kokoro-worker.js';
import { WhisperWorkerSession, hasLocalWhisperModel, resolveWhisperAssets, whisperWorkerScript } from './whisper-worker.js';
import { resolveScriptOrFirst } from './script-paths.js';

// Resolve the Python wrapper relative to the app root (dev tree, unpacked
// resources, or user-data copy — see script-paths.ts).
function wrapperPath(): string {
  return resolveScriptOrFirst('edge-tts-wrapper.py');
}

// Local STT model (faster-whisper, CPU int8) — downloaded under
// <home>/models/whisper on first install. Served by the persistent
// local-whisper-worker.py (see whisper-worker.ts); the one-shot
// local-whisper.py script remains on disk as a manual fallback.

// Local STT model discovery (both the installer layout and the machine's
// Hugging Face cache) lives in whisper-worker.ts: hasLocalWhisperModel().

// Edge TTS voice catalog — free neural voices grouped by quality tier.
const EDGE_TTS_VOICES: Record<string, { voice: string; label: string; gender: string }> = {
  'ava':       { voice: 'en-US-AvaNeural',            label: 'Ava (Female, Expressive)',     gender: 'female' },
  'aria':      { voice: 'en-US-AriaNeural',           label: 'Aria (Female, Confident)',     gender: 'female' },
  'jenny':     { voice: 'en-US-JennyNeural',          label: 'Jenny (Female, Friendly)',     gender: 'female' },
  'emma':      { voice: 'en-US-EmmaNeural',           label: 'Emma (Female, Cheerful)',      gender: 'female' },
  'michelle':  { voice: 'en-US-MichelleNeural',       label: 'Michelle (Female, Pleasant)',  gender: 'female' },
  'brian':     { voice: 'en-US-BrianNeural',          label: 'Brian (Male, Casual)',         gender: 'male' },
  'andrew':    { voice: 'en-US-AndrewNeural',         label: 'Andrew (Male, Confident)',     gender: 'male' },
  'guy':       { voice: 'en-US-GuyNeural',            label: 'Guy (Male, Passionate)',       gender: 'male' },
  'christopher': { voice: 'en-US-ChristopherNeural',  label: 'Christopher (Male, Authority)', gender: 'male' },
  'eric':      { voice: 'en-US-EricNeural',           label: 'Eric (Male, Rational)',        gender: 'male' },
};

const DEFAULT_EDGE_VOICE = 'en-US-AvaNeural';

// OpenAI TTS voice names.
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

// Which TTS backend to use: 'auto' walks the provider chain, the rest pin one.
// 'local' pins the offline pair (Piper → Kokoro); 'kokoro' pins Kokoro alone.
export type TtsSource = 'local' | 'kokoro' | 'auto' | 'openrouter' | 'openai' | 'edge';

// OpenRouter speech models aren't enumerable through the text /models search,
// and the hosted openai/* slug 400s while paid slugs 402 on a zero-credit
// account — Deepgram's free tier synthesizes with no credits, so it defaults.
const DEFAULT_OPENROUTER_TTS_MODEL = 'deepgram/flux-tts:free';

// OpenRouter speech models each accept their own voice catalog (per-model
// `supported_voices`); a voice outside a model's set 400s, so resolution is
// model-aware: keep the requested voice when this model lists it, otherwise
// fall back to the model's first (default) voice. Models absent from this
// map still accept the OpenAI voice names.
const OPENROUTER_MODEL_VOICES: Record<string, readonly string[]> = {
  'deepgram/flux-tts:free': [
    'flux-alexis-en', 'flux-bree-en', 'flux-brittany-en', 'flux-brooke-en', 'flux-bruce-en', 'flux-cliff-en',
    'flux-cole-en', 'flux-colin-en', 'flux-conor-en', 'flux-donovan-en', 'flux-drew-en', 'flux-elise-en',
    'flux-gemma-en', 'flux-haley-en', 'flux-hannah-en', 'flux-heather-en', 'flux-jack-en', 'flux-kai-en',
    'flux-kelsey-en', 'flux-kit-en', 'flux-maeve-en', 'flux-marcelo-en', 'flux-marcus-en', 'flux-meena-en',
    'flux-meghan-en', 'flux-miles-en', 'flux-naveen-en', 'flux-paige-en', 'flux-priya-en', 'flux-rufus-en',
    'flux-sean-en', 'flux-sharon-en', 'flux-sienna-en', 'flux-tanner-en', 'flux-wade-en', 'flux-wes-en',
  ],
  'mistralai/voxtral-mini-tts-2603': [
    'en_paul_sad', 'en_paul_neutral', 'en_paul_happy', 'en_paul_frustrated', 'en_paul_excited',
    'en_paul_confident', 'en_paul_cheerful', 'en_paul_angry', 'gb_oliver_neutral', 'gb_oliver_sad',
    'gb_oliver_excited', 'gb_oliver_curious', 'gb_oliver_confident', 'gb_oliver_cheerful', 'gb_oliver_angry',
    'gb_jane_sarcasm', 'gb_jane_confused', 'gb_jane_shameful', 'gb_jane_sad', 'gb_jane_neutral',
    'gb_jane_jealousy', 'gb_jane_frustrated', 'gb_jane_curious', 'gb_jane_confident', 'fr_marie_sad',
    'fr_marie_neutral', 'fr_marie_happy', 'fr_marie_excited', 'fr_marie_curious', 'fr_marie_angry',
  ],
  'hexgrad/kokoro-82m': [
    'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova',
    'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam',
    'am_michael', 'am_onyx', 'am_puck', 'am_santa', 'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
    'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis', 'ef_dora', 'em_alex', 'em_santa', 'ff_siwis',
    'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi', 'if_sara', 'im_nicola', 'jf_alpha', 'jf_gongitsune',
    'jf_nezumi', 'jf_tebukuro', 'jm_kumo', 'pf_dora', 'pm_alex', 'pm_santa', 'zf_xiaobei', 'zf_xiaoni',
    'zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
  ],
  'google/gemini-3.8-flash-tts': [
    'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
    'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
    'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
    'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
  ],
  'x-ai/grok-voice-tts-1.0': ['eve', 'ara', 'rex', 'sal', 'leo'],
};

export interface TTSProvider {
  name: string;
  isAvailable(): boolean;
  synthesize(text: string, voice?: string): Promise<Buffer>;
  getVoices(): Array<{ id: string; label: string }>;
}

/** Edge TTS — free neural voices via Microsoft Edge's TTS service. */
export class EdgeTTSProvider implements TTSProvider {
  name = 'edge-tts';
  private available: boolean | null = null;
  private retryAfter = 0;

  isAvailable(): boolean {
    if (this.available) return true;
    // Only a SUCCESS sticks. Caching a failure for the rest of the session
    // meant one slow probe silently disabled Edge for every later reply, which
    // is fatal when the panel pins TTS to `edge` — Edge is then the only
    // provider the chain ever tries. Failures now expire so a later reply
    // retries instead of staying dead for the whole session.
    if (Date.now() < this.retryAfter) return false;
    try {
      // Probe for INSTALLATION, not by running the CLI. `python -m edge_tts
      // --version` imports the whole package and measured 6.8–8.1s here,
      // against a 5s budget — so the old probe timed out on a perfectly good
      // install, and because the probe is synchronous every millisecond was
      // also a frozen main process. find_spec only locates the distribution
      // (~120ms) and answers the same availability question. A broken install
      // still surfaces loudly at synthesis time.
      execFileSync(
        'python',
        ['-c', "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('edge_tts') else 1)"],
        { timeout: 5_000, stdio: 'pipe', windowsHide: true },
      );
      this.available = true;
    } catch {
      this.available = false;
      this.retryAfter = Date.now() + 60_000;
    }
    return this.available;
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    const voiceName = EDGE_TTS_VOICES[voice ?? 'ava']?.voice ?? voice ?? DEFAULT_EDGE_VOICE;
    const tmpFile = join(infiniteHome(), 'voice', `edge-tts-${Date.now()}.mp3`);
    mkdirSync(join(infiniteHome(), 'voice'), { recursive: true });

    const wrapper = wrapperPath();
    await new Promise<void>((resolve, reject) => {
      const child = spawn('python', [wrapper, voiceName, tmpFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
        windowsHide: true,
      });
      child.stdin.write(text);
      child.stdin.end();
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`edge-tts failed (code ${code}): ${stderr}`));
      });
      child.on('error', reject);
    });

    const buffer = readFileSync(tmpFile);
    try { unlinkSync(tmpFile); } catch { /* ignore cleanup */ }
    return buffer;
  }

  getVoices(): Array<{ id: string; label: string }> {
    return Object.entries(EDGE_TTS_VOICES).map(([id, v]) => ({ id, label: v.label }));
  }
}

/** OpenAI TTS — requires API key, highest quality. */
export class OpenAITTSProvider implements TTSProvider {
  name = 'openai-tts';
  private apiKey: string | null = null;

  setApiKey(key: string): void { this.apiKey = key; }

  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey !== '';
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error('OpenAI API key required for TTS');

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        voice: voice ?? 'alloy',
        input: text.slice(0, 4096),
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? 'OpenAI TTS failed');
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  getVoices(): Array<{ id: string; label: string }> {
    return OPENAI_VOICES.map((v) => ({ id: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
  }
}

/**
 * OpenRouter TTS — OpenAI-compatible /v1/audio/speech endpoint on the
 * OpenRouter key saved in Settings → Providers, so the same provider key
 * lights up TTS with no separate voice key. The model slug is configurable
 * because OpenRouter's TTS models are not discoverable via /models.
 */
/** Resolve a voice for an OpenRouter speech model — model-aware fallback. */
function resolveOpenRouterVoice(model: string, voice?: string): string {
  const known = OPENROUTER_MODEL_VOICES[model];
  if (known) return voice && known.includes(voice) ? voice : (known[0] ?? 'alloy');
  return voice && OPENAI_VOICES.includes(voice) ? voice : 'alloy';
}

export class OpenRouterTTSProvider implements TTSProvider {
  name = 'openrouter-tts';
  private apiKey: string | null = null;
  private model = DEFAULT_OPENROUTER_TTS_MODEL;

  setApiKey(key: string): void { this.apiKey = key; }

  /** Empty or blank resets to the default hosted model. */
  setModel(model: string): void { this.model = model.trim() || DEFAULT_OPENROUTER_TTS_MODEL; }

  isAvailable(): boolean {
    return this.apiKey !== null && this.apiKey !== '';
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    if (!this.apiKey) throw new Error('OpenRouter API key required for TTS');

    const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text.slice(0, 4096),
        // Voices are model-specific: accept one this model actually
        // lists, else fall back to its default voice (unknown slugs keep
        // the legacy OpenAI-name path — anything else there would 400).
        voice: resolveOpenRouterVoice(this.model, voice),
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? `OpenRouter TTS failed (${response.status})`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  getVoices(): Array<{ id: string; label: string }> {
    // Voices are model-specific on OpenRouter; expose the active model's
    // catalog (OpenAI names only for slugs whose catalog we don't carry).
    const list = OPENROUTER_MODEL_VOICES[this.model] ?? OPENAI_VOICES;
    return list.map((v) => ({ id: v, label: v.charAt(0).toUpperCase() + v.slice(1) }));
  }
}

/** Piper — fully local neural TTS: no key, no network. Voices are .onnx
 *  models under <home>/voices/piper (pip install piper-tts). Returns WAV —
 *  the renderer sniffs RIFF vs MP3 instead of assuming mpeg. */
export class PiperTTSProvider implements TTSProvider {
  name = 'piper-tts';
  private available: boolean | null = null;

  private modelDir(): string {
    return join(infiniteHome(), 'voices', 'piper');
  }

  /** Model files in the voice dir — filesystem only, never spawns Python. */
  private modelFiles(): string[] {
    try {
      return readdirSync(this.modelDir()).filter((f) => f.endsWith('.onnx')).sort();
    } catch {
      return [];
    }
  }

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    // Filesystem first: tests and fresh installs must not spawn Python.
    if (this.modelFiles().length === 0) {
      this.available = false;
      return false;
    }
    try {
      execFileSync('python', ['-c', 'import piper'], { timeout: 5_000, stdio: 'pipe', windowsHide: true });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    const files = this.modelFiles();
    if (files.length === 0) throw new Error('No local Piper voice model installed.');
    // `voice` may name a model id (en_US-lessac-medium) or any other UI
    // voice — only an exact model match wins; otherwise the first speaks.
    const modelFile = voice && files.includes(`${voice}.onnx`) ? `${voice}.onnx` : files[0];
    const outDir = join(infiniteHome(), 'voice');
    mkdirSync(outDir, { recursive: true });
    const tmpFile = join(outDir, `piper-${Date.now()}-${process.pid}.wav`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn('python', ['-m', 'piper', '-m', join(this.modelDir(), modelFile), '-f', tmpFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
        windowsHide: true,
      });
      child.stdin.write(text);
      child.stdin.end();
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`piper failed (code ${code}): ${stderr}`));
      });
      child.on('error', reject);
    });

    const buffer = readFileSync(tmpFile);
    try { unlinkSync(tmpFile); } catch { /* ignore cleanup */ }
    return buffer;
  }

  getVoices(): Array<{ id: string; label: string }> {
    return this.modelFiles().map((f) => {
      const id = f.replace(/\.onnx$/, '');
      return { id, label: `${id} (local)` };
    });
  }
}

/**
 * Kokoro — fully local neural TTS (82M params, ONNX int8 on CPU): no key, no
 * network after the one-time model download. Higher quality than Piper, but
 * much heavier — a persistent worker process serves a whole turn so the
 * ~114MB model loads once (~6s on an i5) instead of per sentence.
 */
export const DEFAULT_KOKORO_VOICE = 'af_heart';

/** Kokoro-82M v1.0 voice ids (same catalog the cloud slug exposes). */
export const KOKORO_VOICE_IDS: readonly string[] = [
  'af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael',
  'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
  'ef_dora', 'em_alex', 'em_santa', 'ff_siwis',
  'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi',
  'if_sara', 'im_nicola',
  'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
  'pf_dora', 'pm_alex', 'pm_santa',
  'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi',
  'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang',
];

/** Curated picker subset — the full list would flood the voice dropdown. */
const KOKORO_PICKER_VOICES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'af_heart', label: 'Heart (female, warm) — default' },
  { id: 'af_bella', label: 'Bella (female, clear)' },
  { id: 'af_sarah', label: 'Sarah (female, bright)' },
  { id: 'af_nicole', label: 'Nicole (female, soft)' },
  { id: 'af_sky', label: 'Sky (female, airy)' },
  { id: 'am_adam', label: 'Adam (male, steady)' },
  { id: 'am_michael', label: 'Michael (male, deep)' },
  { id: 'bf_emma', label: 'Emma (british female)' },
  { id: 'bf_isabella', label: 'Isabella (british female)' },
  { id: 'bm_george', label: 'George (british male)' },
];

/** Keep the requested voice when Kokoro lists it, else the default. */
export function resolveKokoroVoice(voice?: string): string {
  if (voice && (KOKORO_VOICE_IDS as readonly string[]).includes(voice)) return voice;
  return DEFAULT_KOKORO_VOICE;
}

export class KokoroTTSProvider implements TTSProvider {
  name = 'kokoro-tts';
  private available: boolean | null = null;
  private worker: KokoroWorkerSession | null = null;

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    // Filesystem first: tests and fresh installs must not spawn Python.
    if (!hasKokoroAssets()) {
      this.available = false;
      return false;
    }
    try {
      execFileSync('python', ['-c', 'import kokoro_onnx'], { timeout: 5_000, stdio: 'pipe', windowsHide: true });
      this.available = true;
    } catch {
      this.available = false;
    }
    return this.available;
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    const assets = resolveKokoroAssets();
    if (!assets) throw new Error('No local Kokoro model installed (voices/kokoro/kokoro-v1.0.*.onnx + voices-v1.0.bin).');
    if (!this.worker) this.worker = new KokoroWorkerSession(assets);
    try {
      return await this.worker.synthesize(text, { voice: resolveKokoroVoice(voice) });
    } catch (e) {
      // A dead worker must never poison later turns — drop it so the next
      // call starts fresh (or the chain falls through to Piper).
      try {
        this.worker.shutdown();
      } catch { /* already gone */ }
      this.worker = null;
      throw e;
    }
  }

  /** Pre-warm: load the model now so the first chunk synthesizes immediately. */
  async warmup(): Promise<void> {
    const assets = resolveKokoroAssets();
    if (!assets) throw new Error('No local Kokoro model installed.');
    if (!this.worker) this.worker = new KokoroWorkerSession(assets);
    await this.worker.warmup();
  }

  getVoices(): Array<{ id: string; label: string }> {
    return KOKORO_PICKER_VOICES.map((v) => ({ ...v }));
  }
}

export class VoiceManager {
  private piper = new PiperTTSProvider();
  private kokoro = new KokoroTTSProvider();
  private openai = new OpenAITTSProvider();
  private openrouter = new OpenRouterTTSProvider();
  private edge = new EdgeTTSProvider();
  // Keyless local-faster-whisper availability (null = not checked yet).
  private whisperOk: boolean | null = null;
  // Keyless local-Kokoro availability (null = not checked yet).
  private kokoroOk: boolean | null = null;
  // Persistent STT worker — model loads once, every utterance after the
  // first skips the ~6s load (the one-shot script paid it every turn).
  private whisperWorker: WhisperWorkerSession | null = null;
  private dataDir: string;
  // Speech-to-text and text-to-speech take independent keys so either side
  // can be configured (or left keyless — local dictation/whisper + Piper/
  // Edge TTS) without clobbering the other.
  private sttKey = '';
  private ttsKey = '';
  // Last values derived from the secrets store — tells a sync whether the
  // in-memory key came from secrets (refreshable) or was set live this
  // session (never clobber, even if its persistence failed).
  private sttKeySynced = '';
  private ttsKeySynced = '';

  // Active TTS provider order (auto): Piper first — it synthesizes at/above
  // realtime on old CPUs, which is what speak-as-it-streams needs — then
  // local Kokoro (better quality, slower), OpenAI, OpenRouter, Edge TTS,
  // and finally the renderer browser fallback.
  private providers: TTSProvider[];

  constructor() {
    this.dataDir = join(infiniteHome(), 'voice');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    this.providers = [this.piper, this.kokoro, this.openai, this.openrouter, this.edge];
  }

  // ── STT ──

  /** Legacy single-key setter: one OpenAI key historically served both sides. */
  setApiKey(key: string): void {
    this.setTtsKey(key);
    this.setSttKey(key);
  }

  setSttKey(key: string): void {
    this.sttKey = key.trim();
  }

  setTtsKey(key: string): void {
    this.ttsKey = key.trim();
    this.openai.setApiKey(this.ttsKey);
  }

  hasSttKey(): boolean {
    return Boolean(this.sttKey);
  }

  hasTtsKey(): boolean {
    return Boolean(this.ttsKey) || this.openrouter.isAvailable();
  }

  /**
   * Refresh keys from the secrets store: dedicated voice keys win, then the
   * saved OpenAI provider key ('openai') so chat credentials light up STT and
   * TTS with no separate voice key and no restart. Fills empty slots and
   * follows provider key rotation/deletion, but never clobbers a key set
   * live this session whose persistence failed.
   *
   * The OpenRouter provider key ('openrouter') rides the OpenRouter key
   * saved in Settings → Providers — nothing sets it live, so a plain read
   * always follows rotation/deletion.
   */
  async syncKeysFromSecrets(readKey: (id: string) => Promise<string>): Promise<void> {
    const firstOf = async (...ids: string[]): Promise<string> => {
      for (const id of ids) {
        const key = await readKey(id);
        if (key) return key;
      }
      return '';
    };
    const stt = await firstOf('voice-stt', 'openai', 'openai-tts');
    if (stt !== this.sttKey && (this.sttKey === '' || this.sttKey === this.sttKeySynced)) {
      this.setSttKey(stt);
    }
    this.sttKeySynced = stt;
    const tts = await firstOf('voice-tts', 'openai-tts', 'openai');
    if (tts !== this.ttsKey && (this.ttsKey === '' || this.ttsKey === this.ttsKeySynced)) {
      this.setTtsKey(tts);
    }
    this.ttsKeySynced = tts;
    // OpenRouter TTS key: no live setter exists, so always follow rotation
    // and deletion of the saved OpenRouter provider key.
    this.openrouter.setApiKey(await readKey('openrouter'));
  }

  isAvailable(): boolean {
    return this.providers.some((p) => p.isAvailable());
  }

  /**
   * True when buffered audio can be transcribed with no key at all: the
   * local wrapper + downloaded model + importable faster-whisper package.
   * Filesystem checks come first so tests and fresh installs never spawn
   * Python; the result is cached for the process lifetime.
   */
  hasLocalStt(): boolean {
    if (this.whisperOk !== null) return this.whisperOk;
    this.whisperOk = false;
    if (!hasLocalWhisperModel()) return false;
    if (!existsSync(whisperWorkerScript())) return false;
    try {
      execFileSync('python', ['-c', 'import faster_whisper'], { timeout: 5_000, stdio: 'pipe', windowsHide: true });
      this.whisperOk = true;
    } catch { /* package not installed */ }
    return this.whisperOk;
  }

  /**
   * True when Kokoro can synthesize with no key at all: model + voices on
   * disk and an importable kokoro_onnx package. Filesystem checks come first
   * so tests and fresh installs never spawn Python; cached per process.
   */
  hasLocalKokoro(): boolean {
    if (this.kokoroOk !== null) return this.kokoroOk;
    this.kokoroOk = false;
    if (!hasKokoroAssets()) return false;
    try {
      execFileSync('python', ['-c', 'import kokoro_onnx'], { timeout: 5_000, stdio: 'pipe', windowsHide: true });
      this.kokoroOk = true;
    } catch { /* package not installed */ }
    return this.kokoroOk;
  }

  /**
   * Keyless transcription via the persistent local faster-whisper worker
   * (CPU INT8, offline). First call pays the model load; every call after
   * skips it (~2.5s vs ~8.5s measured on an i5-4210U).
   */
  private async localWhisper(audioPath: string, language?: string): Promise<string> {
    const assets = resolveWhisperAssets();
    if (!assets) {
      throw new Error(
        'Local speech-to-text is not installed. Install it once with: pip install faster-whisper (no API key needed), or switch Speech-to-text to Automatic/Cloud.',
      );
    }
    if (!this.whisperWorker) this.whisperWorker = new WhisperWorkerSession(assets);
    // Pin English on the English-only model: auto-detection misfires on
    // short clips ("confident but completely wrong words"). Other languages
    // need a multilingual model, so leave detection on rather than forcing
    // a language this model cannot speak.
    const primary = (language ?? '').split('-')[0]?.toLowerCase();
    const ext = audioPath.split('.').pop()?.toLowerCase() || 'webm';
    try {
      const audioBase64 = readFileSync(audioPath).toString('base64');
      return await this.whisperWorker.transcribe(audioBase64, {
        format: ext,
        language: primary === 'en' ? 'en' : '',
      });
    } catch (e) {
      // A dead worker must never poison later turns — drop it so the next
      // call starts fresh (or the caller falls through to cloud/SAPI).
      try {
        this.whisperWorker.shutdown();
      } catch { /* already gone */ }
      this.whisperWorker = null;
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  /**
   * Pre-warm hooks for the voice turn: STT warms on mic tap (the model loads
   * while the user is still speaking), TTS warms on submit (loads while the
   * cloud model thinks). Idempotent, never throw — a cold path simply pays
   * the load on first use instead.
   */
  async warmupLocalStt(): Promise<boolean> {
    try {
      if (!this.hasLocalStt()) return false;
      const assets = resolveWhisperAssets();
      if (!assets) return false;
      if (!this.whisperWorker) this.whisperWorker = new WhisperWorkerSession(assets);
      await this.whisperWorker.warmup();
      return true;
    } catch {
      return false;
    }
  }

  async warmupLocalTts(): Promise<boolean> {
    try {
      if (!this.hasLocalKokoro()) return false;
      await this.kokoro.warmup();
      return true;
    } catch {
      return false;
    }
  }

  async speechToText(audioBuffer: Buffer, format: string = 'mp3', opts?: { local?: boolean; language?: string }): Promise<string> {
    const tempPath = join(this.dataDir, `stt_temp.${format}`);
    writeFileSync(tempPath, audioBuffer);

    try {
      // A pinned-local turn transcribes on-device only — a saved cloud key is
      // deliberately ignored so 'Local' really means local. Otherwise a saved
      // key transcribes in the cloud; with no key we fall back to the local
      // faster-whisper model — keyless — and only fail when neither path is
      // configured.
      if (opts?.local) {
        if (this.hasLocalStt()) return await this.localWhisper(tempPath, opts?.language);
        throw new Error(
          'Local speech-to-text is not installed. Install it once with: pip install faster-whisper (no API key needed), or switch Speech-to-text to Automatic/Cloud.',
        );
      }
      if (!this.sttKey) {
        if (this.hasLocalStt()) return await this.localWhisper(tempPath, opts?.language);
        throw new Error(
          'No speech-to-text key configured. Save a voice key under Voice → Settings, or your OpenAI key in Settings → Providers (local dictation needs no key). To transcribe recordings without any key, install the local model: pip install faster-whisper.',
        );
      }

      const formData = new FormData();
      formData.append('file', new Blob([readFileSync(tempPath)]), `audio.${format}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.sttKey}` },
        body: formData,
      });

      const data = (await response.json()) as { text?: string; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message ?? 'Speech-to-text failed');
      return data.text || '';
    } finally {
      try { writeFileSync(tempPath, Buffer.alloc(0)); } catch { /* ignore */ }
    }
  }

  // ── TTS ──

  /**
   * Synthesize speech. `source` pins one provider instead of walking the
   * auto chain (local → openai → openrouter → edge); a pinned provider that
   * surfaces its error so the renderer can fall back to the browser voice
   * rather than silently switching providers. `model` overrides the
   * OpenRouter TTS model slug (empty string restores the default) and sticks
   * on the provider for later auto-chain calls.
   */
  async textToSpeech(
    text: string,
    voice?: string,
    opts?: { source?: TtsSource; model?: string },
  ): Promise<Buffer> {
    return (await this.synthesizeWithProvider(text, voice, opts)).buffer;
  }

  /**
   * Synthesize speech and report which provider spoke. Same chain and pinning
   * contract as textToSpeech — the provider name lets the UI say out loud
   * which voice answered instead of failing silently.
   */
  async synthesizeWithProvider(
    text: string,
    voice?: string,
    opts?: { source?: TtsSource; model?: string },
  ): Promise<{ buffer: Buffer; provider: string }> {
    if (opts?.model !== undefined) this.openrouter.setModel(opts.model);
    const source: TtsSource = opts?.source ?? 'auto';
    const chain: TTSProvider[] =
      source === 'local'
        ? [this.piper, this.kokoro]
        : source === 'kokoro'
          ? [this.kokoro]
          : source === 'openrouter'
            ? [this.openrouter]
            : source === 'openai'
              ? [this.openai]
              : source === 'edge'
                ? [this.edge]
                : this.providers;
    const errors: string[] = [];
    for (const provider of chain) {
      if (!provider.isAvailable()) continue;
      try {
        const buffer = await provider.synthesize(text, voice);
        // A truncated/empty payload that "succeeds" plays as silence and
        // resolves the audio element — the worst TTS failure because nothing
        // reports it. Treat it as a provider miss so the chain (and finally
        // the renderer's browser voice) still gets a chance.
        if (!buffer || buffer.length < 1024) {
          errors.push(`${provider.name}: returned ${buffer?.length ?? 0} bytes (silence guard)`);
          continue;
        }
        return { buffer, provider: provider.name };
      } catch (e) {
        errors.push(`${provider.name}: ${(e as Error).message}`);
      }
    }
    const pinned = source !== 'auto' ? ` (source: ${source})` : '';
    throw new Error(
      `No TTS provider available${pinned}. Tried: ${errors.join('; ') || 'none configured'}`,
    );
  }

  /** Synthesize and save to a file. */
  async textToSpeechFile(text: string, outputPath: string, voice?: string): Promise<string> {
    const buffer = await this.textToSpeech(text, voice);
    writeFileSync(outputPath, buffer);
    return outputPath;
  }

  /** Get all available TTS voices across providers. */
  getAllVoices(): Array<{ provider: string; id: string; label: string }> {
    const voices: Array<{ provider: string; id: string; label: string }> = [];
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;
      for (const v of provider.getVoices()) {
        voices.push({ provider: provider.name, ...v });
      }
    }
    return voices;
  }

  /** Get the default voice for the best available provider. */
  getDefaultVoice(): string {
    if (this.ttsKey || this.openrouter.isAvailable()) return 'alloy';
    if (this.edge.isAvailable()) return 'ava';
    return '';
  }

  getVoices(): string[] {
    // OpenRouter mirrors the OpenAI voice names — dedupe so React keys in
    // the voice picker stay unique when both providers are available.
    return [...new Set(this.getAllVoices().map((v) => v.id))];
  }
}

let voiceInstance: VoiceManager | null = null;
let keySyncPromise: Promise<void> | null = null;

/**
 * Load persisted voice keys from the secrets store on every access
 * (concurrent callers share one in-flight sync). A provider key saved in
 * Settings after launch enables cloud STT/TTS on the very next voice call —
 * the old one-shot init left the manager keyless until restart, which is
 * exactly the "my OpenAI key should just work" complaint.
 */
function syncVoiceKeys(): Promise<void> {
  if (keySyncPromise) return keySyncPromise;
  keySyncPromise = (async () => {
    try {
      const { getApiKey } = await import('../settings/secrets.js');
      // Dedicated keys win; legacy ids stay in the chain so an existing
      // chat ('openai') or old TTS ('openai-tts') key still enables voice.
      // The OpenRouter key feeds TTS through its own provider (chain above).
      await voiceInstance?.syncKeysFromSecrets((id) => getApiKey(id).catch(() => ''));
    } catch { /* secrets not available yet */ }
  })().finally(() => {
    keySyncPromise = null;
  });
  return keySyncPromise;
}

/** Initialize VoiceManager with persisted keys from the secrets store. */
async function initVoiceManager(): Promise<VoiceManager> {
  if (!voiceInstance) voiceInstance = new VoiceManager();
  await syncVoiceKeys();  return voiceInstance;
}

export function getVoice(): VoiceManager {
  if (!voiceInstance) voiceInstance = new VoiceManager();
  return voiceInstance;
}

/** Async version that loads persisted key. Use in IPC handlers. */
export { initVoiceManager as getVoiceAsync };
