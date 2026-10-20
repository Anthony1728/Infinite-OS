// A main-side index of the user's Tabs sections.
//
// Tabs are owned by the renderer (they live in its store and localStorage), so
// main had no way to answer "what tabs are open?" or "what URL is that tab on?".
// The TabBrowser tool therefore could only return a paragraph of prose telling
// the model to go and look for itself — which is not an answer.
//
// The renderer mirrors its tabs here as they change, and this index can also ask
// the LIVE WebContentsView for the tab's current URL. So the agent can list real
// tabs, read the real address of a tab the user is looking at right now, and
// navigate it.
//
// This is a cache of what the renderer already knows, not a second source of
// truth: the renderer reports every create/update/close, and asks for the whole
// set on hydrate, so a reload resynchronises it.

export interface TabRecord {
  id: string;
  title: string;
  kind: string;
  url?: string;
  prompt?: string;
  filePath?: string;
  openedByAgent?: boolean;
  updatedAt: number;
}

const tabs = new Map<string, TabRecord>();

/** Create or replace a tab in the index. */
export function upsertTab(input: Partial<TabRecord> & { id: string }): TabRecord {
  const existing = tabs.get(input.id);
  const record: TabRecord = {
    id: input.id,
    title: (input.title ?? existing?.title ?? 'Untitled').slice(0, 80),
    kind: input.kind ?? existing?.kind ?? 'custom',
    url: input.url ?? existing?.url,
    prompt: input.prompt ?? existing?.prompt,
    filePath: input.filePath ?? existing?.filePath,
    openedByAgent: input.openedByAgent ?? existing?.openedByAgent ?? false,
    updatedAt: Date.now(),
  };
  tabs.set(record.id, record);
  return record;
}

/** Replace the whole index — sent by the renderer on hydrate and after a reload. */
export function replaceTabs(list: Array<Partial<TabRecord> & { id: string }>): void {
  tabs.clear();
  for (const item of list) upsertTab(item);
}

export function removeTab(id: string): void {
  tabs.delete(id);
}

export function getTab(id: string): TabRecord | undefined {
  return tabs.get(id);
}

export function listTabs(): TabRecord[] {
  // Newest first — that is the order the sidebar shows them in.
  return [...tabs.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The tab's real current URL.
 *
 * Prefers the live guest: the address bar follows the page through in-page
 * navigation and redirects, so the stored value can lag behind what the user is
 * actually looking at. Falls back to the mirrored value when the tab is not the
 * one currently on screen (its guest does not exist while it is closed).
 */
export async function resolveLiveUrl(id: string): Promise<{ url?: string; title?: string; mounted: boolean }> {
  const viewId = `tabview:${id}`;
  const { readTabBrowserState } = await import('./tab-browser-view.js');
  const state = readTabBrowserState(viewId);
  if (state && typeof state.url === 'string') {
    // Keep the mirror honest so a later list/get is accurate too.
    const record = tabs.get(id);
    if (record && record.url !== state.url) {
      record.url = state.url;
      record.title = typeof state.title === 'string' && state.title ? state.title : record.title;
    }
    return { url: state.url, title: typeof state.title === 'string' ? state.title : undefined, mounted: true };
  }
  const record = tabs.get(id);
  return { url: record?.url, title: record?.title, mounted: false };
}

/** A short, model-readable rendering of the open tabs. */
export function describeTabs(): string {
  const list = listTabs();
  if (list.length === 0) return 'No tabs are open.';
  const lines = list.map((tab, index) => {
    const where = tab.url ? tab.url : tab.filePath ? `file: ${tab.filePath}` : '(no page loaded)';
    const who = tab.openedByAgent ? ' · opened by the agent' : '';
    return `${index + 1}. [${tab.id}] ${tab.title} — ${where}${who}`;
  });
  return `${list.length} tab${list.length === 1 ? '' : 's'} open:\n${lines.join('\n')}`;
}