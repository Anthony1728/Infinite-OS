import type { Tool, ToolResult } from './base.js';

export const websearch: Tool = {
  name: 'WebSearch',
  description: 'Search the web for information. Returns titles, URLs, and snippets. No API key required.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const { query } = args as { query: string };
    try {
      // Try DuckDuckGo HTML endpoint
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!res.ok) return { content: `Search failed: HTTP ${res.status}`, is_error: true };
      const html = await res.text();
      const results = parseResults(html);
      if (!results.length) {
        return { content: 'No results found. Try a different search query.' };
      }
      return {
        content: results.map((r, i) =>
          `${i + 1}. ${r.title}\n   URL: ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`
        ).join('\n\n'),
      };
    } catch (e) {
      return { content: `Search error: ${(e as Error).message}`, is_error: true };
    }
  },
};

function parseResults(html: string): { title: string; url: string; snippet?: string }[] {
  const out: { title: string; url: string; snippet?: string }[] = [];

  // Try result__a pattern first
  const re1 = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html)) && out.length < 10) {
    let rawUrl = m[1];
    try {
      rawUrl = decodeURIComponent(rawUrl.replace(/.*uddg=/, ''));
    } catch { /* keep raw */ }
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    if (title && rawUrl.startsWith('http')) {
      out.push({ title, url: rawUrl });
    }
  }

  // Fallback: try generic link patterns
  if (out.length === 0) {
    const re2 = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = re2.exec(html)) && out.length < 10) {
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      const url = m[1];
      if (title && title.length > 5 && !url.includes('duckduckgo.com')) {
        out.push({ title, url });
      }
    }
  }

  // Try to extract snippets from result bodies
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let si = 0;
  while ((m = snippetRe.exec(html)) && si < out.length) {
    const snippet = m[1].replace(/<[^>]+>/g, '').trim();
    if (out[si]) out[si].snippet = snippet;
    si++;
  }

  return out;
}
