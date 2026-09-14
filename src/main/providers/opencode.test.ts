import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { availableOpenCodeModels, describeOpenCodeFailure, freeOpenCodeModels, isTierRetryable, openCodeOwnModels, openCodeProgressChunk, openCodeUnavailableError, openCodeZenModels, opencode, otherTier, resolveLiveOpenCodeModel, setOpenCodeStallTimeout, tierFor, tryRemote, OPENCODE_STALL_TIMEOUT_MS } from './opencode.js';
import type { ChatRequest, StreamChunk } from './base.js';
import type { Message } from '../../shared/types.js';

type Catalog = Parameters<typeof freeOpenCodeModels>[0];

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

  it('shows only Zen models when a Zen key is supplied', async () => {
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
      { id: 'opencode::big-pickle' },
      { id: 'opencode::gpt-5.4-mini' },
    ]);
  });

  it('merges Go and Zen models when both endpoints accept the key', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://opencode.ai/zen/go/v1/models') {
        return Response.json({ data: [{ id: 'go-model-free', object: 'model', owned_by: 'opencode' }] });
      }
      if (url === 'https://opencode.ai/zen/v1/models') {
        return Response.json({ data: [{ id: 'zen-model-free', object: 'model', owned_by: 'opencode' }] });
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
      { id: 'opencode::go-model-free', free: true },
      { id: 'opencode::zen-model-free', free: true },
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
      properties: { part: { id: 'prt-live-1', messageID: 'msg-assistant-1', sessionID: sid, type: 'text', text: 'Hey Anthony, working on it' } },
    }, sid)).toEqual({ type: 'text_delta', text: 'Anthony, working on it' });
    // Identical re-publish streams nothing.
    expect(openCodeProgressChunk({
      type: 'message.part.updated',
      properties: { part: { id: 'prt-live-1', messageID: 'msg-assistant-1', sessionID: sid, type: 'text', text: 'Hey Anthony, working on it' } },
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

  it('retries transient transport failures before surfacing them', async () => {
    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      if (url.endsWith('/provider')) {
        providerCalls++;
        if (providerCalls === 1) {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 4096 },
          });
        }
        return Response.json({
          connected: ['opencode'],
          all: [{ id: 'opencode', models: { chat: { name: 'Chat', cost: { input: 0, output: 0 } } } }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(opencode.listModels('')).resolves.toHaveLength(1);
    expect(providerCalls).toBe(2);
  });

  it('reports the underlying cause once retries are exhausted', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/global/health')) return Response.json({ healthy: true });
      throw Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED', address: '127.0.0.1', port: 4096, syscall: 'connect' },
      });
    });

    const result = await opencode.testConnection('');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
    expect(result.error).toContain('127.0.0.1:4096');
    expect(result.error).toContain('Is the OpenCode runtime running');
  });
});

// ---------------------------------------------------------------------------
// Stall watchdog — a wedged runtime must never hang the turn for hours.
// A real local HTTP server stands in for the opencode runtime.
// ---------------------------------------------------------------------------

type MessageMode = 'hold' | 'slow' | 'instant' | 'delayed';
type SseMode = 'none' | 'heartbeats' | 'data';

interface MockRuntime {
  server: Server;
  port: number;
  sessionCreations: () => number;
  messageRequests: () => number;
}

