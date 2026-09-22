// LaunchProduct chain test — stubs the stage tools in the registry and
// verifies the full build → jingle → video → sell pipeline reports every
// stage, propagates failures, and validates args.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchProductTool } from './launch-product.js';
import { toolRegistry, type Tool } from './base.js';
import { registerBuiltinTools } from './registry.js';

const ctx = () => ({ cwd: process.cwd(), abortSignal: new AbortController().signal, sessionId: 'test', onUpdate: () => {} });

let saved: Map<string, Tool> = new Map();

function stub(name: string, impl: Tool['execute']): void {
  const original = toolRegistry.get(name);
  if (original && !saved.has(name)) saved.set(name, original);
  toolRegistry.register({ name, description: 'stub', inputSchema: {}, permission: 'none', execute: impl });
}

beforeEach(() => {
  saved = new Map();
  registerBuiltinTools(); // ensure the real stage tools exist so stubs can restore
});
afterEach(() => {
  for (const tool of saved.values()) toolRegistry.register(tool);
});

describe('LaunchProduct', () => {
  it('requires idea and name', async () => {
    const r = await launchProductTool.execute({ idea: 'x' }, ctx());
    expect(r.is_error).toBe(true);
    const r2 = await launchProductTool.execute({ name: 'x' }, ctx());
    expect(r2.is_error).toBe(true);
  });

  it('runs the full chain: build → jingle → video → package+payment', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'launch-'));
    const appDir = join(ws, 'apps', 'TestApp');
    mkdirSync(appDir, { recursive: true });
    // BuildFeature stub: emulates the real builder writing under the workspace
    stub('BuildFeature', async () => {
      writeFileSync(join(appDir, 'index.html'), '<h1>TestApp</h1>');
      return { content: `Built TestApp at ${appDir}` };
    });
    stub('MusicGen', async (args) => ({ content: `music at ${(args as { outputDir?: string }).outputDir}` }));
    stub('VideoGen', async () => ({ content: 'video at /tmp/x.mp4' }));
    stub('SellApp', async () => ({ content: 'Payment link: https://buy.stripe.com/test_123' }));
    try {
      const r = await launchProductTool.execute({ idea: 'a tiny todo widget', name: 'TestApp' }, { ...ctx(), cwd: ws });
      const text = r.content as string;
      expect(text).toContain('Launch report — TestApp');
      expect(text).toContain('✅ build');
      expect(text).toContain('✅ jingle');
      expect(text).toContain('✅ video');
      expect(text).toContain('✅ package+payment');
      expect(existsSync(join(appDir, 'index.html'))).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  /** Temp workspace with a pre-built app dir (simulates a successful build). */
  function tempWorkspace(name: string): string {
    const ws = mkdtempSync(join(tmpdir(), 'launch-'));
    mkdirSync(join(ws, 'apps', name), { recursive: true });
    writeFileSync(join(ws, 'apps', name, 'index.html'), '<h1></h1>');
    return ws;
  }

  it('propagates build failure and stops before packaging', async () => {
    stub('BuildFeature', async () => ({ content: 'typecheck failed', is_error: true }));
    let sellCalled = false;
    stub('SellApp', async () => { sellCalled = true; return { content: 'should not be called' }; });
    stub('MusicGen', async () => ({ content: 'nope' }));
    const r = await launchProductTool.execute({ idea: 'x', name: 'FailApp' }, ctx());
    expect(r.is_error).toBe(true);
    expect((r.content as string)).toContain('Build failed');
    expect(sellCalled).toBe(false);
  });

  it('skips jingle/video when asked', async () => {
    const ws = tempWorkspace('S');
    let musicCalled = false;
    let videoCalled = false;
    stub('BuildFeature', async () => ({ content: 'built' }));
    stub('MusicGen', async () => { musicCalled = true; return { content: 'm' }; });
    stub('VideoGen', async () => { videoCalled = true; return { content: 'v' }; });
    stub('SellApp', async () => ({ content: 'sell' }));
    try {
      const r = await launchProductTool.execute({ idea: 'x', name: 'S', skip_jingle: true, skip_video: true }, { ...ctx(), cwd: ws });
      expect(musicCalled).toBe(false);
      expect(videoCalled).toBe(false);
      expect(r.is_error).toBeUndefined();
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('treats jingle/video failure as non-fatal', async () => {
    const ws = tempWorkspace('Resilient');
    stub('BuildFeature', async () => ({ content: 'built' }));
    stub('MusicGen', async () => ({ content: 'audio api down', is_error: true }));
    stub('VideoGen', async () => ({ content: 'ffmpeg missing', is_error: true }));
    stub('SellApp', async () => ({ content: 'Payment link: https://buy.stripe.com/ok' }));
    try {
      const r = await launchProductTool.execute({ idea: 'x', name: 'Resilient' }, { ...ctx(), cwd: ws });
      const text = r.content as string;
      expect(text).toContain('❌ jingle');
      expect(text).toContain('❌ video');
      expect(text).toContain('✅ package+payment');
      expect(r.is_error).toBeUndefined(); // media failures don't sink the launch
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
