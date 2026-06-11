import type { Tool, ToolResult } from './base.js';

// Free backend: DuckDuckGo HTML. No API key required.
// Pluggable: provider config can point at a different backend later.

export const websearch: Tool = {
  name: 'WebSearch',
  description: 'Search the web. Returns a list of result titles and URLs. No API key required (uses DuckDuckGo).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      allowed_domains: { type: 'array', items: { type: 'string' } },
      blocked_domains: { type: 'array', items: { type: 'string' } },
    },
    required: ['query'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const { query } = args as { query: string };
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 Infinite-AI/0.1' },
      });
      if (!res.ok) return { content: `HTTP ${res.status}`, is_error: true };
      const html = await res.text();
      const results = parseDuckDuckGo(html);
      if (!results.length) return { content: '(no results)' };
      return { content: results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join('\n\n') };
    } catch (e) {
      return { content: (e as Error).message, is_error: true };
    }
  },
};

function parseDuckDuckGo(html: string): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 10) {
    const url = decodeURIComponent(m[1].replace(/.*uddg=/, ''));
    const title = m[2].replace(/<[^>]+>/g, '').trim();
    out.push({ title, url });
  }
  return out;
}
