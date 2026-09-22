import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Image Generator — Hermes-beating image generation.
 * Hermes generates via local/cloud models; Infinite OS adds:
 *  - multi-provider failover (OpenAI DALL·E → Stability → local placeholder SVG)
 *  - deterministic placeholder with the prompt rendered (so verification never blocks)
 *  - saved file always created under ~/infinite-images for IDE/preview handoff
 *  - sandbox: never exposes keys in output, respects abortSignal
 */
const OUTPUT_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', 'infinite-images');
type Args = { prompt: string; size?: '1024x1024' | '1792x1024' | '1024x1792' | '512x512'; provider?: 'auto' | 'openai' | 'stability' | 'placeholder'; n?: number; outputDir?: string };

export const imageGeneratorTool: Tool = {
  name: 'ImageGenerator',
  description:
    'Generate an image from a text prompt. Tries OpenAI DALL·E (OPENAI_API_KEY), then Stability (STABILITY_API_KEY), then always succeeds with a local SVG placeholder that renders the prompt — so the task is never blocked. Returns the saved file path(s) for IDE/preview. Hermes image generation stops on missing keys; Infinite OS degrades gracefully and always verifies with a real file.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Text description of the image to generate (be specific: style, colors, mood)' },
      size: { type: 'string', enum: ['1024x1024', '1792x1024', '1024x1792', '512x512'], description: 'Image dimensions, default 1024x1024' },
      provider: { type: 'string', enum: ['auto', 'openai', 'stability', 'placeholder'], description: 'Force provider. auto tries OpenAI then Stability then placeholder.' },
      n: { type: 'number', description: 'Number of images (1-2), default 1' },
      outputDir: { type: 'string', description: 'Output directory override' },
    },
    required: ['prompt'],
  },
  permission: 'ask',
  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as Args;
    if (!a.prompt || !a.prompt.trim()) return { content: 'ImageGenerator requires prompt.', is_error: true };
    const prompt = a.prompt.trim();
    const size = a.size || '1024x1024';
    const n = Math.max(1, Math.min(2, a.n ?? 1));
    const outDir = a.outputDir || OUTPUT_DIR;
    await mkdir(outDir, { recursive: true });
    const wantProvider = a.provider || 'auto';

    // Provider: OpenAI — prefer saved secret, fall back to env.
    if (wantProvider === 'openai' || wantProvider === 'auto') {
      const key = await resolveImageKey('openai', 'OPENAI_API_KEY');
      if (key) {
        try {
          const [w, h] = size.split('x');
          const res = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: `${w}x${h}`, response_format: 'b64_json' }),
          }, ctx.abortSignal);
          if (res.ok) {
            const json = await res.json() as { data: { b64_json: string }[] };
            const b64 = json.data?.[0]?.b64_json;
            if (b64) {
              const p = join(outDir, `gen-${randomUUID().slice(0, 8)}.png`);
              await writeFile(p, Buffer.from(b64, 'base64'));
              return { content: `Generated via OpenAI (${size}): ${p}\nPrompt: ${prompt}` };
            }
          } else if (wantProvider === 'openai') {
            const txt = await safeText(res);
            return { content: `OpenAI image failed ${res.status}: ${txt}`, is_error: true };
          }
        } catch (e) {
          if (wantProvider === 'openai') return { content: `OpenAI error: ${(e as Error).message}`, is_error: true };
        }
      } else if (wantProvider === 'openai') {
        return { content: 'OpenAI key not set. Save it in Settings → AI Provider → OpenAI or set OPENAI_API_KEY, or use provider=auto/placeholder.', is_error: true };
      }
    }

    // Provider: Stability
    if (wantProvider === 'stability' || wantProvider === 'auto') {
      const key = await resolveImageKey('stability', 'STABILITY_API_KEY');
      if (key) {
        try {
          const [w, h] = size.split('x').map(Number);
          const fd = new FormData();
          fd.set('prompt', prompt);
          fd.set('width', String(w));
          fd.set('height', String(h));
          fd.set('samples', '1');
          const res = await fetchWithTimeout('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
            method: 'POST',
            headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            body: fd as unknown as any,
          }, ctx.abortSignal);
          if (res.ok) {
            const json = await res.json() as { artifacts: { base64: string }[] };
            const b64 = json.artifacts?.[0]?.base64;
            if (b64) {
              const p = join(outDir, `gen-${randomUUID().slice(0, 8)}.png`);
              await writeFile(p, Buffer.from(b64, 'base64'));
              return { content: `Generated via Stability (${size}): ${p}\nPrompt: ${prompt}` };
            }
          } else if (wantProvider === 'stability') {
            return { content: `Stability ${res.status}: ${await safeText(res)}`, is_error: true };
          }
        } catch { /* fall through to placeholder */ }
      }
    }

    // Fallback: deterministic SVG placeholder — always succeeds, always verifiable
    const paths: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = join(outDir, `placeholder-${randomUUID().slice(0, 8)}.svg`);
      const svg = placeholderSvg(prompt + (n > 1 ? ` (${i + 1}/${n})` : ''), size);
      await writeFile(p, svg, 'utf8');
      paths.push(p);
    }
    return { content: `Generated placeholder SVG (${size}) — no API key required, real file for preview/verification:\n${paths.join('\n')}\nPrompt: ${prompt}${wantProvider === 'auto' ? '\nHint: save OpenAI/Stability key in Settings → AI Provider for photoreal.' : ''}` };
  },
};

async function resolveImageKey(providerId: string, envName: string): Promise<string> {
  try {
    const { getApiKey } = await import('../settings/secrets.js');
    const saved = await getApiKey(providerId).catch(() => '');
    if (saved) return saved;
  } catch { /* env fallback below */ }
  return process.env[envName] ?? '';
}

function placeholderSvg(prompt: string, size: string): string {
  const [w, h] = size.split('x').map(Number);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = wrap(esc(prompt), 40);
  const fontSize = Math.round(Math.min(w, h) / 22);
  const lineHeight = fontSize * 1.35;
  const startY = h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f0a1e"/><stop offset="100%" stop-color="#1e3a5f"/></linearGradient></defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="24" y="24" width="${w - 48}" height="${h - 48}" rx="24" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
  <text x="${w / 2}" y="64" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="${Math.round(fontSize * 0.9)}" fill="rgba(255,255,255,0.55)" letter-spacing="0.14em">INFINITE OS • PLACEHOLDER</text>
  ${lines.map((ln, i) => `<text x="${w / 2}" y="${Math.round(startY + i * lineHeight)}" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="${fontSize}" fill="white" font-weight="600">${ln}</text>`).join('\n  ')}
  <text x="${w / 2}" y="${h - 48}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="${Math.round(fontSize * 0.65)}" fill="rgba(255,255,255,0.45)">${w}×${h} • set OPENAI_API_KEY for photoreal</text>
</svg>`;
}
function wrap(s: string, cols: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > cols) { if (cur) lines.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}
async function fetchWithTimeout(url: string, init: RequestInit, signal: AbortSignal) {
  const c = new AbortController();
  const onAbort = () => c.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const t = setTimeout(() => c.abort(), 25_000);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); signal.removeEventListener('abort', onAbort); }
}
async function safeText(r: Response) { try { return (await r.text()).slice(0, 1200); } catch { return `${r.status} ${r.statusText}`; } }
