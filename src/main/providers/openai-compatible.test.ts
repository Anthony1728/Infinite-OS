import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, StreamChunk } from './base.js';
import { openaiCompatible } from './openai-compatible.js';

describe('OpenAI-compatible long-running streams', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not cancel a valid stream merely because it crosses 30 minutes', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    let push: ((chunk: Uint8Array) => void) | undefined;
    let close: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
        close = () => controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status: 200 }));

    const adapter = openaiCompatible({
      id: 'test-provider',
      label: 'Test Provider',
      defaultBaseUrl: 'https://example.test/v1',
      defaultModel: 'test-model',
      freeModels: [{ id: 'test-model', label: 'Test', provider: 'test-provider', free: true, supports_tools: true }],
    });
    const request: ChatRequest = {
      model: 'test-model',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'continue' }], timestamp: Date.now() }],
      stream: true,
    };

    const chunksPromise = collect(adapter.streamChat(request, 'test-key'));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1_000);
    push?.(encoder.encode('data: {"choices":[{"delta":{"content":"still working"}}]}\n\n'));
    push?.(encoder.encode('data: [DONE]\n\n'));
    close?.();

    const chunks = await chunksPromise;
    expect(chunks.some((chunk) => chunk.type === 'text_delta' && chunk.text === 'still working')).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'error' && /30 minutes|timeout/i.test(chunk.error))).toBe(false);
  });

  it('reassembles a tool call whose id arrives only in the first SSE chunk', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Bash","arguments":""}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\"dir\\""}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 200 }));

    const adapter = openaiCompatible({
      id: 'test-provider',
      label: 'Test Provider',
      defaultBaseUrl: 'https://example.test/v1',
      defaultModel: 'test-model',
      freeModels: [{ id: 'test-model', label: 'Test', provider: 'test-provider', free: true, supports_tools: true }],
    });
    const request: ChatRequest = {
      model: 'test-model',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'run a command' }], timestamp: Date.now() }],
      tools: [{ name: 'Bash', description: 'Run a command', input_schema: { type: 'object' } }],
      stream: true,
    };

    const chunks = await collect(adapter.streamChat(request, 'test-key'));
    const ends = chunks.filter((chunk): chunk is Extract<StreamChunk, { type: 'tool_use_end' }> => chunk.type === 'tool_use_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual({ type: 'tool_use_end', id: 'call_1', name: 'Bash', input: { command: 'dir' } });
  });
});

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('gateway catalogs and credit recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function gatewayAdapter() {
    return openaiCompatible({
      id: 'test-gateway',
      label: 'Test Gateway',
      defaultBaseUrl: 'https://example.test/v1',
      defaultModel: 'model-a',
      freeModels: [{ id: 'model-a', label: 'A', provider: 'test-gateway', free: true, supports_tools: true }],
      gatewayCatalog: true,
    });
  }

  it('marks priceless live catalog entries as usable (free section)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'model-z', name: 'Zed' }] }), { status: 200 }),
    );
    const models = await gatewayAdapter().listModels('k');
    expect(models.some((m) => m.id === 'model-z' && m.free)).toBe(true);
  });

  it('still honors explicit pricing when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'model-p', pricing: { prompt: 1, completion: 2 } }] }),
        { status: 200 },
      ),
    );
    const models = await gatewayAdapter().listModels('k');
    expect(models.find((m) => m.id === 'model-p')?.free).toBe(false);
  });

  it('switches to the free fallback on insufficient credits for any provider', async () => {
    const encoder = new TextEncoder();
    const okStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"recovered"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('insufficient credits', { status: 402 }))
      .mockResolvedValueOnce(new Response(okStream, { status: 200 }));
    const request: ChatRequest = {
      model: 'model-paid',
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: Date.now() }],
      stream: true,
    };
    const chunks = await collect(gatewayAdapter().streamChat(request, 'k'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks.some((c) => c.type === 'text_delta' && c.text === 'recovered')).toBe(true);
  });
});
