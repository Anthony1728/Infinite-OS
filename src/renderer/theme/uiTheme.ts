import { create } from 'zustand';
import { applyThemeStyles } from './styles';

export type UiTheme = 'classic' | 'modern' | 'midnight' | 'aurora';

export const UI_THEMES: Array<{ id: UiTheme; label: string; description: string }> = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'The original Infinite OS look — colorful accents, glows, and gradients.',
  },
  {
    id: 'modern',
    label: 'Modern',
    description: 'The redesigned monochrome interface with a calmer, focused palette.',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep navy and violet — easy on the eyes for late-night sessions.',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    description: 'Soft teal and amber — warm, organic, inspired by northern lights.',
  },
];

const STORAGE_KEY = 'infinite:uiTheme';

function readInitial(): UiTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'classic' || raw === 'modern') return raw;
  } catch {
    /* ignore */
  }
  return 'classic';
}

interface UiThemeState {
  theme: UiTheme;
  setTheme: (theme: UiTheme) => void;
}

export const useUiTheme = create<UiThemeState>((set) => ({
  theme: readInitial(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    applyThemeStyles(theme);
    set({ theme });
  },
}));
