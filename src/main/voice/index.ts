// Voice Module — Speech-to-Text and Text-to-Speech with provider fallback
//
// TTS provider priority:
//   1. OpenAI TTS (if API key configured) — highest quality
//   2. Edge TTS (free neural voices via Microsoft Edge) — default
//   3. Browser SpeechSynthesis (renderer fallback) — always available
//
// Edge TTS uses the edge-tts Python package (pip install edge-tts).
// The wrapper script lives at resources/scripts/edge-tts-wrapper.py.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { homedir } from 'node:os';

// Resolve the Python wrapper relative to the app root.
function wrapperPath(): string {
  // In dev: resources/scripts/edge-tts-wrapper.py
  // In packaged: unpacked resources or app.asar
  const candidates = [
    join(process.cwd(), 'resources', 'scripts', 'edge-tts-wrapper.py'),
    join(homedir(), '.infinite-ai', 'edge-tts-wrapper.py'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

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

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    // Check synchronously on first call — Python + edge-tts installed?
    try {
      execFileSync('python', ['-m', 'edge_tts', '--version'], {
        timeout: 5000,
        stdio: 'pipe',
        windowsHide: true,
      });
      this.available = true;
    } catch {
      this.available = false;
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

export class VoiceManager {
  private openai = new OpenAITTSProvider();
  private edge = new EdgeTTSProvider();
  private dataDir: string;

  // Active TTS provider order: OpenAI > Edge TTS > (renderer browser fallback).
  private providers: TTSProvider[];

  constructor() {
    this.dataDir = join(infiniteHome(), 'voice');
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
    this.providers = [this.openai, this.edge];
  }

  // ── STT ──

  setApiKey(key: string): void {
    this.openai.setApiKey(key);
  }

  isAvailable(): boolean {
    return this.providers.some((p) => p.isAvailable());
  }

  async speechToText(audioBuffer: Buffer, format: string = 'mp3'): Promise<string> {
    if (!this.openai.isAvailable()) {
      throw new Error('OpenAI API key required for speech-to-text');
    }

    const tempPath = join(this.dataDir, `stt_temp.${format}`);
    writeFileSync(tempPath, audioBuffer);

    try {
      const formData = new FormData();
      formData.append('file', new Blob([readFileSync(tempPath)]), `audio.${format}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'en');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.openai['apiKey']}` },
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

  /** Synthesize speech, trying providers in priority order. */
  async textToSpeech(text: string, voice?: string): Promise<Buffer> {
    const errors: string[] = [];
    for (const provider of this.providers) {
      if (!provider.isAvailable()) continue;
      try {
        return await provider.synthesize(text, voice);
      } catch (e) {
        errors.push(`${provider.name}: ${(e as Error).message}`);
      }
    }
    throw new Error(`No TTS provider available. Tried: ${errors.join('; ') || 'none configured'}`);
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
    if (this.openai.isAvailable()) return 'alloy';
    if (this.edge.isAvailable()) return 'ava';
    return '';
  }

  getVoices(): string[] {
    return this.getAllVoices().map((v) => v.id);
  }
}

let voiceInstance: VoiceManager | null = null;
let voiceInitPromise: Promise<void> | null = null;

/** Initialize VoiceManager with persisted API key from secrets store. */
async function initVoiceManager(): Promise<VoiceManager> {
  if (!voiceInstance) voiceInstance = new VoiceManager();
  if (!voiceInitPromise) {
    voiceInitPromise = (async () => {
      try {
        const { getApiKey } = await import('../settings/secrets.js');
        // Provider system stores chat key under 'openai'; legacy TTS key was
        // 'openai-tts'. Accept either so a saved OpenAI key enables voice.
        const key = (await getApiKey('openai').catch(() => '')) || (await getApiKey('openai-tts').catch(() => ''));
        if (key) voiceInstance!.setApiKey(key);
      } catch { /* secrets not available yet */ }
    })();
  }
  await voiceInitPromise;
  return voiceInstance;
}

export function getVoice(): VoiceManager {
  if (!voiceInstance) voiceInstance = new VoiceManager();
  return voiceInstance;
}

/** Async version that loads persisted key. Use in IPC handlers. */
export { initVoiceManager as getVoiceAsync };