function startMockRuntime(messageMode: MessageMode, sseMode: SseMode = 'none'): MockRuntime {
  let sessions = 0;
  let messages = 0;
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url.endsWith('/global/health')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ healthy: true }));
      return;
    }
    if (url.endsWith('/provider')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        connected: ['opencode'],
        all: [{ id: 'opencode', models: { chat: { name: 'Chat', cost: { input: 0, output: 0 } } } }],
      }));
      return;
    }
    if (url.includes('/message') && req.method === 'POST') {
      messages++;
      if (messageMode === 'hold') {
        // Never send headers: the runtime appears to be thinking forever.
        return;
      }
      const body = JSON.stringify({
        info: { tokens: { input: 1, output: 1 } },
        parts: [{ type: 'text', text: 'hello world' }],
      });
      if (messageMode === 'delayed') {
        // Headers + body arrive after a delay; the turn completes eventually.
        const timer = setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(body);
        }, 600);
        res.on('close', () => clearTimeout(timer));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (messageMode === 'slow') {
        // Stream the body in dribbles: alive, but slower than the stall window.
        let sent = 0;
        const timer = setInterval(() => {
          const chunk = body.slice(sent, sent + 6);
          if (!chunk) {
            clearInterval(timer);
            res.end();
            return;
          }
          res.write(chunk);
          sent += 6;
        }, 150);
      } else {
        res.end(body);
      }
      return;
    }
    if (url.startsWith('/event')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (sseMode !== 'none') {
        const timer = setInterval(() => {
          if (res.destroyed) {
            clearInterval(timer);
            return;
          }
          if (sseMode === 'heartbeats') {
            res.write(': ping\n\n');
          } else {
            res.write('data: {"type":"message.part.updated","properties":{"part":{"sessionID":"x","type":"tool","state":{"status":"running"}}}}\n\n');
          }
        }, 100);
        res.on('close', () => clearInterval(timer));
      }
      return;
    }
    if (url.startsWith('/session') && req.method === 'POST') {
      sessions++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `sess-${sessions}` }));
      return;
    }
    if (url.startsWith('/session/') && req.method === 'DELETE') {
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return {
    server,
    port: 0,
    sessionCreations: () => sessions,
    messageRequests: () => messages,
  };
}

function chatRequest(text: string): ChatRequest {
  const message: Message = { id: 'm1', role: 'user', timestamp: Date.now(), content: [{ type: 'text', text }] };
  return { model: 'opencode::chat', messages: [message], stream: true };
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

  it('sends free-tier models with a key to the remote API without touching the local server', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1:4096')) throw new Error(`Local server must not be contacted: ${url}`);
      if (url === 'https://opencode.ai/zen/v1/chat/completions') {
        return sseResponse(['data: {"choices":[{"delta":{"content":"free-remote-ok"}}]}', '', 'data: [DONE]', '']);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const request: ChatRequest = { ...chatRequest('hi'), model: 'opencode::mimo-v2.5-free' };
    const chunks: StreamChunk[] = [];
    for await (const chunk of opencode.streamChat(request, 'test-key')) chunks.push(chunk);
    expect(chunks).toContainEqual({ type: 'text_delta', text: 'free-remote-ok' });
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });
});

async function collect(url: string, req: ChatRequest): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of opencode.streamChat(req, '', url)) chunks.push(chunk);
  return chunks;
}

