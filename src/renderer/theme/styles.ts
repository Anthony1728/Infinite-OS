import classicCss from '../styles/globals-classic.css?inline';
import modernCss from '../styles/globals.css?inline';
import type { UiTheme } from './uiTheme';

/**
 * Both full stylesheets (classic = original Infinite OS, modern = redesign)
 * are compiled up front; exactly one is mounted at a time as a single <style>
 * node prepended to <head>, so switching themes swaps the whole cascade with
 * no specificity fights between the two token sets.
 */
const styleEl = document.createElement('style');
styleEl.id = 'infinite-ui-theme';

export function initThemeStyles(theme: UiTheme): void {
  if (!styleEl.isConnected) document.head.prepend(styleEl);
  applyThemeStyles(theme);
}

export function applyThemeStyles(theme: UiTheme): void {
  styleEl.textContent = theme === 'classic' ? classicCss : modernCss;
  document.documentElement.dataset.uiTheme = theme;
}
