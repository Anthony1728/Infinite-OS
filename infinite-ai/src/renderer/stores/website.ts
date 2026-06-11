import { create } from 'zustand';

export interface Website {
  id: string;
  name: string;
  template: string;
  status: 'draft' | 'published' | 'deployed';
  pages: { name: string; path: string }[];
  components: { name: string; type: string }[];
  url?: string;
  createdAt: number;
}

export interface WebsiteTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
}

export interface WebsiteStats {
  totalWebsites: number;
  published: number;
  deployed: number;
}

interface WebsiteState {
  websites: Website[];
  templates: WebsiteTemplate[];
  stats: WebsiteStats | null;
  loading: boolean;
  loadWebsites: () => Promise<void>;
  loadTemplates: () => Promise<void>;
  loadStats: () => Promise<void>;
  createWebsite: (args: { name: string; template: string; description?: string }) => Promise<void>;
  deleteWebsite: (id: string) => Promise<void>;
  addPage: (websiteId: string, page: { name: string; path: string }) => Promise<void>;
  publishWebsite: (id: string) => Promise<void>;
  deployWebsite: (id: string) => Promise<void>;
}

export const useWebsiteStore = create<WebsiteState>((set, get) => ({
  websites: [],
  templates: [],
  stats: null,
  loading: false,

  loadWebsites: async () => {
    set({ loading: true });
    try {
      const websites = await window.api.websiteList() as Website[];
      set({ websites, loading: false });
    } catch { set({ loading: false }); }
  },

  loadTemplates: async () => {
    try {
      const templates = await window.api.websiteTemplates() as WebsiteTemplate[];
      set({ templates });
    } catch {}
  },

  loadStats: async () => {
    try {
      const stats = await window.api.websiteStats() as WebsiteStats;
      set({ stats });
    } catch {}
  },

  createWebsite: async (args) => {
    await window.api.websiteCreate(args);
    await get().loadWebsites();
    await get().loadStats();
  },

  deleteWebsite: async (id) => {
    await window.api.websiteDelete({ id });
    await get().loadWebsites();
    await get().loadStats();
  },

  addPage: async (websiteId, page) => {
    await window.api.websiteAddPage({ websiteId, ...page });
    await get().loadWebsites();
  },

  publishWebsite: async (id) => {
    await window.api.websitePublish({ id });
    await get().loadWebsites();
  },

  deployWebsite: async (id) => {
    await window.api.websiteDeploy({ id });
    await get().loadWebsites();
  },
}));
