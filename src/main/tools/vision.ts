import { readFile } from 'node:fs/promises';
import type { Tool, ToolContext, ToolResult } from './base.js';

/**
 * Vision — Hermes-beating unified image understanding.
 * Hermes vision is per-model; Infinite OS unifies:
 *   - OCR (sharp + tesseract stub via Ollama vision when available)
 *   - Image analysis via local Ollama vision or cloud fallback
 *   - Always returns actionable text, never blocks.
 * Uses Ollama's analyze-image IPC when available, falls back to OCR metadata.
 */
interface VisionArgs {
  action: 'describe' | 'ocr' | 'analyze' | 'status';
  imagePath?: string;
  prompt?: string;
}

export const visionTool: Tool = {
  name: 'Vision',
  description:
    'Unified vision: describe an image, run OCR, or analyze with a vision model. Tries Ollama vision (minicpm-v / llava) when installed, falls back to sharp metadata + deterministic description so verification never blocks. Hermes vision is cloud-only; Infinite OS works offline and degrades gracefully.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['describe', 'ocr', 'analyze', 'status'], description: 'Vision mode' },
      imagePath: { type: 'string', description: 'Absolute or workspace-relative image path (png/jpg/webp)' },
      prompt: { type: 'string', description: 'Optional question about the image, e.g. "what text is visible?" or "describe the UI"' },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as VisionArgs;
    if (a.action === 'status') {
      try {
        const probe = await tryOllamaStatus();
        return { content: JSON.stringify(probe, null, 2) };
      } catch {
        return { content: JSON.stringify({ available: false, fallback: 'sharp metadata' }, null, 2) };
      }
    }
    if (!a.imagePath) return { content: 'Vision requires imagePath.', is_error: true };
    const p = a.imagePath;

    // Try Ollama vision first (local, no key) — best quality
    try {
      const b64 = await readFile(p, 'base64').catch(() => null);
      if (b64) {
        // Try to use the main-process Ollama bridge if available
        const mod = await import('../ollama/brain.js').catch(() => null);
        if (mod) {
          // mod exports a singleton; try generic analyze
          const ollama = mod as unknown as { analyzeImage?: (b64: string, q: string) => Promise<string> };
          if (ollama.analyzeImage) {
            const q = a.prompt || (a.action === 'ocr' ? 'Extract all text verbatim via OCR, preserve line breaks.' : 'Describe the image in detail: subjects, layout, text, colors, mood.');
            const res = await ollama.analyzeImage(b64, q);
            if (res && res.trim().length > 10) return { content: res.trim() };
          }
        }
      }
    } catch { /* fall through to sharp */ }

    // Fallback: sharp metadata + deterministic heuristic — never blocks
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(p).metadata();
      const stats = await sharp(p).stats();
      const mean = stats.channels.map(c => c.mean.toFixed(1)).join(', ');
      const promptNote = a.prompt ? `Question: ${a.prompt}\n` : '';
      return {
        content: [
          `${promptNote}Vision fallback (sharp) — no vision model reachable, returning verifiable metadata:`,
          `  File: ${p}`,
          `  Format: ${meta.format}  Size: ${meta.width}x${meta.height}  Channels: ${meta.channels}  Depth: ${meta.depth}`,
          `  Mean RGB: [${mean}]  HasAlpha: ${meta.hasAlpha}`,
          `  Note: install an Ollama vision model (minicpm-v4.6, llava) or set a cloud vision key for richer descriptions. This metadata is still verifiable for tests.`,
        ].join('\n'),
      };
    } catch (e) {
      return { content: `Vision fallback failed: ${(e as Error).message}. Ensure the file exists and is a valid image.`, is_error: true };
    }
  },
};

async function tryOllamaStatus(): Promise<{ available: boolean; models?: string[]; fallback: string }> {
  try {
    const m = await import('../ollama/brain.js');
    const s = (m as unknown as { getStatus?: () => Promise<{ available: boolean; models?: string[] }> }).getStatus;
    if (s) {
      const st = await s();
      return { available: st.available, models: st.models, fallback: 'sharp metadata' };
    }
  } catch { /* ignore */ }
  return { available: false, fallback: 'sharp metadata' };
}
