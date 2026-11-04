import { afterEach, describe, expect, it, vi } from 'vitest';
import { availableOpenCodeModels, clearInvalidCliCredential, compareVersions, describeOpenCodeFailure, freeOpenCodeModels, getInstalledOpenCodeVersion, heartbeatDue, isOpenCodeVersionAtLeast, isTierRetryable, openCodeAuthLoginHint, openCodeFundsHint, openCodeHeartbeatIntervalMs, openCodeKeylessModels, openCodeOwnModels, openCodeProgressChunk, openCodeQuietTurnTimeoutReasons, openCodeUnavailableError, openCodeUpgradeHint, openCodeZenModels, opencode, orderFreeRotation, otherTier, resolveLiveOpenCodeModel, setLastGoodFreeModel, setOpenCodeFirstByteTimeout, setOpenCodeStallTimeout, tierFor, timeoutSignal, transcript, tryRemote, withOpenCodeHints, withUpgradeHint, OPENCODE_MIN_FREE_VERSION, OPENCODE_STALL_TIMEOUT_MS } from './opencode.js';
import type { ChatRequest, StreamChunk } from './base.js';
import type { Message } from '../../shared/types.js';

type Catalog = Parameters<typeof freeOpenCodeModels>[0];

// Captured before any test mutates the live binding via setOpenCodeStallTimeout.
const DEFAULT_STALL_TIMEOUT_MS = OPENCODE_STALL_TIMEOUT_MS;

