// API Tester Tool — full HTTP client for testing REST, GraphQL, WebSocket APIs
import type { Tool, ToolContext, ToolResult } from './base.js';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';

interface APITestArgs {
  action: 'request' | 'batch' | 'history' | 'save' | 'load';
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  query?: Record<string, string>;
  auth?: {
    type: 'bearer' | 'basic' | 'api-key' | 'oauth2';
    token?: string;
    username?: string;
    password?: string;
    apiKey?: string;
    apiKeyHeader?: string;
  };
  timeout?: number;
  followRedirects?: boolean;
  name?: string;
  requests?: APITestArgs[];
  profile?: string;
}

interface RequestHistory {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  name?: string;
}

const history: RequestHistory[] = [];
const profiles: Map<string, { headers: Record<string, string>; auth?: APITestArgs['auth'] }> = new Map();

function makeRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string,
  timeout = 30000,
  followRedirects = true,
): Promise<{ status: number; headers: Record<string, string>; body: string; duration: number }> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const parsedUrl = new URL(url);

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      timeout,
    };

    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const duration = Date.now() - startTime;
        const responseBody = Buffer.concat(chunks).toString('utf-8');

        // Handle redirects
        if (followRedirects && [301, 302, 303, 307, 308].includes(res.statusCode || 0) && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          makeRequest(method, redirectUrl, headers, body, timeout, followRedirects).then(resolve).catch(reject);
          return;
        }

        resolve({
          status: res.statusCode || 0,
          headers: res.headers as Record<string, string>,
          body: responseBody,
          duration,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout}ms`));
    });

    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }

    req.end();
  });
}

function formatResponse(res: { status: number; headers: Record<string, string>; body: string; duration: number }): string {
  const lines: string[] = [];
  lines.push(`Status: ${res.status} (${res.duration}ms)`);
  lines.push('');

  // Response headers
  const importantHeaders = ['content-type', 'cache-control', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'set-cookie'];
  const hdrLines = importantHeaders
    .filter((h) => res.headers[h])
    .map((h) => `  ${h}: ${res.headers[h]}`);
  if (hdrLines.length > 0) {
    lines.push('Response Headers:');
    lines.push(...hdrLines);
    lines.push('');
  }

  // Response body
  let body = res.body;
  try {
    const parsed = JSON.parse(body);
    body = JSON.stringify(parsed, null, 2);
  } catch {
    // Keep as-is
  }

  // Truncate if too long
  if (body.length > 5000) {
    body = body.substring(0, 5000) + `\n... (${res.body.length} total characters)`;
  }

  lines.push('Response Body:');
  lines.push(body);

  return lines.join('\n');
}

export const apiTesterTool: Tool = {
  name: 'APITester',
  description:
    'Full HTTP client for testing APIs: make GET/POST/PUT/PATCH/DELETE requests, set headers and auth (Bearer, Basic, API Key), send JSON/form body, follow redirects, view response status/headers/body. Supports batch requests and request history.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['request', 'batch', 'history', 'save', 'load'],
        description: 'API test action',
      },
      method: {
        type: 'string',
        enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
        description: 'HTTP method (default GET)',
      },
      url: { type: 'string', description: 'Request URL' },
      headers: {
        type: 'object',
        description: 'Request headers',
        additionalProperties: { type: 'string' },
      },
      body: {
        oneOf: [
          { type: 'string' },
          { type: 'object' },
        ],
        description: 'Request body (string or JSON object)',
      },
      query: {
        type: 'object',
        description: 'Query parameters',
        additionalProperties: { type: 'string' },
      },
      auth: {
        type: 'object',
        description: 'Authentication configuration',
        properties: {
          type: { type: 'string', enum: ['bearer', 'basic', 'api-key', 'oauth2'] },
          token: { type: 'string', description: 'Bearer token' },
          username: { type: 'string', description: 'Basic auth username' },
          password: { type: 'string', description: 'Basic auth password' },
          apiKey: { type: 'string', description: 'API key value' },
          apiKeyHeader: { type: 'string', description: 'API key header name (default X-API-Key)' },
        },
      },
      timeout: { type: 'number', description: 'Request timeout in ms (default 30000)' },
      followRedirects: { type: 'boolean', description: 'Follow redirects (default true)' },
      name: { type: 'string', description: 'Name for this request (for history)' },
      requests: {
        type: 'array',
        description: 'Batch requests',
        items: { type: 'object' },
      },
      profile: { type: 'string', description: 'Saved profile name to load' },
    },
    required: ['action'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const a = args as APITestArgs;

    try {
      switch (a.action) {
        case 'request': {
          if (!a.url) return { content: 'URL is required', is_error: true };

          const headers: Record<string, string> = { ...a.headers };

          // Apply query parameters
          let fullUrl = a.url;
          if (a.query) {
            const urlObj = new URL(a.url);
            for (const [key, val] of Object.entries(a.query)) {
              urlObj.searchParams.set(key, val);
            }
            fullUrl = urlObj.toString();
          }

          // Apply auth
          if (a.auth) {
            switch (a.auth.type) {
              case 'bearer':
                if (a.auth.token) headers['Authorization'] = `Bearer ${a.auth.token}`;
                break;
              case 'basic':
                if (a.auth.username) {
                  const encoded = Buffer.from(`${a.auth.username}:${a.auth.password || ''}`).toString('base64');
                  headers['Authorization'] = `Basic ${encoded}`;
                }
                break;
              case 'api-key':
                if (a.auth.apiKey) {
                  headers[a.auth.apiKeyHeader || 'X-API-Key'] = a.auth.apiKey;
                }
                break;
            }
          }

          // Set content type for body
          if (a.body && !headers['Content-Type']) {
            headers['Content-Type'] = typeof a.body === 'string' ? 'application/json' : 'application/json';
          }

          const method = a.method || 'GET';
          const bodyStr = a.body ? (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)) : undefined;

          const res = await makeRequest(method, fullUrl, headers, bodyStr, a.timeout || 30000, a.followRedirects !== false);

          // Record history
          const record: RequestHistory = {
            id: randomUUID().slice(0, 8),
            timestamp: new Date().toISOString(),
            method,
            url: fullUrl,
            status: res.status,
            duration: res.duration,
            name: a.name,
          };
          history.unshift(record);
          if (history.length > 50) history.pop();

          return {
            content: [
              `=== API Request: ${a.name || method + ' ' + fullUrl} ===`,
              `Method: ${method}`,
              `URL: ${fullUrl}`,
              `Duration: ${res.duration}ms`,
              '',
              formatResponse(res),
            ].join('\n'),
          };
        }

        case 'batch': {
          if (!a.requests || a.requests.length === 0) return { content: 'No requests in batch', is_error: true };

          const results = await Promise.allSettled(
            a.requests.map(async (req) => {
              const headers: Record<string, string> = { ...req.headers };
              if (req.auth?.type === 'bearer' && req.auth.token) {
                headers['Authorization'] = `Bearer ${req.auth.token}`;
              }
              const method = req.method || 'GET';
              const bodyStr = req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined;
              const res = await makeRequest(method, req.url, headers, bodyStr, req.timeout || 30000, true);
              return { ...res, method, url: req.url, name: req.name };
            }),
          );

          const lines = ['=== Batch Results ===', ''];
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
              lines.push(`[${i + 1}] ${r.value.method} ${r.value.url} -> ${r.value.status} (${r.value.duration}ms)${r.value.name ? ` [${r.value.name}]` : ''}`);
            } else {
              lines.push(`[${i + 1}] Error: ${r.reason}`);
            }
          });

          return { content: lines.join('\n') };
        }

        case 'history': {
          if (history.length === 0) return { content: 'No request history' };
          const lines = ['=== Request History ===', ''];
          history.slice(0, 20).forEach((h) => {
            lines.push(`${h.timestamp}  ${h.method}  ${h.url}  -> ${h.status || 'ERR'} (${h.duration || 0}ms)${h.name ? `  [${h.name}]` : ''}`);
          });
          return { content: lines.join('\n') };
        }

        case 'save': {
          if (!a.name || !a.url) return { content: 'Name and URL required to save profile', is_error: true };
          profiles.set(a.name, { headers: a.headers || {}, auth: a.auth });
          return { content: `Profile saved: ${a.name}` };
        }

        case 'load': {
          if (!a.profile) return { content: 'Profile name required', is_error: true };
          const profile = profiles.get(a.profile);
          if (!profile) return { content: `Profile not found: ${a.profile}`, is_error: true };
          return {
            content: `Profile loaded: ${a.profile}\nHeaders: ${JSON.stringify(profile.headers, null, 2)}\nAuth: ${profile.auth ? JSON.stringify(profile.auth) : 'None'}`,
          };
        }

        default:
          return { content: `Unknown action: ${a.action}`, is_error: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `API request failed: ${msg}`, is_error: true };
    }
  },
};
