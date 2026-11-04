import { describe, expect, it } from 'vitest';
import { bridgeServer } from './server.js';
import { ensureBrowserReady, installBridgeExtension, buildStatus } from './extension-setup.js';

// Live validation only — launches the dedicated Infinite OS Chrome profile.
// Run with INFINITE_LIVE=1; skipped in normal CI.
const live = process.env.INFINITE_LIVE === '1';

describe.skipIf(!live)('live: browser bridge auto-connect', () => {
  it('installs, launches, connects, survives a bridge restart, and drives a page', async () => {
    const installed = installBridgeExtension();
    expect(installed.ok).toBe(true);

    await bridgeServer.start();
    const first = await ensureBrowserReady({ launch: true });
    await new Promise((r) => setTimeout(r, 1_000));
    const firstStatus = await buildStatus();
    console.log('LIVE_FIRST', JSON.stringify({ ...firstStatus, ...first }, null, 2));
    expect(firstStatus.bridgeConnected).toBe(true);
    expect(firstStatus.bridgeConnections).toBeGreaterThanOrEqual(1);

    // Simulate an app restart: the bridge goes away while the browser stays
    // open. The extension's MV3 worker may be asleep, so ensureBrowserReady
    // must be able to wake it over CDP instead of waiting for its 30s alarm.
    bridgeServer.stop();
    await new Promise((r) => setTimeout(r, 3_000));
    await bridgeServer.start();
    const second = await ensureBrowserReady({ launch: false });
    await new Promise((r) => setTimeout(r, 1_000));
    const secondStatus = await buildStatus();
    console.log('LIVE_RECONNECT', JSON.stringify({ ...second, ...secondStatus }, null, 2));
    expect(secondStatus.bridgeConnected).toBe(true);
    expect(secondStatus.bridgeConnections).toBeGreaterThanOrEqual(1);

    const nav = await bridgeServer.exec('navigate', { url: 'https://example.com' });
    console.log('LIVE_NAV', JSON.stringify(nav));
    expect(nav.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 4_000));

    const text = await bridgeServer.exec('get_page_text', {});
    console.log('LIVE_TEXT', JSON.stringify(text).slice(0, 800));
    expect(text.ok).toBe(true);
    const extracted = 'data' in text ? String((text.data as { text?: string })?.text ?? '') : '';
    expect(extracted.length).toBeGreaterThan(50);
  }, 120_000);
});
