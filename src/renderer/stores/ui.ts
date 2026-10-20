import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WallpaperId } from '../lib/wallpapers';

export type UITheme = 'dark' | 'light' | 'system';
export type UITemplate = 'infinite' | 'aurora' | 'onyx' | 'cloud' | 'chatgpt' | 'zcode' | 'matrix';
export type LogoStyle = 'spectrum' | 'luminous' | 'ice';

export interface AppearancePreferences {
  template: UITemplate;
  accent: string;
  radius: number;
  glass: number;
  glow: number;
  density: 'compact' | 'comfortable' | 'spacious';
  motion: boolean;
  shinyBars: boolean;
  logoStyle: LogoStyle;
  wallpaper: WallpaperId;
  wallpaperImage: string | null;
  wallpaperImageName: string;
  wallpaperDim: number;
  wallpaperBlur: number;
}

interface UIState extends AppearancePreferences {
  settingsOpen: boolean;
  sidebarOpen: boolean;
  theme: UITheme;
  setSettingsOpen: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setTheme: (t: UITheme) => void;
  setAppearance: (patch: Partial<AppearancePreferences>) => void;
  resetAppearance: () => void;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  template: 'infinite', accent: '#8b5cf6', radius: 14, glass: 72, glow: 70,
  density: 'comfortable', motion: true, shinyBars: true, logoStyle: 'spectrum',
  wallpaper: 'midnight', wallpaperImage: null, wallpaperImageName: '',
  wallpaperDim: 42, wallpaperBlur: 0,
};

export const TEMPLATE_PRESETS: Record<UITemplate, Partial<AppearancePreferences>> = {
  infinite: { template: 'infinite', accent: '#8b5cf6', radius: 14, glass: 72, glow: 70, density: 'comfortable', shinyBars: true },
  aurora: { template: 'aurora', accent: '#22d3ee', radius: 20, glass: 84, glow: 95, density: 'spacious', shinyBars: true },
  onyx: { template: 'onyx', accent: '#a3e635', radius: 7, glass: 42, glow: 28, density: 'compact', shinyBars: false },
  cloud: { template: 'cloud', accent: '#4f46e5', radius: 16, glass: 68, glow: 35, density: 'comfortable', shinyBars: true },
  chatgpt: { template: 'chatgpt', accent: '#10a37f', radius: 16, glass: 58, glow: 22, density: 'spacious', shinyBars: false },
  zcode: { template: 'zcode', accent: '#38bdf8', radius: 10, glass: 48, glow: 30, density: 'compact', shinyBars: false },
  matrix: { template: 'matrix', accent: '#00e676', radius: 8, glass: 40, glow: 34, density: 'comfortable', shinyBars: false },
};

export function applyAppearance(prefs: AppearancePreferences, theme: UITheme = 'dark') {
  const root = document.documentElement;
  const resolvedTheme = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : theme;
  root.dataset.uiTemplate = prefs.template;
  root.dataset.uiDensity = prefs.density;
  root.dataset.uiMotion = prefs.motion ? 'on' : 'off';
  root.dataset.uiShine = prefs.shinyBars ? 'on' : 'off';
  root.dataset.logoStyle = prefs.logoStyle;
  root.dataset.wallpaper = prefs.wallpaper !== 'none' && (prefs.wallpaper !== 'custom' || prefs.wallpaperImage)
    ? 'on'
    : 'off';
  root.dataset.colorMode = resolvedTheme;
  root.classList.toggle('light', resolvedTheme === 'light');
  root.style.setProperty('--os-accent', prefs.accent);
  root.style.setProperty('--os-radius', `${prefs.radius}px`);
  root.style.setProperty('--os-glass', `${prefs.glass}%`);
  root.style.setProperty('--os-glow', String(prefs.glow / 100));
}

