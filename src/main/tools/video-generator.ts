// VideoGen — text-to-video with graceful degradation, following the
// ImageGenerator contract: multi-provider chain → deterministic fallback →
// always a real, playable video file on disk.
//
// Provider chain:
//   1. Replicate (REPLICATE key): luma/ray or wave-speed SDXL-video style models
//   2. ffmpeg from generated stills — keyless, uses ImageGenerator quality chain
//      (OpenAI/Stability if keys exist, else deterministic SVG frames)

import { mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaEnvelope } from './image-generator.js';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { Tool, ToolResult, ToolContext } from './base.js';
import { outputDirectoryDenial } from './write-guard.js';
import { resolveProviderKey, redact } from './media-keys.js';

const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', 'infinite-videos');

interface VideoArgs {
  prompt?: string;
  seconds?: number;
  size?: string;
  outputDir?: string;
}

export const videoGeneratorTool: Tool = {
  name: 'VideoGen',
  description:
    'Generate a short mp4 video from text; cloud models with API keys, ffmpeg slideshow fallback otherwise. Always returns a real file path.',
  permission: 'none',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Scene, motion, style' },
      seconds: { type: 'number', description: 'Duration 2–60s' },
      size: { type: 'string', description: 'WxH, e.g. 1280x720' },
      outputDir: { type: 'string', description: 'Output directory' },
    },
    required: ['prompt'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = (args ?? {}) as VideoArgs;
    const prompt = (a.prompt ?? '').trim();
    if (!prompt) return { content: 'VideoGen requires a non-empty prompt.', is_error: true };
    const seconds = Math.max(2, Math.min(60, Math.round(a.seconds ?? 6)));
    const size = /^\d{2,5}x\d{2,5}$/.test(a.size ?? '') ? (a.size as string) : '1280x720';
    const outDir = a.outputDir || OUTPUT_DIR;
    const denied = outputDirectoryDenial(outDir, ctx?.cwd);
    if (denied) return { content: denied, is_error: true };
    await mkdir(outDir, { recursive: true });

    // 1) Replicate cloud video
    try {
      const key = await resolveProviderKey('replicate', 'REPLICATE_API_TOKEN');
      if (key) {
        const created = await fetchWithTimeout(
          'https://api.replicate.com/v1/predictions',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Prefer: 'wait' },
            body: JSON.stringify({
              version: 'meta/video-1',
              input: { prompt, duration: Math.min(20, seconds), aspect_ratio: aspectOf(size) },
            }),
          },
          ctx.abortSignal,
        );
        if (created.ok) {
          const j = (await created.json()) as { output?: string | string[] };
          const url = Array.isArray(j.output) ? j.output[0] : j.output;
          if (url) {
            const vid = await fetchWithTimeout(url, { method: 'GET' }, ctx.abortSignal);
            if (vid.ok) {
              const p = join(outDir, `video-${randomUUID().slice(0, 8)}.mp4`);
              await writeFile(p, Buffer.from(await vid.arrayBuffer()));
              return {
                content: `Video generated via Replicate (${Math.min(20, seconds)}s) — saved to:\n${p}\nPrompt: ${prompt}${mediaEnvelope('video', p, 'video/mp4')}`,
              };
            }
          }
        } else {
          const body = await safeText(created);
          // Only hard-fail on real API errors; auth/quota/unknown-model fall through
          // to the local slideshow so the user still gets a real file.
          if (![401, 403, 429, 422, 404].includes(created.status)) {
            return { content: `Replicate video ${created.status}: ${redact(body)}`, is_error: true };
          }
        }
      }
    } catch (e) {
      if (isAbort(e)) throw e;
    }

    // 2) ffmpeg slideshow fallback — always available, keyless
    return renderSlideshow(prompt, seconds, size, outDir, ctx.abortSignal);
  },
};

// Extracted so tests can stub fetch and child processes deterministically.
export async function renderSlideshow(
  prompt: string,
  seconds: number,
  size: string,
  outDir: string,
  signal: AbortSignal,
): Promise<ToolResult> {
  const [w, h] = size.split('x').map(Number);
  const work = join(tmpdir(), `infinite-videogen-${randomUUID().slice(0, 8)}`);
  await mkdir(work, { recursive: true });
  try {
    const frameCount = Math.min(12, Math.max(3, Math.round(seconds / 2)));
    const perFrame = seconds / frameCount;
    // Reuse the image generation chain so cloud keys upgrade quality automatically.
    const { imageGeneratorTool } = await import('./image-generator.js');
    const gen = await imageGeneratorTool.execute(
      { prompt: `${prompt} — cinematic still`, size, outputDir: work, n: frameCount } as never,
      { cwd: outDir, abortSignal: signal, sessionId: 'videogen', onUpdate: () => {} } as never,
    );
    // Strip the INFINITE_MEDIA envelope before extracting frame paths — its
    // JSON text (escaped backslashes, trailing ".svg") would otherwise match
    // the path regex below and break frame rasterization.
    const text = typeof gen.content === 'string' ? gen.content.split('INFINITE_MEDIA:')[0] : '';
    const stills = text.match(/^[A-Za-z]:\\[^:\n]+|\S+\.png|\S+\.svg/gm) ?? [];
    if (stills.length === 0) return { content: 'VideoGen: no frames could be produced for the slideshow.', is_error: true };

    // ffmpeg has no SVG decoder — rasterize any SVG frames to PNG via sharp
    // (already a project dependency, used by image-editor).
    const frames: string[] = [];
    for (const f of stills) {
      if (f.endsWith('.png')) { frames.push(f); continue; }
      if (!f.endsWith('.svg')) continue;
      const png = f.replace(/\.svg$/, '.png');
      const sharp = (await import('sharp')).default;
      await sharp(f, { density: 150 }).resize(w, h, { fit: 'contain', background: { r: 15, g: 10, b: 30, alpha: 1 } }).png().toFile(png);
      frames.push(png);
    }
    if (frames.length === 0) return { content: 'VideoGen: frames could not be rasterized for encoding.', is_error: true };

    const listPath = join(work, 'frames.txt');
    const lines = frames.map((f) => `file '${f.replace(/'/g, "'\\''")}'\nduration ${perFrame}`).join('\n');
    await writeFile(listPath, lines + `\nfile '${frames[frames.length - 1].replace(/'/g, "'\\''")}'`);
    const out = join(outDir, `video-${randomUUID().slice(0, 8)}.mp4`);
    await runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-t', String(seconds), '-r', '30', out,
    ]);
    return {
      content: `Video generated via ffmpeg slideshow (${seconds}s, ${w}x${h}) — saved to:\n${out}\nPrompt: ${prompt}${
        stills.some((s) => s.endsWith('.svg'))
          ? '\nHint: save an OpenAI/Stability key for photoreal frames, or a Replicate key for true text-to-video.'
          : ''
      }${mediaEnvelope('video', out, 'video/mp4')}`,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function aspectOf(size: string): string {
  const [w, h] = size.split('x').map(Number);
  const r = w / h;
  if (r > 1.6) return '16:9';
  if (r < 0.7) return '9:16';
  return '1:1';
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

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg failed: ${String(stderr).slice(-600)}`));
      else resolve();
    });
  });
}

async function safeText(r: Response) { try { return (await r.text()).slice(0, 1200); } catch { return `${r.status} ${r.statusText}`; } }
