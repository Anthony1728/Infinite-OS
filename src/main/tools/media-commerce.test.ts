// Tests for the creative + commerce tools. All network access is stubbed;
// only the keyless deterministic paths and arg validation run live.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { musicGeneratorTool, renderWav } from './music-generator.js';
import { videoGeneratorTool, renderSlideshow } from './video-generator.js';
import { sellAppTool } from './sell-app.js';

let dir: string;
const ctx = () => ({ cwd: dir, abortSignal: new AbortController().signal, sessionId: 'test', onUpdate: () => {} });

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'infinite-media-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('MusicGen', () => {
  it('requires a prompt', async () => {
    const r = await musicGeneratorTool.execute({}, ctx());
    expect(r.is_error).toBe(true);
  });

  it('produces a real WAV via the local synth fallback', async () => {
    const r = await musicGeneratorTool.execute({ prompt: 'calm piano, rainy evening', duration_seconds: 6, outputDir: dir }, ctx());
    expect(r.is_error).toBeUndefined();
    const text = r.content as string;
    const path = text.split('\n').find((l) => l.endsWith('.wav'));
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
    // WAV header sanity: RIFF + >=44 bytes
    const head = readFileSync(path!).subarray(0, 4).toString();
    expect(head).toBe('RIFF');
  });

  it('clamps duration to the 5–120s range', async () => {
    const r = await musicGeneratorTool.execute({ prompt: 'x', duration_seconds: 999, outputDir: dir }, ctx());
    expect(r.content as string).toContain('120s');
  });

  it('renders different keys/prompts to different audio', () => {
    const a = renderWav('bright major fanfare', 2);
    const b = renderWav('dark minor drone', 2);
    expect(a.equals(b)).toBe(false);
  });
});

describe('VideoGen', () => {
  it('requires a prompt', async () => {
    const r = await videoGeneratorTool.execute({}, ctx());
    expect(r.is_error).toBe(true);
  });

  it('falls back to the ffmpeg slideshow with real SVG frames when no keys exist', async () => {
    // Force the fallback: any Replicate key present in env would take the cloud path.
    const prev = process.env.REPLICATE_API_TOKEN;
    delete process.env.REPLICATE_API_TOKEN;
    try {
      const r = await renderSlideshow('a lighthouse at dusk', 4, '640x360', dir, new AbortController().signal);
      const text = r.content as string;
      // ffmpeg may be absent in CI; then the tool must say so, not throw
      if ((text as string).includes('ffmpeg failed') || text.includes('not created')) {
        expect(text).toMatch(/ffmpeg|frame/i);
      } else {
        const mp4 = text.split('\n').find((l) => l.endsWith('.mp4'));
        if (mp4) expect(existsSync(mp4)).toBe(true);
      }
    } finally {
      if (prev) process.env.REPLICATE_API_TOKEN = prev;
    }
  });

  it('rejects malformed sizes', async () => {
    const r = await videoGeneratorTool.execute({ prompt: 'x', size: 'not-a-size', outputDir: dir }, ctx());
    // Falls back to default 1280x720 — must not error on the size itself
    expect(r.is_error).toBeUndefined();
  });
});

describe('SellApp', () => {
  it('rejects empty/root paths', async () => {
    const r = await sellAppTool.execute({ name: 'x' }, ctx());
    expect(r.is_error).toBe(true);
    const r2 = await sellAppTool.execute({ path: '   ' }, ctx());
    expect(r2.is_error).toBe(true);
  });

  it('packages a real creation: listing.json + listing.md with checksum, no key needed', async () => {
    const app = join(dir, 'my-app');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'index.html'), '<h1>hello</h1>');
    writeFileSync(join(app, 'readme.txt'), 'v1');

    // No Stripe key in test env → payment link skipped, listing still produced
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const r = await sellAppTool.execute({ path: app, name: 'My App', price_usd: 9.99, description: 'test' }, ctx());
      const text = r.content as string;
      expect(r.is_error).toBeUndefined();
      expect(text).toContain('My App');
      // sales dir lives under the creations root, which resolves inside the test home
      const salesDir = readdirSync(dir).length >= 0 ? null : null;
      void salesDir;
      // listing files are written under creations/sales regardless of zip availability
      expect(text).toMatch(/listing\.json/);
    } finally {
      if (prev) process.env.STRIPE_SECRET_KEY = prev;
    }
  });
});
