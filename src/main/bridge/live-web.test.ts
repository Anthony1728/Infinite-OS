import { describe, expect, it } from 'vitest';
import { bridgeServer } from './server.js';
import { ensureBrowserReady, installBridgeExtension, buildStatus } from './extension-setup.js';

// Live web validation — real network, real Chrome, real extension.
// Run with INFINITE_LIVE=1; skipped in normal CI.
const live = process.env.INFINITE_LIVE === '1';

type ExecResult = { ok: boolean; data?: unknown; error?: string };
const dataOf = <T>(result: ExecResult): T => result.data as T;

describe.skipIf(!live)('live: online search and navigation', () => {
  it('searches the web, reads results, follows a link, and navigates across sites', async () => {
    const installed = installBridgeExtension();
    expect(installed.ok).toBe(true);

    await bridgeServer.start();
    await ensureBrowserReady({ launch: true });
    await new Promise((r) => setTimeout(r, 1_500));
    const status = await buildStatus();
    expect(status.bridgeConnected).toBe(true);

    // 1. Load a real search engine.
    const search = await bridgeServer.exec('navigate', {
      url: 'https://duckduckgo.com/?q=Infinite+OS+AI+workspace&ia=web',
    });
    expect(search.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 4_000));

    // 2. Read the rendered results.
    const text = await bridgeServer.exec('get_page_text', {});
    console.log('LIVE_SEARCH_TEXT', JSON.stringify(text).slice(0, 600));
    expect(text.ok).toBe(true);
    const body = String(dataOf<{ text?: string }>(text)?.text ?? '');
    expect(body.length).toBeGreaterThan(200);
    expect(body.toLowerCase()).toMatch(/infinite|workspace|search/);

    // 3. Collect real links from the results page.
    const links = await bridgeServer.exec('get_page_links', {});
    expect(links.ok).toBe(true);
    const list = dataOf<{ links?: Array<{ text: string; href: string }> }>(links)?.links ?? [];
    console.log('LIVE_LINKS', list.length, list.slice(0, 5).map((l) => l.href).join(' | '));
    expect(list.length).toBeGreaterThan(0);

    // 4. Follow one real search result to prove link-driven navigation.
    const resultLink = list.find(
      (link) =>
        /^https?:\/\//i.test(link.href) &&
        !/duckduckgo\.com/i.test(link.href) &&
        !/\.(png|jpe?g|svg|gif|webp|css|js)(\?|$)/i.test(link.href),
    );
    expect(resultLink).toBeTruthy();
    console.log('LIVE_FOLLOW', resultLink?.href);
    const followed = await bridgeServer.exec('navigate', { url: resultLink!.href });
    expect(followed.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 4_000));
    const followedText = await bridgeServer.exec('get_page_text', {});
    expect(followedText.ok).toBe(true);
    expect(String(dataOf<{ text?: string }>(followedText)?.text ?? '').length).toBeGreaterThan(100);

    // 5. Interact with a search box on a real site: type, submit, read.
    const bing = await bridgeServer.exec('navigate', { url: 'https://www.bing.com/' });
    expect(bing.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 3_000));
    const typed = await bridgeServer.exec('type', {
      selector: 'textarea[name="q"], input[name="q"]',
      text: 'GitHub Infinite OS',
    });
    console.log('LIVE_TYPE', JSON.stringify(typed).slice(0, 300));
    expect(typed.ok).toBe(true);
    await bridgeServer.exec('press_enter', {});
    await new Promise((r) => setTimeout(r, 4_000));
    const results = await bridgeServer.exec('get_page_text', {});
    expect(results.ok).toBe(true);
    const resultsText = String(dataOf<{ text?: string }>(results)?.text ?? '');
    console.log('LIVE_BING_TEXT', resultsText.slice(0, 400));
    expect(resultsText.toLowerCase()).toContain('github');

    // 6. Navigate to a second real site and verify the page changed.
    const github = await bridgeServer.exec('navigate', { url: 'https://github.com' });
    expect(github.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 3_500));
    const ghText = await bridgeServer.exec('get_page_text', {});
    expect(ghText.ok).toBe(true);
    const ghBody = String(dataOf<{ text?: string }>(ghText)?.text ?? '');
    console.log('LIVE_GITHUB_TEXT', ghBody.slice(0, 300));
    expect(ghBody.toLowerCase()).toContain('github');

    const meta = await bridgeServer.exec('get_page_meta', {});
    console.log('LIVE_META', JSON.stringify(meta).slice(0, 400));
    expect(meta.ok).toBe(true);
  }, 180_000);
});
