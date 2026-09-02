import classicCss from '../styles/globals-classic.css?inline';
import modernCss from '../styles/globals.css?inline';
import type { UiTheme } from './uiTheme';

const THEME_CSS: Record<string, string> = {
  classic: classicCss,
  modern: modernCss,
  // Midnight and Aurora use modern as base — extra tokens are applied via CSS variables below.
  midnight: modernCss,
  aurora: modernCss,
};

const THEME_EXTRA_VARS: Record<string, string> = {
  midnight: `
    :root { --ios-accent: #7c6cf0 !important; --ios-accent-hover: #9585ff !important; --ios-bg: #0d0d1a !important; --ios-surface: #141428 !important; --ios-border: rgba(124,108,240,0.15) !important; }
  `,
  aurora: `
    :root { --ios-accent: #2ec4a5 !important; --ios-accent-hover: #3dd9b8 !important; --ios-bg: #0e1a18 !important; --ios-surface: #142620 !important; --ios-border: rgba(46,196,165,0.15) !important; }
  `,
};

/**
 * Both full stylesheets (classic = original Infinite OS, modern = redesign)
 * are compiled up front; exactly one is mounted at a time as a single <style>
 * node prepended to <head>, so switching themes swaps the whole cascade with
 * no specificity fights between the two token sets.
 */
const styleEl = document.createElement('style');
styleEl.id = 'infinite-ui-theme';
const extraEl = document.createElement('style');
extraEl.id = 'infinite-ui-theme-extra';

export function initThemeStyles(theme: UiTheme): void {
  if (!styleEl.isConnected) document.head.prepend(styleEl);
  if (!extraEl.isConnected) document.head.append(extraEl);
  applyThemeStyles(theme);
}

export function applyThemeStyles(theme: UiTheme): void {
  styleEl.textContent = THEME_CSS[theme] ?? modernCss;
  extraEl.textContent = THEME_EXTRA_VARS[theme] ?? '';
  document.documentElement.dataset.uiTheme = theme;
}
