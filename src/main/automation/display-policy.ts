import { BrowserWindow } from 'electron';
import { settings } from '../settings/store.js';

export type AutomationDisplayPreference = 'smart' | 'always-visible' | 'always-background';
export type AutomationDisplayMode = 'visible' | 'background';

export interface AutomationDisplayState {
  preference: AutomationDisplayPreference;
  fullscreen: boolean;
  mode: AutomationDisplayMode;
}

export function resolveAutomationDisplayMode(
  preference: AutomationDisplayPreference,
  fullscreen: boolean,
): AutomationDisplayMode {
  if (preference === 'always-visible') return 'visible';
  if (preference === 'always-background') return 'background';
  return fullscreen ? 'background' : 'visible';
}

function infiniteWindow(): BrowserWindow | undefined {
  if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return undefined;
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
}

export function getAutomationDisplayState(): AutomationDisplayState {
  const configured = settings.get<AutomationDisplayPreference>('automationDisplayMode');
  const preference: AutomationDisplayPreference = configured === 'always-visible' || configured === 'always-background'
    ? configured
    : 'smart';
  const fullscreen = infiniteWindow()?.isFullScreen() ?? false;
  return { preference, fullscreen, mode: resolveAutomationDisplayMode(preference, fullscreen) };
}

export async function setAutomationDisplayPreference(preference: AutomationDisplayPreference, cwd: string): Promise<AutomationDisplayState> {
  await settings.set('user', 'automationDisplayMode', preference, cwd);
  return getAutomationDisplayState();
}

export function restoreInfiniteOsFocus(): void {
  const window = infiniteWindow();
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
