import { create } from 'zustand';

interface UIState {
  settingsOpen: boolean;
  sidebarOpen: boolean;
  theme: 'dark' | 'light' | 'system';
  setSettingsOpen: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setTheme: (t: 'dark' | 'light' | 'system') => void;
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  sidebarOpen: true,
  theme: 'dark',
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setTheme: (theme) => {
    set({ theme });
    const root = document.documentElement;
    if (theme === 'light') root.classList.add('light');
    else if (theme === 'dark') root.classList.remove('light');
    else root.classList.toggle('light', window.matchMedia('(prefers-color-scheme: light)').matches);
  },
}));

