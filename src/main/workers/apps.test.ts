import { describe, expect, it } from 'vitest';
import { APP_CATALOG, installApp, isValidWingetId, launchApp, searchCatalog } from './apps.js';

describe('winget app catalog', () => {
  it('accepts every catalog package ID unchanged', () => {
    for (const app of APP_CATALOG) {
      expect(isValidWingetId(app.wingetId), app.wingetId).toBe(true);
    }
  });

  it('rejects anything that is not a plain package ID (no shell string ever forms)', () => {
    for (const bad of ['Google.Chrome; rm -rf C:\\', 'a b', '"Google.Chrome"', '', '   ', 'id\r\n/x', 42, null, undefined]) {
      expect(isValidWingetId(bad)).toBe(false);
    }
  });

  it('searches name, publisher, description and ID, and marks installed apps', () => {
    const chrome = searchCatalog('chrome', [{ name: 'Google Chrome', id: 'Chrome' }]);
    expect(chrome.map((app) => app.wingetId)).toContain('Google.Chrome');
    expect(chrome.find((app) => app.wingetId === 'Google.Chrome')?.installed).toBe(true);
    expect(searchCatalog('browser', []).length).toBeGreaterThan(0);
    expect(searchCatalog('zzz-no-such-app', [])).toEqual([]);
    expect(searchCatalog('', [])).toHaveLength(APP_CATALOG.length);
  });

  it('refuses to install a malformed ID before touching a process', async () => {
    await expect(installApp('not a package id')).rejects.toThrow(/Invalid winget package ID/);
  });

  it('refuses to launch an app ID containing quotes or newlines', () => {
    // The valid path actually spawns explorer, so only the guards are exercised here.
    expect(launchApp('evil" & calc').ok).toBe(false);
    expect(launchApp('evil\n& calc').ok).toBe(false);
    expect(launchApp('   ').ok).toBe(false);
    expect(launchApp('x'.repeat(500)).ok).toBe(false);
  });
});
