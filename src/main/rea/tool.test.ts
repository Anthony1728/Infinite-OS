import { describe, expect, it } from 'vitest';
import { registerBuiltinTools } from '../tools/registry.js';
import { CORE_TOOL_NAMES, toolRegistry, type ToolContext } from '../tools/base.js';
import { createReaTool } from './tool.js';
import type { ReaBackend, ReaCallOptions, ReaCallResult, ReaToolInfo } from './client.js';

const catalogue: ReaToolInfo[] = [
  {
    name: 'open_binary',
    description: 'Open a binary target and start an analysis session.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'binary_overview',
    description: 'Summarize the open target: sections, imports and entry points.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'procedure_pseudo_code',
    description: 'Decompile one procedure to pseudo-code for review.',
    inputSchema: { type: 'object', properties: { procedure: { type: 'string' } }, required: ['procedure'] },
  },
];

class FakeBackend implements ReaBackend {
  calls: Array<{ name: string; args: Record<string, unknown>; timeoutMs?: number }> = [];
  installCalls = 0;
  closed = false;
  callResult: ReaCallResult = { text: 'ok', isError: false, truncated: false };
  failure: Error | null = null;

  async listTools(): Promise<ReaToolInfo[]> {
    if (this.failure) throw this.failure;
    return catalogue;
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    opts?: ReaCallOptions,
  ): Promise<ReaCallResult> {
    this.calls.push({ name, args, timeoutMs: opts?.timeoutMs });
    return this.callResult;
  }

  async install(onProgress?: (line: string) => void): Promise<string> {
    this.installCalls += 1;
    onProgress?.('halfway');
    return 'Installed REA.';
  }

  statusReport(): string {
    return 'REA status text';
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function context(updates: string[] = []): ToolContext {
  return {
    cwd: process.cwd(),
    abortSignal: new AbortController().signal,
    sessionId: 'test',
    onUpdate: (partial) => {
      if (typeof partial.content === 'string') updates.push(partial.content);
    },
  };
}

describe('Rea tool', () => {
  it('is registered in the core set so models can always reach it', () => {
    registerBuiltinTools();
    const registered = toolRegistry.get('Rea');
    expect(registered).toBeDefined();
    expect(CORE_TOOL_NAMES.has('Rea')).toBe(true);
    expect(registered?.permission).toBe('ask');
  });

  it('reports status without starting the server', async () => {
    const backend = new FakeBackend();
    const result = await createReaTool(backend).execute({ action: 'status' }, context());
    expect(result.is_error).toBeFalsy();
    expect(result.content).toBe('REA status text');
    expect(backend.calls).toHaveLength(0);
  });

  it('lists entry points and can search the catalogue', async () => {
    const tool = createReaTool(new FakeBackend());

    const all = await tool.execute({ action: 'tools' }, context());
    expect(String(all.content)).toContain('3 REA tools available');
    expect(String(all.content)).toContain('open_binary');
    expect(String(all.content)).toContain('action=tools query=');

    const found = await tool.execute({ action: 'tools', query: 'decompile' }, context());
    expect(String(found.content)).toContain('procedure_pseudo_code');
    expect(String(found.content)).not.toContain('- open_binary');
  });

  it('returns one exact schema when asked by name', async () => {
    const result = await createReaTool(new FakeBackend()).execute(
      { action: 'tools', tool: 'open_binary' },
      context(),
    );
    const text = String(result.content);
    expect(text).toContain('"name": "open_binary"');
    expect(text).toContain('"required"');
    expect(result.is_error).toBeFalsy();
  });

  it('suggests names instead of calling a typo', async () => {
    const backend = new FakeBackend();
    const result = await createReaTool(backend).execute(
      { action: 'tools', tool: 'open_binry' },
      context(),
    );
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('open_binary');
    expect(backend.calls).toHaveLength(0);
  });

  it('forwards arguments, signal and timeout on a call', async () => {
    const backend = new FakeBackend();
    backend.callResult = { text: 'analysis complete', isError: false, truncated: false };
    const result = await createReaTool(backend).execute(
      {
        action: 'call',
        tool: 'procedure_pseudo_code',
        arguments: { procedure: '0x401000' },
        timeout_ms: 5_000,
      },
      context(),
    );
    expect(result.content).toBe('analysis complete');
    expect(result.is_error).toBeFalsy();
    expect(backend.calls).toEqual([
      { name: 'procedure_pseudo_code', args: { procedure: '0x401000' }, timeoutMs: 5_000 },
    ]);
  });

  it('passes REA tool errors through as tool errors', async () => {
    const backend = new FakeBackend();
    backend.callResult = { text: 'target is not open', isError: true, truncated: false };
    const result = await createReaTool(backend).execute(
      { action: 'call', tool: 'binary_overview' },
      context(),
    );
    expect(result.is_error).toBe(true);
    expect(result.content).toBe('target is not open');
  });

  it('refuses to call an unknown tool even when arguments look plausible', async () => {
    const backend = new FakeBackend();
    const result = await createReaTool(backend).execute(
      { action: 'call', tool: 'open_binry', arguments: { path: 'C:\\x.exe' } },
      context(),
    );
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('open_binary');
    expect(backend.calls).toHaveLength(0);
  });

  it('requires an arguments object', async () => {
    const backend = new FakeBackend();
    const result = await createReaTool(backend).execute(
      { action: 'call', tool: 'open_binary', arguments: ['C:\\x.exe'] as unknown as Record<string, unknown> },
      context(),
    );
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('JSON object');
    expect(backend.calls).toHaveLength(0);
  });

  it('installs once and streams progress to the user', async () => {
    const backend = new FakeBackend();
    const updates: string[] = [];
    const result = await createReaTool(backend).execute({ action: 'install' }, context(updates));
    expect(result.content).toBe('Installed REA.');
    expect(backend.installCalls).toBe(1);
    expect(updates.join('\n')).toContain('Installing REA');
    expect(updates.join('\n')).toContain('halfway');
  });

  it('turns a backend failure into readable guidance, not a throw', async () => {
    const backend = new FakeBackend();
    backend.failure = new Error('REA is not installed yet. Run action=install once.');
    const result = await createReaTool(backend).execute({ action: 'tools' }, context());
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('action=install');
  });

  it('names the valid actions on a typo', async () => {
    const result = await createReaTool(new FakeBackend()).execute({ action: 'analze' }, context());
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toContain('status, tools, call or install');
  });
});