describe('OpenCode stall watchdog', () => {
  let runtime: ReturnType<typeof startMockRuntime>;

  afterEach(() => {
    setOpenCodeStallTimeout(OPENCODE_STALL_TIMEOUT_MS);
    runtime.server.closeAllConnections();
    runtime.server.close();
  });

  it('breaks a totally silent (wedged) runtime after the stall window and retries with fresh sessions', { timeout: 15_000 }, async () => {
    setOpenCodeStallTimeout(400);
    runtime = startMockRuntime('hold');
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    const port = (runtime.server.address() as AddressInfo).port;

    const chunks = await collect(`http://127.0.0.1:${port}`, chatRequest('please finish this task'));
    const errors = chunks.filter((c): c is { type: 'error'; error: string } => c.type === 'error');
    const retries = chunks.filter((c) => c.type === 'provider_status');

    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain('stopped responding');
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(runtime.sessionCreations()).toBe(5);
    expect(runtime.messageRequests()).toBe(5);
  });

  it('does not stall a slow-but-alive run: activity resets the watchdog', { timeout: 15_000 }, async () => {
    setOpenCodeStallTimeout(1_000);
    runtime = startMockRuntime('slow');
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    const port = (runtime.server.address() as AddressInfo).port;

    const chunks = await collect(`http://127.0.0.1:${port}`, chatRequest('take your time'));
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks.some((c) => c.type === 'message_end')).toBe(true);
    expect(chunks.some((c) => c.type === 'text_delta' && c.text === 'hello world')).toBe(true);
    expect(runtime.sessionCreations()).toBe(1);
  });

  it('does not count SSE heartbeat comments as activity: keepalives cannot hide a wedge', { timeout: 15_000 }, async () => {
    setOpenCodeStallTimeout(400);
    runtime = startMockRuntime('hold', 'heartbeats');
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    const port = (runtime.server.address() as AddressInfo).port;

    const chunks = await collect(`http://127.0.0.1:${port}`, chatRequest('keep going'));
    const errors = chunks.filter((c): c is { type: 'error'; error: string } => c.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain('stopped responding');
    expect(runtime.sessionCreations()).toBe(5);
  });

  it('counts SSE data events as activity: a working runtime is never stalled', { timeout: 15_000 }, async () => {
    setOpenCodeStallTimeout(1_000);
    runtime = startMockRuntime('delayed', 'data');
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    const port = (runtime.server.address() as AddressInfo).port;

    // The message completes 600ms in, while data events arrive every 100ms;
    // the 400ms stall window must never fire despite the late response.
    const chunks = await collect(`http://127.0.0.1:${port}`, chatRequest('work steadily'));
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks.some((c) => c.type === 'message_end')).toBe(true);
    expect(runtime.sessionCreations()).toBe(1);
  });

  it('completes immediately for a healthy runtime', async () => {
    runtime = startMockRuntime('instant');
    await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
    const port = (runtime.server.address() as AddressInfo).port;

    const chunks = await collect(`http://127.0.0.1:${port}`, chatRequest('hi'));
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
    expect(chunks.some((c) => c.type === 'message_end')).toBe(true);
    expect(runtime.sessionCreations()).toBe(1);
  });
});

describe('OpenCode retired-model fallback', () => {
  it('keeps an exact catalog match without switching', () => {
    const r = resolveLiveOpenCodeModel('opencode::chat', [{ id: 'opencode::chat' }]);
    expect(r).toEqual({ providerID: 'opencode', modelID: 'chat', switched: false, fallbackId: null });
  });

  it('falls back to a live opencode model when the selected id retired', () => {
    const r = resolveLiveOpenCodeModel('opencode::big-pickle', [{ id: 'opencode::chat' }]);
    expect(r.switched).toBe(true);
    expect(r.fallbackId).toBe('opencode::chat');
    expect(r.modelID).toBe('chat');
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
    const err = openCodeUnavailableError('opencode::mimo-v2.5-free', [{ id: 'opencode::chat' }, { id: 'opencode::code' }]);
    expect(err).toMatch(/opencode::mimo-v2\.5-free/);
    expect(err).toMatch(/opencode::chat/);
    expect(err).toMatch(/fallback is OFF/);
  });

  it('switches models mid-stream instead of failing the turn', async () => {
    // Mock catalog offers only `chat`; requesting retired `big-pickle` must
    // yield a failover notice and still complete the turn.
    const rt = startMockRuntime('instant');
    await new Promise<void>((resolve) => rt.server.listen(0, '127.0.0.1', resolve));
    const port = (rt.server.address() as AddressInfo).port;
    try {
      const chunks = await collect(`http://127.0.0.1:${port}`, { ...chatRequest('hi'), model: 'opencode::big-pickle' });
      const failover = chunks.find((c) => c.type === 'provider_status' && (c as { status?: string }).status === 'failover');
      expect(failover).toBeTruthy();
      expect(chunks.some((c) => c.type === 'message_end')).toBe(true);
      expect(chunks.some((c) => c.type === 'error')).toBe(false);
      expect(rt.sessionCreations()).toBe(1);
    } finally {
      rt.server.closeAllConnections();
      rt.server.close();
    }
  });
});
