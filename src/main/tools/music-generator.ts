// MusicGen — text-to-music with graceful degradation, following the
// ImageGenerator contract: multi-provider chain → deterministic fallback →
// always a real, verifiable audio file on disk.
//
// Provider chain:
//   1. ElevenLabs Music (ELEVENLABS key) — highest quality, `iw2` music model
//   2. Replicate meta/musicgen (REPLICATE key) — good quality, slower
//   3. Local WAV synth — chord-progression render from the prompt, no key needed

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Tool, ToolResult, ToolContext } from './base.js';
import { outputDirectoryDenial } from './write-guard.js';
import { resolveProviderKey, redact } from './media-keys.js';
import { mediaEnvelope } from './image-generator.js';

const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', 'infinite-music');

interface MusicArgs {
  prompt?: string;
  duration_seconds?: number;
  outputDir?: string;
}

export const musicGeneratorTool: Tool = {
  name: 'MusicGen',
  description:
    'Generate original music/audio from text; returns a real audio file path (mp3 with API key, WAV otherwise).',
  permission: 'none',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Genre, mood, instruments, tempo' },
      duration_seconds: { type: 'number', description: 'Seconds, 5–120' },
      outputDir: { type: 'string', description: 'Output directory' },
    },
    required: ['prompt'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = (args ?? {}) as MusicArgs;
    const prompt = (a.prompt ?? '').trim();
    if (!prompt) return { content: 'MusicGen requires a non-empty prompt.', is_error: true };
    const seconds = Math.max(5, Math.min(120, Math.round(a.duration_seconds ?? 20)));
    const outDir = a.outputDir || OUTPUT_DIR;
    const denied = outputDirectoryDenial(outDir, ctx?.cwd);
    if (denied) return { content: denied, is_error: true };
    await mkdir(outDir, { recursive: true });

    // 1) ElevenLabs Music
    try {
      const key = await resolveProviderKey('elevenlabs', 'ELEVENLABS_API_KEY');
      if (key) {
        const res = await fetchWithTimeout(
          'https://api.elevenlabs.io/v1/music',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
            body: JSON.stringify({ prompt, music_length_ms: seconds * 1000 }),
          },
          ctx.abortSignal,
        );
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const p = join(outDir, `music-${randomUUID().slice(0, 8)}.mp3`);
          await writeFile(p, buf);
          return ok('ElevenLabs Music', p, prompt, seconds);
        }
        const body = await safeText(res);
        if (res.status !== 401 && res.status !== 403 && res.status !== 429) {
          return { content: `ElevenLabs Music ${res.status}: ${redact(body)}`, is_error: true };
        }
        // auth/quota problem → fall through
      }
    } catch (e) {
      if (isAbort(e)) throw e;
    }

    // 2) Replicate meta/musicgen
    try {
      const key = await resolveProviderKey('replicate', 'REPLICATE_API_TOKEN');
      if (key) {
        const created = await fetchWithTimeout(
          'https://api.replicate.com/v1/predictions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Prefer: 'wait' },
            body: JSON.stringify({
              version: '67321969fd90c6e6f8566084b9dd2b1d7d9c6b3d3b0b8b3f0a9c4e0d2b1c6d5e',
              input: { prompt, duration: seconds, output_format: 'mp3', normalization_strategy: 'peak' },
            }),
          },
          ctx.abortSignal,
        );
        if (created.ok) {
          const j = (await created.json()) as { output?: string | string[] };
          const url = Array.isArray(j.output) ? j.output[0] : j.output;
          if (url) {
            const audio = await fetchWithTimeout(url, { method: 'GET' }, ctx.abortSignal);
            if (audio.ok) {
              const p = join(outDir, `music-${randomUUID().slice(0, 8)}.mp3`);
              await writeFile(p, Buffer.from(await audio.arrayBuffer()));
              return ok('Replicate MusicGen', p, prompt, seconds);
            }
          }
        } else {
          const body = await safeText(created);
          if (created.status !== 401 && created.status !== 403 && created.status !== 429 && created.status !== 422) {
            return { content: `Replicate MusicGen ${created.status}: ${redact(body)}`, is_error: true };
          }
        }
      }
    } catch (e) {
      if (isAbort(e)) throw e;
    }

    // 3) Local deterministic synth — chord progression derived from the prompt
    const p = join(outDir, `music-${randomUUID().slice(0, 8)}.wav`);
    await writeFile(p, renderWav(prompt, seconds));
    return ok('Local synth (no API key)', p, prompt, seconds);
  },
};

function ok(provider: string, path: string, prompt: string, seconds: number): ToolResult {
  return {
    content: `Music generated via ${provider} (${seconds}s) — saved to:\n${path}\nPrompt: ${prompt}${
      provider.startsWith('Local') ? '\nHint: save an ElevenLabs or Replicate key in Settings → AI Provider for studio-quality output.' : ''
    }${mediaEnvelope('audio', path, path.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg')}`,
  };
}

/** 16-bit PCM WAV: I–V–vi–IV progression in a key chosen by prompt hash, with a simple lead arpeggio. */
export function renderWav(prompt: string, seconds: number): Buffer {
  const sampleRate = 22_050;
  const total = Math.max(1, Math.floor(sampleRate * seconds));
  const data = Buffer.alloc(total * 2);
  let hash = 0;
  for (const ch of prompt) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const rootMidi = 48 + (hash % 12); // C3..B3
  const major = hash % 2 === 0;
  const intervals = major ? [0, 4, 7, 12] : [0, 3, 7, 12];
  const progression = [0, 7, 9, 5]; // I V vi IV semitone offsets
  const barLen = Math.max(1, Math.floor((seconds * sampleRate) / 8)); // 8 bars total
  const scale = major ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  for (let i = 0; i < total; i++) {
    const t = i / sampleRate;
    const bar = Math.floor(i / barLen) % 4;
    const chordRoot = rootMidi + progression[bar];
    let s = 0;
    // Pad: triad with slow attack per bar
    const barPos = (i % barLen) / barLen;
    const env = Math.min(1, barPos * 8) * Math.min(1, (1 - barPos) * 8);
    for (const iv of [0, intervals[1], intervals[2]]) {
      s += 0.22 * Math.sin(2 * Math.PI * midiToHz(chordRoot + iv) * t);
    }
    // Lead arpeggio: one note per half-bar from the scale
    const step = Math.floor(i / (barLen / 4)) % 7;
    const lead = chordRoot + 12 + scale[step];
    s += 0.16 * Math.sin(2 * Math.PI * midiToHz(lead) * t) * (0.5 + 0.5 * Math.sin(Math.PI * barPos));
    // Soft percussion: noise ticks on beats
    const beat = (i % Math.floor(barLen / 4)) / Math.floor(barLen / 4);
    if (beat < 0.04) s += (Math.random() * 2 - 1) * 0.12 * (1 - beat / 0.04);
    const v = Math.max(-1, Math.min(1, s * env * 0.9));
    data.writeInt16LE(Math.round(v * 32_767), i * 2);
  }
  return wavHeader(sampleRate, data);
}

function midiToHz(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

export function wavHeader(sampleRate: number, data: Buffer): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal) {
  const c = new AbortController();
  const onAbort = () => c.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => c.abort(), 120_000);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); signal.removeEventListener('abort', onAbort); }
}

async function safeText(r: Response) { try { return (await r.text()).slice(0, 1200); } catch { return `${r.status} ${r.statusText}`; } }
