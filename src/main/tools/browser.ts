import type { Tool, ToolResult } from './base.js';

export const browserTool: Tool = {
  name: 'Browser',
  description: 'Browse the web: fetch pages, extract text, search. Uses built-in HTTP client.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['fetch', 'search', 'extract'],
        description: 'The browser action to perform',
      },
      url: { type: 'string', description: 'URL to fetch (for fetch action)' },
      query: { type: 'string', description: 'Search query (for search action)' },
      selector: { type: 'string', description: 'CSS selector hint for extraction' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const { action, url, query } = args as {
      action: string;
      url?: string;
      query?: string;
    };
    try {
      switch (action) {
        case 'fetch': {
          if (!url) return { content: 'url is required for fetch', is_error: true };
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Infinite-AI)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { content: `HTTP ${res.status}`, is_error: true };
          const html = await res.text();
          const text = htmlToText(html).slice(0, 30_000);
          return { content: text || '(empty page)' };
        }
        case 'search': {
          if (!query) return { content: 'query is required for search', is_error: true };
          const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { content: `Search failed: HTTP ${res.status}`, is_error: true };
          const html = await res.text();
          const results = parseSearchResults(html);
          if (!results.length) return { content: 'No results found.' };
          return {
            content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n\n'),
          };
        }
        case 'extract': {
          if (!url) return { content: 'url is required for extract', is_error: true };
          const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Infinite-AI)' },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
          });
          if (!res.ok) return { content: `HTTP ${res.status}`, is_error: true };
          const html = await res.text();
          const text = htmlToText(html).slice(0, 30_000);
          return { content: text || '(empty page)' };
        }
        default:
          return { content: `Unknown action: ${action}`, is_error: true };
      }
    } catch (e) {
      return { content: `Browser error: ${(e as Error).message}`, is_error: true };
    }
  },
};

function htmlToText(html: string): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|section|article)[^>]*>/gi, '\n')
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

function parseSearchResults(html: string): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 10) {
    let rawUrl = m[1];
    try { rawUrl = decodeURIComponent(rawUrl.replace(/.*uddg=/, '')); } catch { /* keep */ }
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    if (title && rawUrl.startsWith('http')) out.push({ title, url: rawUrl });
  }
  return out;
}
