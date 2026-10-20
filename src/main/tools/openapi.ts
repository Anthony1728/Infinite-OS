import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

/**
 * Rakazo-style bring-your-own API surface.
 *
 * The existing connector stores credentials for known providers. This module
 * adds the other half: import an OpenAPI document, inspect its operations, and
 * invoke one with the saved auth. It is deliberately JSON-only (the common
 * machine-readable form) and stores a compact operation index rather than the
 * entire document, so listing stays fast.
 */

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
}

export interface OpenApiOperation {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  parameters: OpenApiParameter[];
  hasBody: boolean;
}

export interface StoredSpec {
  id: string;
  title: string;
  version: string;
  server?: string;
  operations: OpenApiOperation[];
  importedAt: number;
  source: string;
}

export interface ImportSpecInput {
  spec?: string;
  specUrl?: string;
  name?: string;
  signal?: AbortSignal;
}

export interface InvokeInput {
  specId: string;
  operationId?: string;
  method?: string;
  path?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  baseUrl?: string;
  auth?: { header: string; value: string };
  timeoutMs?: number;
  signal?: AbortSignal;
}

const MAX_SPEC_BYTES = 5 * 1024 * 1024;
const MAX_OPERATIONS = 500;
const MAX_RESPONSE_CHARS = 100_000;
const SPEC_ID = /^spec_[a-z0-9_-]{4,80}$/;

function timeoutSignal(controller: AbortSignal, outer?: AbortSignal): AbortSignal {
  if (!outer) return controller;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([outer, controller]) : controller;
}

function specDir(): string {
  const dir = join(infiniteHome(), 'api-connections', 'openapi');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function specPath(id: string): string {
  if (!SPEC_ID.test(id)) throw new Error('Invalid spec id.');
  return join(specDir(), `${id}.json`);
}

function saveSpec(spec: StoredSpec): void {
  writeFileSync(specPath(spec.id), JSON.stringify(spec, null, 2));
}

export function loadSpec(id: string): StoredSpec {
  const path = specPath(id);
  if (!existsSync(path)) throw new Error(`OpenAPI spec not found: ${id}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredSpec;
  if (!parsed || parsed.id !== id || !Array.isArray(parsed.operations)) throw new Error(`OpenAPI spec is corrupt: ${id}`);
  return parsed;
}

export function listSpecs(): Array<Omit<StoredSpec, 'operations'> & { operations: number }> {
  return readdirSync(specDir())
    .filter((name) => name.endsWith('.json') && name.startsWith('spec_'))
    .map((name) => {
      try {
        const spec = JSON.parse(readFileSync(join(specDir(), name), 'utf8')) as StoredSpec;
        return { ...spec, operations: spec.operations.length };
      } catch { return null; }
    })
    .filter((spec): spec is Omit<StoredSpec, 'operations'> & { operations: number } => spec !== null)
    .sort((a, b) => b.importedAt - a.importedAt);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseParameters(pathLevel: unknown, operationLevel: unknown): OpenApiParameter[] {
  const result: OpenApiParameter[] = [];
  const seen = new Set<string>();
  for (const raw of [...(Array.isArray(pathLevel) ? pathLevel : []), ...(Array.isArray(operationLevel) ? operationLevel : [])]) {
    const param = asRecord(raw);
    const name = typeof param.name === 'string' ? param.name : '';
    const location = typeof param.in === 'string' ? param.in : '';
    if (!name || !['path', 'query', 'header', 'cookie'].includes(location)) continue;
    const key = `${location}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, in: location as OpenApiParameter['in'], required: param.required === true });
  }
  return result;
}

function extractServer(document: Record<string, unknown>): string | undefined {
  const servers = Array.isArray(document.servers) ? document.servers : [];
  const first = asRecord(servers[0]);
  if (typeof first.url === 'string') return first.url;
  const host = typeof document.host === 'string' ? document.host : '';
  if (!host) return undefined;
  const schemes = Array.isArray(document.schemes) ? document.schemes : [];
  const scheme = typeof schemes[0] === 'string' ? schemes[0] : 'https';
  const basePath = typeof document.basePath === 'string' ? document.basePath : '';
  return `${scheme}://${host}${basePath}`;
}

