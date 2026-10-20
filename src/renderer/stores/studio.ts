import { create } from 'zustand';
import type {
  StudioAiAction,
  StudioAiResult,
  StudioCreateInput,
  StudioItem,
  StudioKind,
  StudioUpdateInput,
} from '../../shared/studio';
import { useNotificationStore } from './notifications';

interface StudioState {
  items: StudioItem[];
  activeId: string | null;
  kind: StudioKind;
  loading: boolean;
  saving: boolean;
  aiBusy: boolean;
  lastSavedAt: number | null;
  error: string | null;
  load: () => Promise<void>;
  select: (id: string | null) => void;
  setKind: (kind: StudioKind) => void;
  create: (kind: StudioKind, title?: string) => Promise<StudioItem | null>;
  update: (id: string, patch: StudioUpdateInput) => Promise<StudioItem | null>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  toggleStar: (id: string) => Promise<void>;
  runAi: (args: { action: StudioAiAction; prompt: string; context?: string; language?: string; kind?: StudioKind }) => Promise<StudioAiResult | null>;
  exportItem: (id: string, format?: string) => Promise<void>;
  active: () => StudioItem | null;
}

const toast = (type: 'success' | 'error' | 'info', title: string, message?: string) =>
  useNotificationStore.getState().addToast({ type, title, message });

export const useStudioStore = create<StudioState>((set, get) => ({
  items: [],
  activeId: null,
  kind: 'document',
  loading: true,
  saving: false,
  aiBusy: false,
  lastSavedAt: null,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const items = (await window.api.studioList()) as StudioItem[];
      const activeId = get().activeId;
      const stillExists = activeId && items.some((item) => item.id === activeId);
      set({
        items,
        loading: false,
        activeId: stillExists ? activeId : items[0]?.id ?? null,
        kind: stillExists ? get().kind : items[0]?.kind ?? 'document',
      });
    } catch (error) {
      set({ loading: false, error: (error as Error).message });
      toast('error', 'Studio could not open', (error as Error).message);
    }
  },

  select: (id) => {
    const item = get().items.find((candidate) => candidate.id === id);
    set({ activeId: id, kind: item?.kind ?? get().kind });
  },

  setKind: (kind) => {
    const items = get().items;
    const active = items.find((item) => item.id === get().activeId);
    // Stay on the current item when it belongs to the chosen tab. Otherwise
    // open the most recent item of that kind, or show the empty state.
    if (active?.kind === kind) return;
    const next = items.find((item) => item.kind === kind);
    set({ kind, activeId: next?.id ?? null });
  },

  create: async (kind, title) => {
    try {
      const input: StudioCreateInput = { kind, title };
      const item = (await window.api.studioCreate(input)) as StudioItem;
      set((state) => ({
        items: [item, ...state.items],
        activeId: item.id,
        kind: item.kind,
        lastSavedAt: Date.now(),
      }));
      return item;
    } catch (error) {
      toast('error', 'Could not create that item', (error as Error).message);
      return null;
    }
  },

  update: async (id, patch) => {
    set({ saving: true });
    try {
      const item = (await window.api.studioUpdate({ id, patch })) as StudioItem | null;
      if (!item) {
        set({ saving: false });
        return null;
      }
      set((state) => ({
        items: state.items.map((candidate) => (candidate.id === item.id ? item : candidate)),
        saving: false,
        lastSavedAt: Date.now(),
        error: null,
      }));
      return item;
    } catch (error) {
      set({ saving: false });
      toast('error', 'Save failed', (error as Error).message);
      return null;
    }
  },

  remove: async (id) => {
    try {
      await window.api.studioDelete({ id });
      set((state) => {
        const items = state.items.filter((item) => item.id !== id);
        const nextActive = state.activeId === id ? items[0] ?? null : items.find((item) => item.id === state.activeId) ?? null;
        return {
          items,
          activeId: nextActive?.id ?? null,
          kind: nextActive?.kind ?? state.kind,
        };
      });
    } catch (error) {
      toast('error', 'Could not delete that item', (error as Error).message);
    }
  },

  duplicate: async (id) => {
    try {
      const copy = (await window.api.studioDuplicate({ id })) as StudioItem | null;
      if (!copy) return;
      set((state) => ({ items: [copy, ...state.items], activeId: copy.id, kind: copy.kind }));
      toast('success', 'Duplicated', copy.title);
    } catch (error) {
      toast('error', 'Could not duplicate that item', (error as Error).message);
    }
  },

  toggleStar: async (id) => {
    const item = get().items.find((candidate) => candidate.id === id);
    if (!item) return;
    await get().update(id, { starred: !item.starred });
  },

  runAi: async ({ action, prompt, context, language, kind }) => {
    set({ aiBusy: true });
    const activeItem = get().items.find((item) => item.id === get().activeId);
    try {
      const result = (await window.api.studioAi({
        action,
        kind: kind ?? activeItem?.kind ?? get().kind,
        prompt,
        context,
        itemId: get().activeId ?? undefined,
        language,
      })) as StudioAiResult;
      set({ aiBusy: false });
      return result;
    } catch (error) {
      set({ aiBusy: false });
      toast('error', 'AI could not finish that', (error as Error).message);
      return null;
    }
  },

  exportItem: async (id, format) => {
    try {
      const result = (await window.api.studioExport({ id, format })) as { canceled: boolean; path?: string };
      if (result.canceled) return;
      toast('success', 'Exported', result.path);
    } catch (error) {
      toast('error', 'Export failed', (error as Error).message);
    }
  },

  active: () => {
    const state = get();
    return state.items.find((item) => item.id === state.activeId) ?? null;
  },
}));
