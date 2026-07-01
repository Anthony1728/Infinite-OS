import type { Tool, ToolResult } from './base.js';

export const webfetch: Tool = {
  name: 'WebFetch',
  description: 'Fetch a web page and return its content as text. Supports HTML, JSON, and plain text.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch (must be http or https)' },
    },
    required: ['url'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const { url } = args as { url: string };
    try {
      // Validate URL
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { content: `Invalid URL: ${url}`, is_error: true };
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { content: `Only http/https URLs are allowed. Got: ${parsed.protocol}`, is_error: true };
      }
      // Block localhost/private IPs
      const host = parsed.hostname;
      if (host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.') || host.startsWith('10.') || host === '::1') {
        return { content: 'Fetching localhost/private URLs is not allowed.', is_error: true };
      }

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html, text/plain, application/json',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { content: `HTTP ${res.status}: ${res.statusText}`, is_error: true };

      const contentType = res.headers.get('content-type') ?? '';
      const body = await res.text();

      if (contentType.includes('application/json')) {
        try {
          const json = JSON.parse(body);
          return { content: JSON.stringify(json, null, 2).slice(0, 50_000) };
        } catch {
          return { content: body.slice(0, 50_000) };
        }
      }

      if (contentType.includes('text/plain') || !contentType.includes('text/html')) {
        return { content: body.slice(0, 50_000) };
      }

      // HTML -> text conversion
      const md = htmlToText(body).slice(0, 50_000);
      return { content: md || '(empty page)' };
    } catch (e) {
      return { content: `Fetch error: ${(e as Error).message}`, is_error: true };
    }
  },
};

function htmlToText(html: string): string {
  // Remove scripts and styles
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Convert structural elements
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|section|article|main)[^>]*>/gi, '\n')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();

  return text;
}

