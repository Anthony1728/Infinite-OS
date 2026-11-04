/**
 * Pages renderer store.
 *
 * The metadata index lives in `summaries`; only pages the user has opened are
 * loaded into `pages`. Edits return the authoritative record from main, so the
 * UI never has to guess what a save did. Search is served by main's index and
 * is debounced by the caller.
 */

import { create } from 'zustand';
import type {
  PageCreateInput,
  PageDatabase,
  PageDatabaseRowInput,
  PageRecord,
  PageSearchHit,
  PageSummary,
  PageTemplateId,
  PageUpdateInput,
} from '../../shared/pages';
import { useNotificationStore } from './notifications';

const LAST_PAGE_KEY = 'infinite:pages:last-page';

function toast(type: 'success' | 'error' | 'info', title: string, message?: string): void {
  useNotificationStore.getState().addToast({ type, title, message });
}

function linksFor(page: Pick<PageRecord, 'blocks'>): string[] {
  const plain = page.blocks
    .map((block) => `${block.html} ${block.caption ?? ''} ${block.table?.headers.join(' ') ?? ''} ${block.table?.rows.flat().join(' ') ?? ''}`)
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');
  const links = new Set<string>();
  const matcher = /\[\[([^\]]{1,160})\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(plain))) {
    const title = match[1]!.trim().toLowerCase();
    if (title) links.add(title);
  }
  return [...links].slice(0, 100);
}

function summaryFromRecord(record: PageRecord, previous?: PageSummary): PageSummary {
  return {
    id: record.id,
    parentId: record.parentId,
    kind: record.kind,
    title: record.title,
    icon: record.icon,
    cover: record.cover,
    favorite: record.favorite,
    archived: record.archived,
    trashedAt: record.trashedAt,
    order: record.order,
    rowDatabaseId: record.rowDatabaseId,
    rowId: record.rowId,
    links: linksFor(record),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || previous?.updatedAt || Date.now(),
  };
}

function databaseRowTitle(database: PageDatabase | undefined, rowId: string): { title: string; updatedAt: number } | null {
  if (!database) return null;
  const titleProperty = database.properties.find((property) => property.type === 'title');
  const row = database.rows.find((candidate) => candidate.id === rowId);
  if (!titleProperty || !row) return null;
  const value = row.values[titleProperty.id];
  const title = typeof value === 'string' && value.trim() ? value.trim() : 'Untitled';
  return { title, updatedAt: row.updatedAt };
}

