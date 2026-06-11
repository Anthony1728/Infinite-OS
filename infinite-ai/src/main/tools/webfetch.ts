import type { Tool, ToolResult } from './base.js';

export const webfetch: Tool = {
  name: 'WebFetch',
  description: 'Fetch a URL, convert HTML to Markdown, and return the content.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      prompt: { type: 'string', description: 'What to extract from the page' },
    },
    required: ['url'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const { url, prompt } = args as { url: string; prompt?: string };
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Infinite-AI/0.1', Accept: 'text/markdown, text/html;q=0.9' },
        redirect: 'follow',
      });
      if (!res.ok) return { content: `HTTP ${res.status}`, is_error: true };
      const body = await res.text();
      const md = htmlToMarkdown(body).slice(0, 50_000);
      return { content: prompt ? `${prompt}\n\n---\n\n${md}` : md };
    } catch (e) {
      return { content: (e as Error).message, is_error: true };
    }
  },
};

function htmlToMarkdown(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<\/?(p|br|div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
