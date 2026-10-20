import { describe, expect, it, beforeEach } from 'vitest';
import { describeTabs, getTab, listTabs, removeTab, replaceTabs, upsertTab } from './tab-index.js';
import { tabBrowserTool } from './tools/tab-browser.js';

/**
 * The TabBrowser tool used to answer `list` and `get_url` with a paragraph of
 * prose telling the model to go and look for itself. These tests pin the real
 * behaviour: tabs are known to main, and the tool answers with data.
 */

const ctx = {
  cwd: process.cwd(),
  abortSignal: new AbortController().signal,
  sessionId: 'test',
  onUpdate: () => undefined,
};

describe('tab index', () => {
  beforeEach(() => {
    replaceTabs([]);
  });

  it('knows about tabs the renderer mirrored', () => {
    upsertTab({ id: 'ai-tab-1', title: 'Docs', kind: 'website', url: 'https://example.com/docs' });
    upsertTab({ id: 'ai-tab-2', title: 'Local', kind: 'website', url: 'http://127.0.0.1:5000/index.html' });

    expect(listTabs()).toHaveLength(2);
    expect(getTab('ai-tab-1')?.url).toBe('https://example.com/docs');
    expect(getTab('ai-tab-2')?.url).toBe('http://127.0.0.1:5000/index.html');
  });

  it('replaces the whole set on a reload, so a closed tab disappears', () => {
    upsertTab({ id: 'ai-tab-1', title: 'A', kind: 'website' });
    upsertTab({ id: 'ai-tab-2', title: 'B', kind: 'website' });
    replaceTabs([{ id: 'ai-tab-2', title: 'B', kind: 'website' }]);

    expect(listTabs().map((t) => t.id)).toEqual(['ai-tab-2']);
  });

  it('describes tabs with their real address, not a pointer to localStorage', () => {
    upsertTab({ id: 'ai-tab-1', title: 'Docs', kind: 'website', url: 'https://example.com' });
    const described = describeTabs();
    expect(described).toContain('ai-tab-1');
    expect(described).toContain('https://example.com');
    // The old answer told the model to read localStorage. That must be gone.
    expect(described).not.toMatch(/localStorage/i);
  });

  it('says so plainly when nothing is open', () => {
    expect(describeTabs()).toBe('No tabs are open.');
  });

  it('removes a tab', () => {
    upsertTab({ id: 'ai-tab-1', title: 'A', kind: 'website' });
    removeTab('ai-tab-1');
    expect(getTab('ai-tab-1')).toBeUndefined();
  });
});

describe('TabBrowser tool answers with data', () => {
  beforeEach(() => {
    replaceTabs([]);
  });

  it('lists open tabs with their addresses', async () => {
    upsertTab({ id: 'ai-tab-1', title: 'Docs', kind: 'website', url: 'https://example.com' });
    const result = await tabBrowserTool.execute({ action: 'list' }, ctx);
    expect(result.content).toContain('ai-tab-1');
    expect(result.content).toContain('https://example.com');
    expect(result.is_error).toBeFalsy();
  });

  it('reports a real URL for a known tab', async () => {
    upsertTab({ id: 'ai-tab-1', title: 'Docs', kind: 'website', url: 'https://example.com/page' });
    const result = await tabBrowserTool.execute({ action: 'get_url', tabId: 'ai-tab-1' }, ctx);
    const parsed = JSON.parse(String(result.content)) as { url: string; title: string };
    expect(parsed.url).toBe('https://example.com/page');
    expect(parsed.title).toBe('Docs');
  });

  it('names the open tabs when asked about one that does not exist', async () => {
    upsertTab({ id: 'ai-tab-1', title: 'Docs', kind: 'website', url: 'https://example.com' });
    const result = await tabBrowserTool.execute({ action: 'get_url', tabId: 'nope' }, ctx);
    expect(result.is_error).toBe(true);
    // It should help the model recover, not just refuse.
    expect(result.content).toContain('ai-tab-1');
  });

  it('requires a tabId and points at list, rather than failing silently', async () => {
    const result = await tabBrowserTool.execute({ action: 'get_url' }, ctx);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('list');
  });

  it('normalises what it is given into a loadable URL', async () => {
    upsertTab({ id: 'ai-tab-1', title: 'A', kind: 'website' });
    const bare = await tabBrowserTool.execute({ action: 'navigate', tabId: 'ai-tab-1', url: 'example.com' }, ctx);
    expect(bare.content).toContain('https://example.com');

    const words = await tabBrowserTool.execute({ action: 'navigate', tabId: 'ai-tab-1', url: 'how to bake bread' }, ctx);
    expect(words.content).toContain('duckduckgo.com');

    const full = await tabBrowserTool.execute({ action: 'navigate', tabId: 'ai-tab-1', url: 'https://a.test/x' }, ctx);
    expect(full.content).toContain('https://a.test/x');
  });

  it('never invents a tab id', async () => {
    const result = await tabBrowserTool.execute({ action: 'navigate', tabId: 'made-up', url: 'https://a.test' }, ctx);
    // Navigating a tab that is not open is not fatal — it stores the URL — but it
    // must not claim success for a tab it does not know.
    expect(result.is_error).toBeFalsy();
    expect(result.content).toContain('made-up');
  });
});