function readLastPage(): string | null {
  try {
    return localStorage.getItem(LAST_PAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastPage(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_PAGE_KEY, id);
    else localStorage.removeItem(LAST_PAGE_KEY);
  } catch {
    /* ephemeral UI state */
  }
}

interface PagesState {
  summaries: PageSummary[];
  pages: Record<string, PageRecord>;
  activeId: string | null;
  loading: boolean;
  loadingActive: boolean;
  saving: boolean;
  error: string | null;
  searchHits: PageSearchHit[];
  searching: boolean;
  aiOpen: boolean;
  sidebarCollapsed: boolean;

  load: () => Promise<void>;
  refreshSummaries: () => Promise<PageSummary[]>;
  select: (id: string | null) => Promise<PageRecord | null>;
  reload: (id: string) => Promise<PageRecord | null>;
  create: (input?: PageCreateInput) => Promise<PageRecord | null>;
  createFromTemplate: (templateId: PageTemplateId, parentId?: string | null) => Promise<PageRecord | null>;
  update: (id: string, patch: PageUpdateInput) => Promise<PageRecord | null>;
  updateQuiet: (id: string, patch: PageUpdateInput) => Promise<PageRecord | null>;
  duplicate: (id: string) => Promise<PageRecord | null>;
  trash: (id: string) => Promise<void>;
  restore: (id: string) => Promise<void>;
  deletePermanent: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  search: (query: string) => Promise<PageSearchHit[]>;
  clearSearch: () => void;
  setAiOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  createRow: (databaseId: string, input?: PageDatabaseRowInput) => Promise<PageDatabase | null>;
  updateRow: (databaseId: string, rowId: string, patch: PageDatabaseRowInput) => Promise<PageDatabase | null>;
  deleteRow: (databaseId: string, rowId: string) => Promise<PageDatabase | null>;
  duplicateRow: (databaseId: string, rowId: string) => Promise<PageDatabase | null>;
  openRow: (databaseId: string, rowId: string) => Promise<PageRecord | null>;

  addComment: (id: string, text: string, blockId?: string) => Promise<void>;
  deleteComment: (id: string, commentId: string) => Promise<void>;
  resolveComment: (id: string, commentId: string, resolved: boolean) => Promise<void>;
  saveVersion: (id: string) => Promise<void>;
  restoreVersion: (id: string, versionId: string) => Promise<void>;
  exportPage: (id: string, format?: 'md' | 'csv') => Promise<void>;
}

let searchToken = 0;
const updateSequence = new Map<string, number>();
let pendingSaves = 0;
let activeLoadToken = 0;

function beginSave(set: (partial: Partial<PagesState>) => void): void {
  pendingSaves += 1;
  set({ saving: true });
}

function endSave(set: (partial: Partial<PagesState>) => void): void {
  pendingSaves = Math.max(0, pendingSaves - 1);
  if (pendingSaves === 0) set({ saving: false });
}

export const usePagesStore = create<PagesState>((set, get) => ({
  summaries: [],
  pages: {},
  activeId: null,
  loading: true,
  loadingActive: false,
  saving: false,
  error: null,
  searchHits: [],
  searching: false,
  aiOpen: false,
  sidebarCollapsed: false,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const summaries = (await window.api.pagesList()) as PageSummary[];
      const last = readLastPage();
      const active = get().activeId
        ?? ([last, summaries[0]?.id].find((id): id is string => Boolean(id) && summaries.some((summary) => summary.id === id && summary.trashedAt === null)) ?? null);
      set({ summaries, loading: false, activeId: active });
      if (active) void get().reload(active);
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : 'Pages could not be loaded.' });
      toast('error', 'Pages unavailable', error instanceof Error ? error.message : undefined);
    }
  },

  refreshSummaries: async () => {
    try {
      const summaries = (await window.api.pagesList()) as PageSummary[];
      set((state) => {
        const activeStillExists = state.activeId && summaries.some((summary) => summary.id === state.activeId);
        const activeId = activeStillExists
          ? state.activeId
          : summaries.find((summary) => !summary.trashedAt && !summary.rowDatabaseId)?.id ?? null;
        return { summaries, activeId, error: null };
      });
      return summaries;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Pages could not be refreshed.' });
      return get().summaries;
    }
  },

  select: async (id) => {
    if (!id) {
      set({ activeId: null, loadingActive: false });
      writeLastPage(null);
      return null;
    }
    const token = ++activeLoadToken;
    set({ activeId: id, loadingActive: true, error: null });
    writeLastPage(id);
    try {
      const page = (await window.api.pagesGet({ id })) as PageRecord | null;
      if (token !== activeLoadToken) return null;
      if (!page) {
        set({ loadingActive: false, error: 'That page no longer exists.' });
        return null;
      }
      set((state) => ({
        pages: { ...state.pages, [page.id]: page },
        loadingActive: false,
        summaries: state.summaries.some((summary) => summary.id === page.id)
          ? state.summaries
          : [...state.summaries, summaryFromRecord(page)],
      }));
      return page;
    } catch (error) {
      if (token === activeLoadToken) set({ loadingActive: false, error: error instanceof Error ? error.message : 'That page could not be opened.' });
      return null;
    }
  },

  reload: async (id) => {
    try {
      const page = (await window.api.pagesGet({ id })) as PageRecord | null;
      if (!page) return null;
      set((state) => ({ pages: { ...state.pages, [id]: page } }));
      return page;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'That page could not be refreshed.' });
      return null;
    }
  },

  create: async (input = {}) => {
    set({ saving: true, error: null });
    try {
      const page = (await window.api.pagesCreate(input)) as PageRecord;
      await get().refreshSummaries();
      set((state) => ({ pages: { ...state.pages, [page.id]: page } }));
      await get().select(page.id);
      set({ saving: false });
      return page;
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : 'The page could not be created.' });
      toast('error', 'Could not create page', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  createFromTemplate: async (templateId, parentId = null) => {
    set({ saving: true, error: null });
    try {
      const page = (await window.api.pagesCreate({ templateId, parentId })) as PageRecord;
      await get().refreshSummaries();
      set((state) => ({ pages: { ...state.pages, [page.id]: page } }));
      await get().select(page.id);
      set({ saving: false });
      toast('success', 'Template applied', page.title);
      return page;
    } catch (error) {
      set({ saving: false, error: error instanceof Error ? error.message : 'The template could not be applied.' });
      toast('error', 'Could not apply template', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  update: async (id, patch) => {
    const sequence = (updateSequence.get(id) ?? 0) + 1;
    updateSequence.set(id, sequence);
    beginSave(set);
    try {
      const page = (await window.api.pagesUpdate({ id, patch })) as PageRecord;
      if (sequence === updateSequence.get(id)) {
        set((state) => ({
          pages: { ...state.pages, [id]: page },
          summaries: state.summaries.map((summary) => {
            if (summary.id === id) return summaryFromRecord(page, summary);
            if (page.kind === 'database' && summary.rowDatabaseId === id) {
              const row = databaseRowTitle(page.database, summary.rowId ?? '');
              if (row && row.title !== summary.title) {
                return { ...summary, title: row.title, updatedAt: row.updatedAt };
              }
            }
            return summary;
          }),
          error: null,
        }));
      }
      return page;
    } catch (error) {
      if (sequence === updateSequence.get(id)) {
        set({ error: error instanceof Error ? error.message : 'The page could not be saved.' });
        toast('error', 'Could not save page', error instanceof Error ? error.message : undefined);
      }
      return null;
    } finally {
      endSave(set);
    }
  },

  updateQuiet: async (id, patch) => {
    try {
      return await get().update(id, patch);
    } finally {
      /* update already reports errors */
    }
  },

  duplicate: async (id) => {
    set({ saving: true });
    try {
      const page = (await window.api.pagesDuplicate({ id })) as PageRecord | null;
      await get().refreshSummaries();
      set({ saving: false });
      if (page) {
        await get().select(page.id);
        toast('success', 'Page duplicated', page.title);
      }
      return page;
    } catch (error) {
      set({ saving: false });
      toast('error', 'Could not duplicate page', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  trash: async (id) => {
    try {
      await window.api.pagesTrash({ id });
      const active = get().activeId;
      await get().refreshSummaries();
      if (active === id || !get().summaries.some((summary) => summary.id === active)) {
        const next = get().summaries.find((summary) => !summary.trashedAt && !summary.rowDatabaseId);
        await get().select(next?.id ?? null);
      }
      toast('info', 'Moved to trash');
    } catch (error) {
      toast('error', 'Could not move to trash', error instanceof Error ? error.message : undefined);
    }
  },

  restore: async (id) => {
    try {
      const page = (await window.api.pagesRestore({ id })) as PageRecord;
      await get().refreshSummaries();
      await get().select(page.id);
      toast('success', 'Page restored', page.title);
    } catch (error) {
      toast('error', 'Could not restore page', error instanceof Error ? error.message : undefined);
    }
  },

  deletePermanent: async (id) => {
    try {
      await window.api.pagesDelete({ id });
      const active = get().activeId;
      await get().refreshSummaries();
      if (active === id) {
        const next = get().summaries.find((summary) => !summary.trashedAt);
        await get().select(next?.id ?? null);
      }
      toast('info', 'Page deleted permanently');
    } catch (error) {
      toast('error', 'Could not delete page', error instanceof Error ? error.message : undefined);
    }
  },

  emptyTrash: async () => {
    try {
      await window.api.pagesEmptyTrash();
      await get().refreshSummaries();
      toast('info', 'Trash emptied');
    } catch (error) {
      toast('error', 'Could not empty trash', error instanceof Error ? error.message : undefined);
    }
  },

  toggleFavorite: async (id) => {
    const summary = get().summaries.find((candidate) => candidate.id === id);
    if (!summary) return;
    const page = get().pages[id];
    if (page) await get().update(id, { favorite: !page.favorite });
    else await get().update(id, { favorite: !summary.favorite });
  },

  search: async (query) => {
    const token = ++searchToken;
    const clean = query.trim();
    if (!clean) {
      set({ searchHits: [], searching: false });
      return [];
    }
    set({ searching: true });
    try {
      const hits = (await window.api.pagesSearch({ query: clean, limit: 30 })) as PageSearchHit[];
      if (token === searchToken) set({ searchHits: hits, searching: false });
      return hits;
    } catch {
      if (token === searchToken) set({ searchHits: [], searching: false });
      return [];
    }
  },

  clearSearch: () => set({ searchHits: [], searching: false }),

  setAiOpen: (open) => set({ aiOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  createRow: async (databaseId, input = {}) => {
    try {
      const database = (await window.api.pagesRowCreate({ databaseId, input })) as PageDatabase;
      set((state) => {
        const page = state.pages[databaseId];
        return page ? { pages: { ...state.pages, [databaseId]: { ...page, database, updatedAt: Date.now() } } } : {};
      });
      await get().refreshSummaries();
      return database;
    } catch (error) {
      toast('error', 'Could not add row', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  updateRow: async (databaseId, rowId, patch) => {
    try {
      const database = (await window.api.pagesRowUpdate({ databaseId, rowId, patch })) as PageDatabase;
      set((state) => {
        const page = state.pages[databaseId];
        const nextPages = page ? { ...state.pages, [databaseId]: { ...page, database, updatedAt: Date.now() } } : state.pages;
        const title = database.properties.find((property) => property.type === 'title');
        const row = database.rows.find((candidate) => candidate.id === rowId);
        const rowTitle = title && row && typeof row.values[title.id] === 'string' ? String(row.values[title.id]) : 'Untitled';
        return {
          pages: nextPages,
          summaries: state.summaries.map((summary) => (
            summary.rowDatabaseId === databaseId && summary.rowId === rowId
              ? { ...summary, title: rowTitle, updatedAt: Date.now() }
              : summary
          )),
        };
      });
      return database;
    } catch (error) {
      toast('error', 'Could not update row', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  deleteRow: async (databaseId, rowId) => {
    try {
      const database = (await window.api.pagesRowDelete({ databaseId, rowId })) as PageDatabase;
      set((state) => {
        const page = state.pages[databaseId];
        return page ? { pages: { ...state.pages, [databaseId]: { ...page, database, updatedAt: Date.now() } } } : {};
      });
      const active = get().activeId;
      const activePage = active ? get().pages[active] : null;
      if (activePage?.rowDatabaseId === databaseId && activePage.rowId === rowId) {
        await get().select(databaseId);
      } else if (active && activePage?.rowDatabaseId === databaseId) {
        await get().reload(active);
      }
      await get().refreshSummaries();
      return database;
    } catch (error) {
      toast('error', 'Could not delete row', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  duplicateRow: async (databaseId, rowId) => {
    try {
      const database = (await window.api.pagesRowDuplicate({ databaseId, rowId })) as PageDatabase;
      set((state) => {
        const page = state.pages[databaseId];
        return page ? { pages: { ...state.pages, [databaseId]: { ...page, database, updatedAt: Date.now() } } } : {};
      });
      await get().refreshSummaries();
      return database;
    } catch (error) {
      toast('error', 'Could not duplicate row', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  openRow: async (databaseId, rowId) => {
    set({ loadingActive: true });
    try {
      const page = (await window.api.pagesRowOpen({ databaseId, rowId })) as PageRecord;
      set((state) => ({
        pages: { ...state.pages, [page.id]: page },
        summaries: state.summaries.some((summary) => summary.id === page.id)
          ? state.summaries
          : [...state.summaries, summaryFromRecord(page)],
        loadingActive: false,
      }));
      await get().select(page.id);
      return page;
    } catch (error) {
      set({ loadingActive: false });
      toast('error', 'Could not open row', error instanceof Error ? error.message : undefined);
      return null;
    }
  },

  addComment: async (id, text, blockId) => {
    try {
      const page = (await window.api.pagesCommentAdd({ id, text, blockId })) as PageRecord;
      set((state) => ({ pages: { ...state.pages, [id]: page } }));
    } catch (error) {
      toast('error', 'Could not add comment', error instanceof Error ? error.message : undefined);
    }
  },

  deleteComment: async (id, commentId) => {
    try {
      const page = (await window.api.pagesCommentDelete({ id, commentId })) as PageRecord;
      set((state) => ({ pages: { ...state.pages, [id]: page } }));
    } catch (error) {
      toast('error', 'Could not delete comment', error instanceof Error ? error.message : undefined);
    }
  },

  resolveComment: async (id, commentId, resolved) => {
    try {
      const page = (await window.api.pagesCommentResolve({ id, commentId, resolved })) as PageRecord;
      set((state) => ({ pages: { ...state.pages, [id]: page } }));
    } catch (error) {
      toast('error', 'Could not update comment', error instanceof Error ? error.message : undefined);
    }
  },

  saveVersion: async (id) => {
    try {
      const page = (await window.api.pagesVersionSave({ id })) as PageRecord;
      set((state) => ({ pages: { ...state.pages, [id]: page } }));
      toast('success', 'Version saved');
    } catch (error) {
      toast('error', 'Could not save version', error instanceof Error ? error.message : undefined);
    }
  },

  restoreVersion: async (id, versionId) => {
    try {
      const page = (await window.api.pagesVersionRestore({ id, versionId })) as PageRecord;
      set((state) => ({
        pages: { ...state.pages, [id]: page },
        summaries: state.summaries.map((summary) => (summary.id === id ? summaryFromRecord(page, summary) : summary)),
      }));
      toast('success', 'Version restored');
    } catch (error) {
      toast('error', 'Could not restore version', error instanceof Error ? error.message : undefined);
    }
  },

  exportPage: async (id, format) => {
    try {
      const path = (await window.api.pagesExport({ id, format })) as string | null;
      if (path) toast('success', 'Exported', path);
    } catch (error) {
      toast('error', 'Could not export', error instanceof Error ? error.message : undefined);
    }
  },
}));