describe('OpenCode free chat model filtering', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps only connected, free, active text-generation models', () => {
    const catalog = {
      connected: ['nvidia'],
      all: [
        {
          id: 'nvidia',
          name: 'NVIDIA',
          models: {
            'meta/llama-chat': {
              name: 'Llama Chat',
              capabilities: { input: { text: true }, output: { text: true }, toolcall: true },
              cost: { input: 0, output: 0 },
            },
            'baai/bge-m3': {
              name: 'BGE M3',
              capabilities: { input: { text: true }, output: { text: true } },
              cost: { input: 0, output: 0 },
            },
            'vendor/rerank-large': { name: 'Rerank Large', cost: { input: 0, output: 0 } },
            'audio/whisper-large': { name: 'Whisper', cost: { input: 0, output: 0 } },
            'safe/moderation': { name: 'Moderation', cost: { input: 0, output: 0 } },
            'meta/esm2-650m': { name: 'ESM2 Protein Model', cost: { input: 0, output: 0 } },
            'nvidia/gliner-pii': { name: 'GLiNER PII Classifier', cost: { input: 0, output: 0 } },
            'security/llama-guard': { name: 'Llama Guard', cost: { input: 0, output: 0 } },
            'paid/chat': { name: 'Paid Chat', cost: { input: 0.01, output: 0 } },
            'old/chat': { name: 'Old Chat', status: 'deprecated', cost: { input: 0, output: 0 } },
            'image-only': {
              name: 'Image Only',
              capabilities: { input: { text: true }, output: { text: false } },
              cost: { input: 0, output: 0 },
            },
          },
        },
        {
          id: 'disconnected',
          models: { 'free/chat': { name: 'Free Chat', cost: { input: 0, output: 0 } } },
        },
      ],
    } as Catalog;

    expect(freeOpenCodeModels(catalog).map((model) => model.id)).toEqual(['nvidia::meta/llama-chat']);
  });

  it('marks models without tool calling as chat-capable but tool-limited', () => {
    const catalog = {
      connected: ['local'],
      all: [{
        id: 'local',
        models: {
          chat: { capabilities: { toolcall: false }, cost: { input: 0, output: 0 } },
        },
      }],
    } as Catalog;

    expect(freeOpenCodeModels(catalog)).toMatchObject([
      { id: 'local::chat', provider: 'opencode', free: true, supports_tools: false },
    ]);
  });

  it('adds paid Zen models only when subscription access is enabled', () => {
    const catalog = {
      connected: ['opencode'],
      all: [{
        id: 'opencode',
        name: 'OpenCode Zen',
        models: {
          'big-pickle': { name: 'Big Pickle', cost: { input: 0, output: 0 } },
          'gpt-5.4-mini': { name: 'GPT 5.4 Mini', cost: { input: 0.75, output: 4.5 } },
          'text-embedding': { name: 'Embedding', cost: { input: 0.1, output: 0 } },
        },
      }],
    } as Catalog;

    expect(availableOpenCodeModels(catalog).map((model) => model.id)).toEqual(['opencode::big-pickle']);
    expect(availableOpenCodeModels(catalog, true)).toMatchObject([
      { id: 'opencode::big-pickle', free: true },
      { id: 'opencode::gpt-5.4-mini', free: false },
    ]);
  });

  it('shows only OpenCode\'s own models for the no-key path, never unrelated connected providers', () => {
    const catalog = {
      connected: ['nvidia', 'opencode'],
      all: [
        {
          id: 'nvidia',
          name: 'NVIDIA',
          models: {
            'meta/llama-chat': { name: 'Llama Chat', cost: { input: 0, output: 0 } },
            'nvidia/paid': { name: 'Paid Nvidia', cost: { input: 0.01, output: 0 } },
          },
        },
        {
          id: 'opencode',
          name: 'OpenCode Zen',
          models: {
            'big-pickle': { name: 'Big Pickle', cost: { input: 0, output: 0 } },
            'gpt-5.4-mini': { name: 'GPT 5.4 Mini', cost: { input: 0.75, output: 4.5 } },
          },
        },
      ],
    } as Catalog;

    expect(openCodeOwnModels(catalog).map((model) => model.id)).toEqual(['opencode::big-pickle']);
    expect(openCodeOwnModels(catalog, true).map((model) => model.id)).toEqual([
      'opencode::big-pickle',
      'opencode::gpt-5.4-mini',
    ]);
  });

  it('excludes OpenCode\'s own models when the built-in provider is not connected', () => {
    const catalog = {
      connected: ['nvidia'],
      all: [{
        id: 'opencode',
        name: 'OpenCode Zen',
        models: { 'big-pickle': { name: 'Big Pickle', cost: { input: 0, output: 0 } } },
      }],
    } as Catalog;

    expect(openCodeOwnModels(catalog)).toEqual([]);
  });

  it('maps the official Zen model catalog into selectable OpenCode models', () => {
    expect(openCodeZenModels({
      data: [
        { id: 'gpt-5.4-mini', object: 'model', owned_by: 'opencode' },
        { id: 'big-pickle', object: 'model', owned_by: 'opencode' },
        { id: 'north-mini-code-free', object: 'model', owned_by: 'opencode' },
      ],
    })).toMatchObject([
      { id: 'opencode::big-pickle', free: true, supports_tools: true },
      { id: 'opencode::north-mini-code-free', free: true, supports_tools: true },
      { id: 'opencode::gpt-5.4-mini', free: false, supports_tools: true },
    ]);
  });

  it('uses the authenticated Go API directly so Infinite OS tools reach the model', async () => {
    openCodeZenModels({ data: [{ id: 'go-chat', object: 'model', owned_by: 'opencode' }] }, 'go');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"Computer","arguments":"{\\"action\\":\\"desktop_state\\"}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));
    const request: ChatRequest = {
      model: 'opencode::go-chat',
      messages: chatRequest('inspect the desktop').messages,
      tools: [{ name: 'Computer', description: 'Control the computer', input_schema: { type: 'object' } }],
      stream: true,
    };
    const chunks: StreamChunk[] = [];
    for await (const chunk of opencode.streamChat(request, 'go-key')) chunks.push(chunk);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.tools[0].function.name).toBe('Computer');
    expect(chunks).toContainEqual({ type: 'tool_use_end', id: 'call-1', name: 'Computer', input: { action: 'desktop_state' } });
  });

  it('reassembles one tool call split across SSE chunks where only the first chunk carries the id', async () => {
    openCodeZenModels({ data: [{ id: 'go-chat', object: 'model', owned_by: 'opencode' }] }, 'go');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Real OpenAI-compatible streams: the id/name arrive in the first
        // chunk; arguments stream in later chunks that only carry `index`.
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc123","function":{"name":"Bash","arguments":""}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\"Get-ChildItem\\""}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));
    const request: ChatRequest = {
      model: 'opencode::go-chat',
      messages: chatRequest('run a command').messages,
      tools: [{ name: 'Bash', description: 'Run a command', input_schema: { type: 'object' } }],
      stream: true,
    };
    const chunks: StreamChunk[] = [];
    for await (const chunk of opencode.streamChat(request, 'go-key')) chunks.push(chunk);
    const ends = chunks.filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use_end' }> => chunk.type === 'tool_use_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual({ type: 'tool_use_end', id: 'call_abc123', name: 'Bash', input: { command: 'Get-ChildItem' } });
    expect(chunks.some((chunk) => chunk.type === 'tool_use_end' && chunk.name === '')).toBe(false);
  });

  it('keeps two parallel tool calls separate when both stream with only indices and shared deltas', async () => {
    openCodeZenModels({ data: [{ id: 'go-chat', object: 'model', owned_by: 'opencode' }] }, 'go');
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"Read","arguments":"{\\"file_path\\":\\"a.txt\\"}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_b","function":{"name":"Read","arguments":"{\\"file_path\\":\\"b.txt\\"}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));
    const request: ChatRequest = {
      model: 'opencode::go-chat',
      messages: chatRequest('read two files').messages,
      tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
      stream: true,
    };
    const chunks: StreamChunk[] = [];
    for await (const chunk of opencode.streamChat(request, 'go-key')) chunks.push(chunk);
    const ends = chunks.filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use_end' }> => chunk.type === 'tool_use_end');
    expect(ends.map((chunk) => chunk.id).sort()).toEqual(['call_a', 'call_b']);
  });

  it('validates a subscription key without requiring the local OpenCode CLI', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      // Go endpoint is not available for this key; Zen succeeds.
      if (url === 'https://opencode.ai/zen/go/v1/models') return new Response('', { status: 404 });
      if (url === 'https://opencode.ai/zen/v1/models') {
        return Response.json({ data: [{ id: 'chat', object: 'model', owned_by: 'opencode' }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(opencode.testConnection('zen-valid-test-key')).resolves.toEqual({ ok: true });
    await expect(opencode.testConnection('zen-valid-test-key')).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/models'))).toHaveLength(4);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/chat/completions'))).toBe(false);
  });

  it('reports credential rejection when the Zen model endpoint rejects the key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      // Go endpoint is not available for this key; Zen rejects the key.
      if (url === 'https://opencode.ai/zen/go/v1/models') return new Response('', { status: 404 });
      if (url === 'https://opencode.ai/zen/v1/models') return new Response('', { status: 401 });
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      if (url.endsWith('/auth/opencode-go')) return Response.json(true);
      if (url.endsWith('/auth/opencode')) return Response.json(true);
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await opencode.testConnection('zen-expired-test-key');
    expect(result).toEqual({
      ok: false,
      error: 'OpenCode Zen rejected this API key. Create a current key at opencode.ai/auth and try again.',
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/auth/opencode'))).toBe(false);
  });

  it('lists only paid Zen models for a Zen key (free-tier ids cannot serve keyed turns)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      // Go endpoint is not available for this key; Zen succeeds.
      if (url === 'https://opencode.ai/zen/go/v1/models') return new Response('', { status: 404 });
      if (url === 'https://opencode.ai/zen/v1/models') {
        return Response.json({
          data: [
            { id: 'big-pickle', object: 'model', owned_by: 'opencode' },
            { id: 'gpt-5.4-mini', object: 'model', owned_by: 'opencode' },
          ],
        });
      }
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      if (url.endsWith('/auth/opencode-go')) return Response.json(true);
      if (url.endsWith('/auth/opencode')) return Response.json(true);
      if (url.endsWith('/provider')) {
        return Response.json({
          connected: ['opencode', 'nvidia'],
          all: [
            { id: 'opencode', models: { 'big-pickle': { cost: { input: 0, output: 0 } } } },
            { id: 'nvidia', models: { 'vendor/wrong-model': { cost: { input: 0, output: 0 } } } },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(opencode.listModels('zen-valid-test-key')).resolves.toMatchObject([
      { id: 'opencode::gpt-5.4-mini', free: false },
    ]);
  });

  it('merges paid Go and Zen models when both endpoints accept the key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://opencode.ai/zen/go/v1/models') {
        return Response.json({ data: [{ id: 'go-model-pro', object: 'model', owned_by: 'opencode' }] });
      }
      if (url === 'https://opencode.ai/zen/v1/models') {
        return Response.json({ data: [{ id: 'zen-model-pro', object: 'model', owned_by: 'opencode' }] });
      }
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      if (url.endsWith('/auth/opencode-go')) return Response.json(true);
      if (url.endsWith('/auth/opencode')) return Response.json(true);
      if (url.endsWith('/provider')) {
        return Response.json({
          connected: ['opencode'],
          all: [
            { id: 'opencode', models: { 'go-model-free': { cost: { input: 0, output: 0 } }, 'zen-model-free': { cost: { input: 0, output: 0 } } } },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(opencode.listModels('go-zen-valid-test-key')).resolves.toMatchObject([
      { id: 'opencode::go-model-pro', free: false },
      { id: 'opencode::zen-model-pro', free: false },
    ]);
  });

  it('maps OpenCode tool events to telemetry without turning them into executable tool calls', () => {
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-1',
          sessionID: 'session-1',
          type: 'tool',
          tool: 'bash',
          callID: 'call-1',
          state: { status: 'running', title: 'Run tests', input: { command: 'pnpm test' } },
        },
      },
    }, 'session-1')).toEqual({
      type: 'provider_progress',
      id: 'call-1',
      name: 'bash',
      status: 'running',
      input: { command: 'pnpm test' },
      detail: 'Run tests',
    });
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { sessionID: 'different-session', type: 'tool' } },
    }, 'session-1')).toBeNull();
  });

  it('streams text parts live as text_delta chunks so the UI shows the answer as it is generated', () => {
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: {
        part: {
          id: 'part-text-1',
          sessionID: 'session-1',
          type: 'text',
          state: { text: 'Building the app' },
        },
      },
    }, 'session-1')).toEqual({ type: 'text_delta', text: 'Building the app' });
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { sessionID: 'other-session', type: 'text', state: { text: 'x' } } },
    }, 'session-1')).toBeNull();
  });

  it('reads flat part.text from opencode 1.17.20, dedupes re-publishes, and never streams user echoes', () => {
    const sid = 'session-live-probe';
    // Assistant turn starts.
    expect(openCodeProgressChunk({
      type: 'message.updated',
      properties: { sessionID: sid, info: { id: 'msg-assistant-1', role: 'assistant' } },
    }, sid)).toBeNull();
    // First publish of the assistant text part streams whole.
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { id: 'prt-live-1', messageID: 'msg-assistant-1', sessionID: sid, type: 'text', text: 'Hey ' } },
    }, sid)).toEqual({ type: 'text_delta', text: 'Hey ' });
    // Re-publish with more text streams only the suffix.
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { id: 'prt-live-1', messageID: 'msg-assistant-1', sessionID: sid, type: 'text', text: 'Hey Alex, working on it' } },
    }, sid)).toEqual({ type: 'text_delta', text: 'Alex, working on it' });
    // Identical re-publish streams nothing.
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { id: 'prt-live-1', messageID: 'msg-assistant-1', sessionID: sid, type: 'text', text: 'Hey Alex, working on it' } },
    }, sid)).toBeNull();
    // The user's own echoed text is never streamed into the answer.
    expect(openCodeProgressChunk({
      type: 'message.updated',
      properties: { sessionID: sid, info: { id: 'msg-user-9', role: 'user' } },
    }, sid)).toBeNull();
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { id: 'prt-user-9', messageID: 'msg-user-9', sessionID: sid, type: 'text', text: 'do the thing' } },
    }, sid)).toBeNull();
  });

  it('surfaces the real cause of a bare `fetch failed` error', () => {
    const error = describeOpenCodeFailure(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 4096, syscall: 'connect' } }),
      'http://127.0.0.1:4096',
    );
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).toContain('127.0.0.1:4096');
    expect(error.message).toContain('Is the OpenCode runtime running');
  });

  it('advises restarting the runtime on timeouts and passes other errors through', () => {
    expect(describeOpenCodeFailure(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }),
      'http://127.0.0.1:4096',
    ).message).toContain('did not respond in time');
    expect(describeOpenCodeFailure(new Error('boom'), 'target').message).toBe('boom');
  });

  it('lists free models from the local OpenCode server when no key is supplied', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      if (url.endsWith('/provider')) {
        return Response.json({
          connected: ['opencode'],
          all: [{ id: 'opencode', models: { 'chat-free': { name: 'Chat Free', cost: { input: 0, output: 0 } } } }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const models = await opencode.listModels('');
    expect(models.some((m) => m.id === 'opencode::chat-free')).toBe(true);
  });

  it('reports the server as unreachable when no key and no CLI', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 4096 },
      });
    });

    const result = await opencode.testConnection('');
    expect(result.ok).toBe(false);
  }, 30_000);
});

