import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from './base.js';
import { importSpec, invokeOperation, listSpecs, loadSpec, parseOpenApi } from './openapi.js';

let dir: string;
let ctx: ToolContext;

const spec = {
  openapi: '3.0.0',
  info: { title: 'Widgets', version: '1.2.3' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/widgets/{id}': {
      get: {
        operationId: 'getWidget',
        summary: 'Get one widget',
        parameters: [
          { name: 'id', in: 'path', required: true },
          { name: 'expand', in: 'query' },
        ],
      },
    },
    '/widgets': {
      post: {
        operationId: 'createWidget',
        summary: 'Create a widget',
        requestBody: { content: { 'application/json': {} } },
      },
    },
  },
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'infinite-openapi-'));
  process.env.INFINITE_TEST_HOME = dir;
  ctx = {
    sessionId: 'openapi-test',
    cwd: dir,
    abortSignal: new AbortController().signal,
    onUpdate: () => {},
  };
});

afterAll(() => {
  delete process.env.INFINITE_TEST_HOME;
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.unstubAllGlobals();
  rmSync(join(dir, 'api-connections'), { recursive: true, force: true });
});

describe('OpenAPI parsing', () => {
  it('indexes operations, path parameters, query parameters, and bodies', () => {
    const parsed = parseOpenApi(spec, 'inline');
    expect(parsed.title).toBe('Widgets');
    expect(parsed.version).toBe('1.2.3');
    expect(parsed.server).toBe('https://api.example.com/v1');
    expect(parsed.operations).toHaveLength(2);
    const get = parsed.operations.find((operation) => operation.operationId === 'getWidget');
    expect(get?.method).toBe('GET');
    expect(get?.parameters).toContainEqual({ name: 'id', in: 'path', required: true });
    const post = parsed.operations.find((operation) => operation.operationId === 'createWidget');
    expect(post?.hasBody).toBe(true);
  });

  it('rejects YAML, invalid JSON, and documents without paths', async () => {
    await expect(importSpec({ spec: 'openapi: 3.0.0' })).rejects.toThrow('YAML');
    await expect(importSpec({ spec: '{not json' })).rejects.toThrow('valid JSON');
    await expect(importSpec({ spec: JSON.stringify({ openapi: '3.0.0', paths: {} }) })).rejects.toThrow('no paths');
  });
});

describe('OpenAPI operations', () => {
  it('persists an imported spec and lists it', async () => {
    const stored = await importSpec({ spec: JSON.stringify(spec), name: 'Widget API' });
    expect(stored.id).toMatch(/^spec_/);
    expect(loadSpec(stored.id).operations).toHaveLength(2);
    const specs = listSpecs();
    expect(specs.some((item) => item.id === stored.id && item.operations === 2)).toBe(true);
  });

  it('substitutes path parameters, adds query parameters, and sends auth', async () => {
    const stored = await importSpec({ spec: JSON.stringify(spec) });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'w1', name: 'Widget' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeOperation(stored, {
      specId: stored.id,
      operationId: 'getWidget',
      params: { id: 'a b', expand: 'owner' },
      auth: { header: 'Authorization', value: 'Bearer token' },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.com/v1/widgets/a%20b?expand=owner');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(result.body).toContain('"name": "Widget"');
  });

  it('sends a JSON body for POST and reports HTTP errors without throwing', async () => {
    const stored = await importSpec({ spec: JSON.stringify(spec) });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 422 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await invokeOperation(stored, {
      specId: stored.id,
      operationId: 'createWidget',
      body: { name: 'New' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'New' }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('rejects a missing required path parameter and non-http servers', async () => {
    const stored = await importSpec({ spec: JSON.stringify(spec) });
    await expect(invokeOperation(stored, { specId: stored.id, operationId: 'getWidget', params: {} })).rejects.toThrow('Missing path parameter');
    await expect(invokeOperation(stored, { specId: stored.id, operationId: 'getWidget', params: { id: '1' }, baseUrl: 'file:///etc/passwd' })).rejects.toThrow('http(s)');
  });
});

describe('APIConnector OpenAPI actions', () => {
  it('imports, lists, and invokes through the tool', async () => {
    const { apiConnectorTool } = await import('./api-connector.js');
    const imported = await apiConnectorTool.execute({ action: 'import_openapi', spec: JSON.stringify(spec) }, ctx);
    expect(imported.is_error).toBeFalsy();
    const importedData = JSON.parse(imported.content as string);
    expect(importedData.specId).toMatch(/^spec_/);

    const operations = await apiConnectorTool.execute({ action: 'operations', specId: importedData.specId, query: 'create' }, ctx);
    const operationData = JSON.parse(operations.content as string);
    expect(operationData.operations).toHaveLength(1);
    expect(operationData.operations[0].operationId).toBe('createWidget');

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ created: true }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const invoked = await apiConnectorTool.execute({
      action: 'invoke',
      specId: importedData.specId,
      operationId: 'createWidget',
      body: { name: 'New' },
    }, ctx);
    expect(invoked.is_error).toBeFalsy();
    const invokedData = JSON.parse(invoked.content as string);
    expect(invokedData.status).toBe(201);
    expect(invokedData.operation.operationId).toBe('createWidget');
  });

  it('uses a saved connection for auth and a fallback base URL', async () => {
    const { apiConnectorTool } = await import('./api-connector.js');
    const noServer = { ...spec, servers: [] };
    const imported = await apiConnectorTool.execute({ action: 'import_openapi', spec: JSON.stringify(noServer) }, ctx);
    const specId = JSON.parse(imported.content as string).specId;

    mkdirSync(join(dir, 'api-connections'), { recursive: true });
    writeFileSync(join(dir, 'api-connections', 'connections.json'), JSON.stringify([{
      id: 'conn_test',
      providerId: 'openai',
      providerName: 'OpenAI',
      apiKey: 'sk-test-key',
      baseUrl: 'https://fallback.example.com',
      connectedAt: Date.now(),
      status: 'active',
      capabilities: ['chat'],
    }]));

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const invoked = await apiConnectorTool.execute({
      action: 'invoke',
      specId,
      connectionId: 'conn_test',
      operationId: 'getWidget',
      params: { id: '42' },
    }, ctx);
    expect(invoked.is_error).toBeFalsy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://fallback.example.com/widgets/42');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
  });
});
