// LaunchProduct — the full "make money from a creation" run in one command:
// build the app → generate a jingle → render a promo video → package it →
// produce a Stripe payment link. Each stage is a real tool call (BuildFeature
// or builder logic, MusicGen, VideoGen, SellApp), so every artifact is a real
// file on disk and the final output is a shoppable link — not a plan.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Tool, ToolResult } from './base.js';
import { toolRegistry } from './base.js';
import { creationsAppsDir } from '../creations/home.js';

interface LaunchArgs {
  idea?: string;
  name?: string;
  price_usd?: number;
  skip_jingle?: boolean;
  skip_video?: boolean;
}

interface StageResult {
  stage: string;
  ok: boolean;
  detail: string;
}

export const launchProductTool: Tool = {
  name: 'LaunchProduct',
  description:
    'Full product launch in one run: build the app from an idea, generate a jingle + promo video, package it, create a Stripe payment link. Returns a stage report with paths and the link.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      idea: { type: 'string', description: 'What the app does, for whom' },
      name: { type: 'string', description: 'Product name' },
      price_usd: { type: 'number', description: 'USD price for the link' },
      skip_jingle: { type: 'boolean', description: 'Skip music' },
      skip_video: { type: 'boolean', description: 'Skip video' },
    },
    required: ['idea', 'name'],
  },

  async execute(args, ctx): Promise<ToolResult> {
    const a = (args ?? {}) as LaunchArgs;
    const idea = (a.idea ?? '').trim();
    const name = (a.name ?? '').trim();
    if (!idea || !name) return { content: 'LaunchProduct needs both `idea` and `name`.', is_error: true };
    const price = typeof a.price_usd === 'number' && a.price_usd > 0 ? a.price_usd : undefined;

    const stages: StageResult[] = [];
    const t0 = Date.now();

    const callTool = async (toolName: string, args: unknown): Promise<ToolResult> => {
      const tool = toolRegistry.get(toolName);
      if (!tool) return { content: `Tool ${toolName} is not registered.`, is_error: true };
      return tool.execute(args, ctx);
    };

    // 1) Build the app — BuildFeature drops it under creations/apps
    const build = await callTool('BuildFeature', {
      name,
      description: `Standalone sellable app. ${idea}`,
      changes: [
        {
          path: join('apps', name, 'index.html'),
          content: renderAppHtml(name, idea),
        },
        {
          path: join('apps', name, 'README.md'),
          content: `# ${name}\n\n${idea}\n\nBuilt by Infinite OS — LaunchProduct.\n`,
        },
      ],
      validation: 'none',
    });
    stages.push({ stage: 'build', ok: !build.is_error, detail: summarize(build) });
    if (build.is_error) return report(name, stages, t0, 'Build failed — stopping before packaging.');

    // BuildFeature writes relative to the workspace — locate what it built.
    const appDir = locateAppDir(ctx.cwd, name);
    if (!appDir) {
      stages.push({
        stage: 'build-path',
        ok: false,
        detail: `No app dir found at ${join(ctx.cwd, 'apps', name)} or ${join(creationsAppsDir(), name)}`,
      });
      return report(name, stages, t0, 'Build output not found — stopping.');
    }

    // 2) Jingle
    if (!a.skip_jingle) {
      const jingle = await callTool('MusicGen', {
        prompt: `Upbeat short jingle for "${name}" — ${idea}. Bright, memorable, 15 seconds.`,
        duration_seconds: 15,
        outputDir: join(appDir, 'media'),
      });
      stages.push({ stage: 'jingle', ok: !jingle.is_error, detail: summarize(jingle) });
    } else {
      stages.push({ stage: 'jingle', ok: true, detail: 'skipped by request' });
    }

    // 3) Promo video (uses the same app dir for media output)
    if (!a.skip_video) {
      const video = await callTool('VideoGen', {
        prompt: `Sleek product promo for ${name}: ${idea}. Clean motion, confident pacing, product hero shots style.`,
        seconds: 8,
        size: '1280x720',
        outputDir: join(appDir, 'media'),
      });
      stages.push({ stage: 'video', ok: !video.is_error, detail: summarize(video) });
    } else {
      stages.push({ stage: 'video', ok: true, detail: 'skipped by request' });
    }

    // 4) Package + Stripe payment link
    const sell = await callTool('SellApp', {
      path: appDir,
      name,
      price_usd: price,
      description: idea.slice(0, 300),
    });
    stages.push({ stage: 'package+payment', ok: !sell.is_error, detail: summarize(sell) });

    return report(name, stages, t0, undefined);
  },
};

function summarize(r: ToolResult): string {
  if (typeof r.content !== 'string') return '[non-text result]';
  return r.content.length > 900 ? r.content.slice(0, 880) + '…' : r.content;
}

/** BuildFeature writes under the workspace; legacy builders use creations/. */
function locateAppDir(cwd: string, name: string): string | null {
  for (const candidate of [join(cwd, 'apps', name), join(creationsAppsDir(), name)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function report(name: string, stages: StageResult[], t0: number, failure?: string): ToolResult {
  const lines = [`Launch report — ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`];
  for (const s of stages) lines.push(`${s.ok ? '✅' : '❌'} ${s.stage}: ${s.detail}`);
  if (failure) lines.push(`⚠️ ${failure}`);
  const fatal = stages.some((s) => !s.ok && s.stage !== 'jingle' && s.stage !== 'video');
  return fatal ? { content: lines.join('\n\n'), is_error: true } : { content: lines.join('\n\n') };
}

function renderAppHtml(name: string, idea: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, sans-serif;
         background: radial-gradient(1200px 600px at 50% -10%, #1e3a5f 0%, #0f0a1e 60%); color: #f5f3ff; }
  .card { max-width: 640px; padding: 48px; text-align: center; }
  h1 { font-size: 44px; margin: 0 0 16px; letter-spacing: -0.02em; }
  p { font-size: 18px; line-height: 1.6; color: rgba(245,243,255,0.75); margin: 0; }
  .badge { display: inline-block; margin-top: 32px; padding: 8px 18px; border: 1px solid rgba(255,255,255,0.15);
           border-radius: 999px; font-size: 13px; color: rgba(245,243,255,0.6); }
</style>
</head>
<body>
  <main class="card">
    <h1>${esc(name)}</h1>
    <p>${esc(idea)}</p>
    <span class="badge">Built with Infinite OS</span>
  </main>
</body>
</html>
`;
}