function chatRequest(text: string): ChatRequest {
  const message: Message = { id: 'm1', role: 'user', timestamp: Date.now(), content: [{ type: 'text', text }] };
  return { model: 'opencode::chat-free', messages: [message], stream: true };
}

function sseResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(line.endsWith('\n') ? line : `${line}\n`));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

describe('OpenCode cross-tier fallback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('routes to the other tier and remembers the winner', () => {
    expect(otherTier('zen')).toBe('go');
    expect(otherTier('go')).toBe('zen');
    expect(isTierRetryable('OpenCode zen API returned HTTP 401: bad key')).toBe(true);
    expect(isTierRetryable('model not found')).toBe(true);
    expect(isTierRetryable('HTTP 503 overloaded')).toBe(true);
    expect(isTierRetryable('Request cancelled.')).toBe(false);
    // First scan wins: Go scanned first keeps its tier over a later Zen scan.
    openCodeZenModels({ data: [{ id: 'tier-probe-x', object: 'model' }] }, 'go');
    openCodeZenModels({ data: [{ id: 'tier-probe-x', object: 'model' }] }, 'zen');
    expect(tierFor('opencode::tier-probe-x')).toBe('go');
    expect(tierFor('opencode::never-seen')).toBe('zen');
  });

  it('retries a rejected tier on the other tier and streams the answer', async () => {
    openCodeZenModels({ data: [{ id: 'tier-probe-y', object: 'model' }] }, 'zen');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://opencode.ai/zen/v1/chat/completions') return new Response('unauthorized', { status: 401 });
      if (url === 'https://opencode.ai/zen/go/v1/chat/completions') {
        return sseResponse([
          'data: {"choices":[{"delta":{"content":"hello-tier"}}]}',
          '',
          'data: [DONE]',
          '',
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const request: ChatRequest = { ...chatRequest('hi'), model: 'opencode::tier-probe-y' };
    const attempt = await tryRemote(request, 'test-key', 'zen');
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.error).toMatch(/401/);
    // Full entry point falls across tiers and remembers Go for next time.
    const chunks: StreamChunk[] = [];
    for await (const chunk of opencode.streamChat(request, 'test-key')) chunks.push(chunk);
    expect(chunks).toContainEqual({ type: 'text_delta', text: 'hello-tier' });
    expect(tierFor('opencode::tier-probe-y')).toBe('go');
  });

  it('surfaces the remote FreeTierError when a free model is attempted remotely', async () => {
    // Upstream policy (verified live): the Zen API 403s every free-tier turn
    // that does not come from the OpenCode client itself, so keyed free
    // models must run on the local runtime instead.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://opencode.ai/zen/v1/chat/completions') {
        return Response.json(
          { type: 'error', error: { type: 'FreeTierError', message: "OpenCode's free tier can only be used from within OpenCode" } },
          { status: 403 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const request: ChatRequest = { ...chatRequest('hi'), model: 'opencode::tier-probe-free' };
    const attempt = await tryRemote(request, 'test-key', 'zen');
    expect(attempt.ok).toBe(false);
    expect(attempt.ok === false && attempt.error).toMatch(/FreeTierError|free tier/i);
  });
});

describe('OpenCode retired-model fallback', () => {
  it('keeps an exact catalog match without switching', () => {
    const r = resolveLiveOpenCodeModel('opencode::chat-free', [{ id: 'opencode::chat-free' }]);
    expect(r).toEqual({ providerID: 'opencode', modelID: 'chat-free', switched: false, fallbackId: null });
  });

  it('falls back to a live opencode model when the selected id retired', () => {
    const r = resolveLiveOpenCodeModel('opencode::big-pickle', [{ id: 'opencode::chat-free' }]);
    expect(r.switched).toBe(true);
    expect(r.fallbackId).toBe('opencode::chat-free');
    expect(r.modelID).toBe('chat-free');
  });

  it('prefers free models when no opencode-subscription model exists', () => {
    const r = resolveLiveOpenCodeModel('opencode::big-pickle', [{ id: 'other::m', free: true }]);
    expect(r.switched).toBe(true);
    expect(r.fallbackId).toBe('other::m');
  });

  it('reports no-switch when the catalog is empty', () => {
    const r = resolveLiveOpenCodeModel('opencode::big-pickle', []);
    expect(r.switched).toBe(false);
    expect(r.fallbackId).toBe(null);
  });

  it('names the live CLI models when the selection is unavailable', () => {
    const err = openCodeUnavailableError('opencode::mimo-v2.5-free', [{ id: 'opencode::chat-free' }, { id: 'opencode::code' }]);
    expect(err).toMatch(/opencode::mimo-v2\.5-free/);
    expect(err).toMatch(/opencode::chat/);
    expect(err).toMatch(/fallback is OFF/);
  });
});

describe('OpenCode free-tier rotation', () => {
  afterEach(() => {
    setOpenCodeFirstByteTimeout(120_000);
    setLastGoodFreeModel(null);
  });

  it('prefers the most-recently-answering model over alphabetical order', () => {
    expect(orderFreeRotation('opencode::ling', ['opencode::big-pickle', 'opencode::muse'])).toEqual(
      ['opencode::big-pickle', 'opencode::muse']);
    setLastGoodFreeModel('opencode::muse');
    expect(orderFreeRotation('opencode::ling', ['opencode::big-pickle', 'opencode::muse'])).toEqual(
      ['opencode::muse', 'opencode::big-pickle']);
    // Never prefer the already-selected model.
    expect(orderFreeRotation('opencode::muse', ['opencode::big-pickle', 'opencode::muse'])).toEqual(
      ['opencode::big-pickle', 'opencode::muse']);
  });

});

describe('OpenCode abort and keep-alive', () => {
  afterEach(() => {
    setLastGoodFreeModel(null);
  });

  it('combines caller abort with a timeout without masking user cancel', async () => {
    const parent = new AbortController();
    const combined = timeoutSignal(parent.signal, 50);
    expect(combined.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(combined.aborted).toBe(true);
    expect(combined.reason?.name).toBe('TimeoutError');
    const stopper = new AbortController();
    stopper.abort(new Error('user stop'));
    const userFirst = timeoutSignal(stopper.signal, 10_000);
    expect(userFirst.aborted).toBe(true);
    expect((userFirst.reason as Error)?.message).toBe('user stop');
  });
});

describe('OpenCode free-tier version gate', () => {
  afterEach(() => {
    clearInvalidCliCredential();
    setOpenCodeStallTimeout(DEFAULT_STALL_TIMEOUT_MS);
  });
  it('compares semver numerically, not lexicographically', () => {
    expect(compareVersions('1.17.20', '1.18.0')).toBeLessThan(0);
    expect(compareVersions('1.18.0', '1.18.0')).toBe(0);
    expect(compareVersions('1.18.1', '1.18.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '1.18.0')).toBeGreaterThan(0);
  });

  it('gates the free tier on the minimum CLI version', () => {
    expect(isOpenCodeVersionAtLeast('1.17.20')).toBe(false);
    expect(isOpenCodeVersionAtLeast('1.18.0')).toBe(true);
    expect(isOpenCodeVersionAtLeast('1.19.2')).toBe(true);
    expect(isOpenCodeVersionAtLeast(null)).toBe(false);
    expect(isOpenCodeVersionAtLeast(undefined)).toBe(false);
    expect(OPENCODE_MIN_FREE_VERSION).toBe('1.18.0');
  });

  it('reports the installed CLI version without throwing when missing', async () => {
    const version = await getInstalledOpenCodeVersion();
    // CLI 1.17.20 is installed on this machine; elsewhere it may be absent.
    expect(version === null || /^\d+\.\d+\.\d+$/.test(version)).toBe(true);
  }, 20_000);

  it('produces an upgrade hint only for version-gate failures', () => {
    expect(openCodeUpgradeHint('OpenCode 1.18.0 or newer is required to use the free tier'))
      .toMatch(/npm i -g opencode-ai@latest/);
    expect(openCodeUpgradeHint('OpenCode message failed (HTTP 426): UpgradeRequired')).toMatch(/1\.18\.0/);
    expect(openCodeUpgradeHint('fetch failed: ECONNREFUSED')).toBeNull();
    expect(openCodeUpgradeHint('API error (401): bad key')).toBeNull();
  });

  it('prefixes errors with the upgrade hint when it applies', () => {
    expect(withUpgradeHint('1.18.0 or newer is required')).toMatch(/^OpenCode: .*npm i -g/);
    expect(withUpgradeHint('boom')).toBe('OpenCode: boom');
  });

  it('points at `opencode auth login` when the stored login is rejected upstream', () => {
    expect(openCodeAuthLoginHint('Upstream request failed: Invalid credential')).toMatch(/opencode auth login/);
    expect(openCodeAuthLoginHint('fetch failed: ECONNREFUSED')).toBeNull();
    expect(withOpenCodeHints('Upstream request failed: Invalid credential')).toMatch(/opencode auth login/);
    expect(withOpenCodeHints('boom')).toBe('OpenCode: boom');
  });

  it('paces still-working notices inside the stall window', () => {
    const interval = openCodeHeartbeatIntervalMs();
    expect(interval).toBeGreaterThanOrEqual(5_000);
    expect(interval).toBeLessThanOrEqual(30_000);
    expect(interval).toBeLessThanOrEqual(Math.max(5_000, DEFAULT_STALL_TIMEOUT_MS));
    expect(heartbeatDue(0, interval, interval)).toBe(true);
    expect(heartbeatDue(0, interval - 1, interval)).toBe(false);
  });

});

describe('OpenCode lean transcript (TUI-shaped payload)', () => {
  const msg = (role: 'user' | 'assistant', content: Message['content']): Message => ({
    id: `${role}-${Math.random()}`, role, content, timestamp: Date.now(),
  });

  it('stays small and text-only on heavy histories', () => {
    const huge = 'x'.repeat(50_000);
    const messages: Message[] = [
      msg('user', [{ type: 'text', text: 'do the thing' }]),
      msg('assistant', [{ type: 'tool_use', id: 't1', name: 'read', input: { path: '/a', extra: huge } }]),
      msg('user', [{ type: 'tool_result', tool_use_id: 't1', content: huge }]),
      msg('user', [{ type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'iVBOR'.repeat(5000) } }]),
      msg('user', [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'ok' }, { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'zz'.repeat(5000) } }] }]),
      msg('user', [{ type: 'text', text: `see data:image/png;base64,${'A'.repeat(2000)} done` }]),
    ];
    const text = transcript(messages);
    expect(text.length).toBeLessThanOrEqual(12_000);
    expect(text).not.toMatch(/iVBOR{3,}|A{500,}|x{2100,}/);
    expect(text).toMatch(/do the thing/);
    expect(text).toMatch(/image omitted|embedded data omitted|blob omitted/);
  });

  it('keeps recent task context within the budget', () => {
    const messages: Message[] = Array.from({ length: 30 }, (_, i) =>
      msg(i % 2 ? 'assistant' : 'user', [{ type: 'text', text: `message number ${i} with some task detail` }]));
    const text = transcript(messages);
    expect(text.length).toBeLessThanOrEqual(12_000);
    expect(text).toMatch(/message number 29/);
  });
});