export function appearanceFromPrompt(prompt: string): Partial<AppearancePreferences> | null {
  const text = prompt.toLowerCase();
  const patch: Partial<AppearancePreferences> = {};
  if (/\b(aurora|neon|cyber|colorful)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.aurora);
  if (/\b(onyx|minimal|industrial|flat|green theme|green grid)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.onyx);
  if (/\b(cloud|light|bright|day)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.cloud);
  if (/\b(infinite|cosmic|default)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.infinite);
  if (/\b(chatgpt|mint|warm graphite)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.chatgpt);
  if (/\b(zcode|z code|cobalt|terminal blue)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.zcode);
  if (/\b(matrix|phosphor|scanline)\b/.test(text)) Object.assign(patch, TEMPLATE_PRESETS.matrix);
  if (/\b(no wallpaper|plain background|remove wallpaper|solid background)\b/.test(text)) patch.wallpaper = 'none';
  else {
    const wallpapers: Array<[WallpaperId, RegExp]> = [
      ['midnight', /\bmidnight\b/],
      ['aurora', /\baurora wallpaper\b|\baurora background\b/],
      ['sunset', /\bsunset\b/],
      ['forest', /\bforest\b/],
      ['ocean', /\bocean\b/],
      ['bloom', /\bbloom\b|\brose background\b/],
      ['graphite', /\bgraphite\b/],
      ['dusk', /\bdusk\b/],
    ];
    for (const [id, pattern] of wallpapers) if (pattern.test(text)) patch.wallpaper = id;
  }
  if (/\b(shiny|glossy|glassier|glassmorphism)\b/.test(text)) { patch.shinyBars = true; patch.glass = 90; patch.glow = 90; }
  if (/\b(matte|less glow|no glow)\b/.test(text)) { patch.shinyBars = false; patch.glow = 15; }
  if (/\b(compact|dense|smaller)\b/.test(text)) patch.density = 'compact';
  if (/\b(spacious|roomy|larger)\b/.test(text)) patch.density = 'spacious';
  if (/\b(rounder|rounded)\b/.test(text)) patch.radius = 22;
  if (/\b(square|sharp)\b/.test(text)) patch.radius = 5;
  if (/\b(original logo|spectrum logo|classic logo)\b/.test(text)) patch.logoStyle = 'spectrum';
  if (/\b(white logo|white infinite|luminous logo|monochrome logo)\b/.test(text)) patch.logoStyle = 'luminous';
  if (/\b(ice logo|blue white logo|bluish white|icy infinite)\b/.test(text)) patch.logoStyle = 'ice';
  const namedColors: Record<string, string> = { purple: '#8b5cf6', violet: '#7c3aed', blue: '#3b82f6', cyan: '#22d3ee', green: '#22c55e', lime: '#a3e635', pink: '#ec4899', orange: '#f97316', red: '#ef4444', gold: '#f59e0b' };
  for (const [name, value] of Object.entries(namedColors)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) patch.accent = value;
  }
  const hex = prompt.match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) patch.accent = hex;
  return Object.keys(patch).length ? patch : null;
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      settingsOpen: false,
      sidebarOpen: true,
      theme: 'dark',
      ...DEFAULT_APPEARANCE,
      setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setTheme: (theme) => {
        set({ theme });
        applyAppearance(get(), theme);
      },
      setAppearance: (patch) => {
        const next = { ...get(), ...patch };
        set(patch);
        applyAppearance(next, next.theme);
      },
      resetAppearance: () => {
        set(DEFAULT_APPEARANCE);
        applyAppearance(DEFAULT_APPEARANCE, get().theme);
      },
    }),
    {
      name: 'infinite:appearance-v2',
      partialize: ({
        theme, template, accent, radius, glass, glow, density, motion, shinyBars, logoStyle,
        wallpaper, wallpaperImage, wallpaperImageName, wallpaperDim, wallpaperBlur,
      }) => ({
        theme, template, accent, radius, glass, glow, density, motion, shinyBars, logoStyle,
        wallpaper, wallpaperImage, wallpaperImageName, wallpaperDim, wallpaperBlur,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyAppearance(state, state.theme);
        }
      },
    },
  ),
);

if (typeof window !== 'undefined') queueMicrotask(() => {
  const state = useUIStore.getState();
  applyAppearance(state, state.theme);
});