export function parseOpenApi(document: unknown, source: string): StoredSpec {
  const root = asRecord(document);
  if (!root.openapi && !root.swagger) throw new Error('Not an OpenAPI document (missing openapi/swagger field).');
  const paths = asRecord(root.paths);
  if (Object.keys(paths).length === 0) throw new Error('OpenAPI document has no paths.');
  const operations: OpenApiOperation[] = [];
  for (const [path, rawPath] of Object.entries(paths)) {
    if (operations.length >= MAX_OPERATIONS) break;
    if (!path.startsWith('/')) continue;
    const pathItem = asRecord(rawPath);
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      if (operations.length >= MAX_OPERATIONS) break;
      const operation = asRecord(pathItem[method]);
      if (!operation || Object.keys(operation).length === 0) continue;
      const body = operation.requestBody !== undefined;
      operations.push({
        method: method.toUpperCase(),
        path,
        ...(typeof operation.operationId === 'string' ? { operationId: operation.operationId } : {}),
        ...(typeof operation.summary === 'string' ? { summary: operation.summary.slice(0, 300) } : {}),
        parameters: parseParameters(pathItem.parameters, operation.parameters),
        hasBody: body,
      });
    }
  }
  if (operations.length === 0) throw new Error('OpenAPI document has no supported operations.');
  const info = asRecord(root.info);
  return {
    id: `spec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: typeof info.title === 'string' ? info.title.slice(0, 200) : 'Untitled API',
    version: typeof info.version === 'string' ? info.version.slice(0, 80) : 'unknown',
    ...(extractServer(root) ? { server: extractServer(root) } : {}),
    operations,
    importedAt: Date.now(),
    source,
  };
}

export async function importSpec(input: ImportSpecInput): Promise<StoredSpec> {
  let text: string;
  let source: string;
  if (input.spec?.trim()) {
    text = input.spec.trim();
    source = input.name?.trim() || 'inline JSON';
  } else if (input.specUrl?.trim()) {
    const url = input.specUrl.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('specUrl must be http(s).');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { signal: timeoutSignal(controller.signal, input.signal), redirect: 'follow' });
      if (!response.ok) throw new Error(`Spec download failed: ${response.status} ${response.statusText}`);
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_SPEC_BYTES) throw new Error('OpenAPI document is larger than 5 MB.');
      text = await response.text();
      if (text.length > MAX_SPEC_BYTES) throw new Error('OpenAPI document is larger than 5 MB.');
      source = input.name?.trim() || url;
    } finally { clearTimeout(timer); }
  } else {
    throw new Error('spec (JSON text) or specUrl is required.');
  }
  if (/^\s*(openapi|swagger)\s*:/i.test(text)) {
    throw new Error('YAML specs are not supported yet. Paste the JSON version (most registries expose one).');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('OpenAPI document is not valid JSON.'); }
  const spec = parseOpenApi(parsed, source);
  saveSpec(spec);
  return spec;
}

export function findOperation(spec: StoredSpec, input: Pick<InvokeInput, 'operationId' | 'method' | 'path'>): OpenApiOperation {
  if (input.operationId) {
    const found = spec.operations.find((operation) => operation.operationId === input.operationId);
    if (!found) throw new Error(`Operation not found: ${input.operationId}`);
    return found;
  }
  if (!input.method || !input.path) throw new Error('operationId or method + path is required.');
  const method = input.method.toUpperCase();
  const found = spec.operations.find((operation) => operation.method === method && operation.path === input.path);
  if (!found) throw new Error(`Operation not found: ${method} ${input.path}`);
  return found;
}

function buildUrl(spec: StoredSpec, operation: OpenApiOperation, input: InvokeInput): URL {
  const rawBase = input.baseUrl?.trim() || spec.server?.trim();
  if (!rawBase) throw new Error('This spec has no server URL. Pass baseUrl explicitly.');
  let base: URL;
  try { base = new URL(rawBase); } catch { throw new Error('Server URL is not absolute http(s). Pass baseUrl explicitly.'); }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Only http(s) API calls are supported.');
  const params = input.params ?? {};
  const path = operation.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') {
      const required = operation.parameters.some((param) => param.in === 'path' && param.name === name);
      if (required) throw new Error(`Missing path parameter: ${name}`);
      return '';
    }
    return encodeURIComponent(String(value));
  });
  const url = new URL(path.replace(/^\//, ''), base.href.endsWith('/') ? base.href : `${base.href}/`);
  for (const [key, value] of Object.entries(params)) {
    if (operation.parameters.some((param) => param.in === 'path' && param.name === key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else if (typeof value === 'object') {
      url.searchParams.set(key, JSON.stringify(value));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

export async function invokeOperation(spec: StoredSpec, input: InvokeInput): Promise<{
  status: number;
  ok: boolean;
  url: string;
  body: string;
  truncated: boolean;
}> {
  const operation = findOperation(spec, input);
  const url = buildUrl(spec, operation, input);
  const headers: Record<string, string> = { Accept: 'application/json', ...(input.headers ?? {}) };
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(key) || /[\r\n]/.test(value)) throw new Error(`Invalid header: ${key}`);
    headers[key] = value;
  }
  if (input.auth) headers[input.auth.header] = input.auth.value;
  let body: string | undefined;
  if (input.body !== undefined && operation.method !== 'GET' && operation.method !== 'HEAD') {
    body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
    if (!headers['Content-Type'] && !headers['content-type']) headers['Content-Type'] = 'application/json';
  }
  const timeoutMs = Math.max(1_000, Math.min(120_000, input.timeoutMs ?? 30_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: operation.method, headers, ...(body !== undefined ? { body } : {}), signal: timeoutSignal(controller.signal, input.signal) });
    const text = await response.text();
    const truncated = text.length > MAX_RESPONSE_CHARS;
    let rendered = text.slice(0, MAX_RESPONSE_CHARS);
    try { rendered = JSON.stringify(JSON.parse(rendered), null, 2); } catch { /* keep text */ }
    return { status: response.status, ok: response.ok, url: url.toString(), body: rendered, truncated };
  } finally { clearTimeout(timer); }
}