describe('OpenCode keyless remake (free + Go via installed CLI)', () => {
  const keylessCatalog = {
    connected: ['opencode', 'opencode-go'],
    all: [
      {
        id: 'opencode',
        name: 'OpenCode Zen',
        models: {
          'big-pickle': { name: 'Big Pickle', cost: { input: 0, output: 0 } },
          'paid-zen': { name: 'Paid Zen', cost: { input: 1, output: 2 } },
        },
      },
      {
        id: 'opencode-go',
        name: 'OpenCode Go',
        models: {
          'go-model': { name: 'Go Model', cost: { input: 2, output: 5 } },
        },
      },
      {
        id: 'nvidia',
        name: 'NVIDIA',
        models: {
          'chat': { name: 'Chat', cost: { input: 0, output: 0 } },
        },
      },
    ],
  } as unknown as Catalog;

  it('includes free opencode, paid zen, and go models, never unrelated providers', () => {
    const ids = openCodeKeylessModels(keylessCatalog).map((m) => m.id);
    expect(ids).toContain('opencode::big-pickle');
    expect(ids).toContain('opencode::paid-zen');
    expect(ids).toContain('opencode-go::go-model');
    expect(ids.some((id) => id.startsWith('nvidia::'))).toBe(false);
  });

  it('keeps opencode-only helper for subscription-off filtering', () => {
    expect(openCodeOwnModels(keylessCatalog).map((m) => m.id)).toEqual(['opencode::big-pickle']);
  });

  it('preserves the go provider prefix when falling back', () => {
    const r = resolveLiveOpenCodeModel('opencode-go::missing', [{ id: 'opencode-go::go-model' }]);
    expect(r).toMatchObject({ providerID: 'opencode-go', modelID: 'go-model', switched: true, fallbackId: 'opencode-go::go-model' });
  });

  it('names free-tier exhaustion with a reset time and alternatives', () => {
    const next = Date.now() + 4 * 60_000;
    const out = openCodeQuietTurnTimeoutReasons({
      type: 'session.status',
      properties: { status: { type: 'retry', action: { reason: 'free_tier_limit' }, message: 'Free usage exceeded, subscribe to Go', next } },
    });
    expect(out.timedOut).toBe(true);
    expect(out.reason).toMatch(/resets in ~\d+ min/);
    expect(out.reason).toMatch(/nvidia/);
  });

  it('emits rate_limited status chunks for retry events so turns fail fast', () => {
    const chunk = openCodeProgressChunk({
      type: 'session.status',
      properties: { status: { type: 'retry', action: { reason: 'free_tier_limit' }, message: 'Free usage exceeded', next: Date.now() + 60_000 } },
    }, 'ses_x');
    expect(chunk).toMatchObject({ type: 'provider_status', status: 'rate_limited', provider: 'opencode' });
  });

  it('adds a funds hint for 402 paid-model failures', () => {
    expect(openCodeFundsHint('Upstream request failed: Insufficient account funds')).toMatch(/no funds/);
    expect(withOpenCodeHints('Upstream request failed: Insufficient account funds')).toMatch(/no funds/);
    expect(openCodeFundsHint('all good')).toBeNull();
  });
});
