// The in-app browser that backs a Tabs section.
//
// This is a real embedded browser, and it is genuinely inside Infinite OS.
//
// HOW IT WORKS
//
// The guest is a WebContentsView owned by the main process
// (src/main/tab-browser-view.ts) and attached as a child of the app window's
// contentView. This component owns no surface of its own — it renders the
// toolbar and measures the box the page should occupy, then reports that box to
// main, which sets the guest's bounds.
//
// The renderer deliberately does NOT own the guest. A <webview> was tried first
// and its viewport could not be corrected from this side: with the element at
// 846x473 and width/height attributes to match, the guest still reported
// 846x150 and painted only a band. Attributes set after attach are ignored, and
// a forced resize + reload did not help. With the bounds owned by main there is
// nothing to guess.
//
// Consequences that matter for this product:
//   * No Chrome window ever opens. Nothing appears over Infinite OS.
//   * `target=_blank` is trapped in-app, so a site cannot escape to the OS
//     browser either.
//   * The guest has its own session partition, so it gets no preload, no
//     contextBridge and no Node — a remote page cannot reach into the app.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiWorkspaceTab } from '../../stores/aiTabs';
import { useAiTabsStore } from '../../stores/aiTabs';

const HOME = 'about:blank';

/** Turn whatever the user typed into something loadable. */
export function normaliseBrowserInput(raw: string): string {
  const value = raw.trim();
  if (!value) return HOME;
  if (/^(https?|file|about|data|blob):/i.test(value)) return value;
  if (/^localhost(:\d+)?(\/|$)/i.test(value)) return `http://${value}`;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(value)) return `https://${value}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

function isDisplayable(url: string): boolean {
  return !!url && url !== HOME && url !== 'about:srcdoc';
}

export interface TabBrowserState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  error: string | null;
}

interface TabBrowserApi {
  tabBrowserCreate(args: { viewId: string; url: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<{ ok: boolean; error?: string; state?: TabBrowserState }>;
  tabBrowserBounds(args: { viewId: string; bounds: { x: number; y: number; width: number; height: number } }): Promise<{ ok: boolean }>;
  tabBrowserNavigate(args: { viewId: string; url: string }): Promise<{ ok: boolean; error?: string }>;
  tabBrowserBack(args: { viewId: string }): Promise<{ ok: boolean }>;
  tabBrowserForward(args: { viewId: string }): Promise<{ ok: boolean }>;
  tabBrowserReload(args: { viewId: string }): Promise<{ ok: boolean }>;
  tabBrowserState(args: { viewId: string }): Promise<{ ok: boolean; state?: TabBrowserState }>;
  tabBrowserClose(args: { viewId: string }): Promise<{ ok: boolean }>;
  onTabBrowserEvent(cb: (payload: { viewId: string } & Partial<TabBrowserState>) => void): () => void;
}

function api(): TabBrowserApi {
  return (window as unknown as { api: TabBrowserApi }).api;
}

const EMPTY: TabBrowserState = { url: HOME, title: '', canGoBack: false, canGoForward: false, loading: true, error: null };

export function TabBrowser({ tab, embedded }: { tab: AiWorkspaceTab; embedded?: boolean }) {
  const updateTab = useAiTabsStore((s) => s.updateTab);

  const metaUrl = (tab.metadata as Record<string, unknown> | undefined)?.browserUrl as string | undefined;
  const htmlUrl =
    typeof tab.htmlContent === 'string' && /^(https?|file):/i.test(tab.htmlContent.trim())
      ? tab.htmlContent.trim()
      : undefined;
  const startUrl = normaliseBrowserInput(metaUrl || htmlUrl || HOME);

  const viewId = `tabview:${tab.id}`;
  const [state, setState] = useState<TabBrowserState>({ ...EMPTY, url: startUrl, title: tab.title });
  const [inputUrl, setInputUrl] = useState(startUrl);
  const [ready, setReady] = useState(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastActionAt = useRef<number>(0);
  const requestedUrl = useRef<string>(startUrl);

  // ── Measure and report bounds ────────────────────────────────────────────
  // The guest is positioned by main, so this box is the single source of truth
  // for where the page lives. It is reported on mount, on every resize, and on
  // window resize/scroll (the window is frameless, so there is no scrollbar
  // event, but a maximized-window change does move everything).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    let disposed = false;

    const report = async () => {
      if (disposed || !ready) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      await api()
        .tabBrowserBounds({
          viewId,
          bounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        })
        .catch(() => undefined);
    };

    const create = async () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      const result = await api()
        .tabBrowserCreate({
          viewId,
          url: requestedUrl.current,
          bounds: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        })
        .catch(() => null);
      if (disposed) return;
      if (result?.ok) {
        setReady(true);
        if (result.state) setState(result.state);
      } else {
        // Not yet laid out — try again on the next resize.
        setReady(false);
      }
    };

    void create();

    const onWindowResize = () => {
      if (ready) void report();
    };
    window.addEventListener('resize', onWindowResize);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        if (ready) void report();
        else void create();
      });
      observer.observe(el);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', onWindowResize);
      void api().tabBrowserClose({ viewId }).catch(() => undefined);
    };
  }, [viewId, ready]);

  // ── Main pushes guest state ──────────────────────────────────────────────
  useEffect(() => {
    const dispose = api().onTabBrowserEvent((payload) => {
      if (payload.viewId !== viewId) return;
      setState((prev) => ({
        url: payload.url ?? prev.url,
        title: payload.title ?? prev.title,
        canGoBack: payload.canGoBack ?? prev.canGoBack,
        canGoForward: payload.canGoForward ?? prev.canGoForward,
        loading: payload.loading ?? prev.loading,
        error: payload.error === undefined ? prev.error : payload.error,
      }));
      if (payload.url && payload.url !== requestedUrl.current) {
        setInputUrl(payload.url);
        // Keep the stored URL truthful so the AI and Artifacts can see it.
        updateTab(tab.id, { metadata: { ...(tab.metadata || {}), browserUrl: payload.url } });
      }
    });
    return dispose;
  }, [viewId, tab.id, tab.metadata, updateTab]);

  const load = useCallback(
    (target: string) => {
      const next = normaliseBrowserInput(target);
      requestedUrl.current = next;
      setInputUrl(next);
      setState((prev) => ({ ...prev, url: next, loading: true, error: null }));
      updateTab(tab.id, { metadata: { ...(tab.metadata || {}), browserUrl: next } });
      void api().tabBrowserNavigate({ viewId, url: next }).catch(() => undefined);
    },
    [viewId, tab.id, tab.metadata, updateTab],
  );

  // ── AI navigation ────────────────────────────────────────────────────────
  // The agent drives this tab by writing browserUrl / browserAction onto it.
  // That contract is unchanged; it now drives a real browser.
  useEffect(() => {
    const meta = tab.metadata as Record<string, unknown> | undefined;
    const target = (meta?.browserUrl as string | undefined) ?? htmlUrl;
    if (ready && target && normaliseBrowserInput(target) !== requestedUrl.current) load(target);

    const action = meta?.browserAction as string | undefined;
    const at = meta?.at as number | undefined;
    if (!ready || !action || !at || at === lastActionAt.current) return;
    lastActionAt.current = at;
    if (action === 'back') void api().tabBrowserBack({ viewId }).catch(() => undefined);
    else if (action === 'forward') void api().tabBrowserForward({ viewId }).catch(() => undefined);
    else if (action === 'reload') void api().tabBrowserReload({ viewId }).catch(() => undefined);
  }, [tab.metadata, htmlUrl, load, ready, viewId]);

  const goBack = useCallback(() => void api().tabBrowserBack({ viewId }).catch(() => undefined), [viewId]);
  const goForward = useCallback(() => void api().tabBrowserForward({ viewId }).catch(() => undefined), [viewId]);
  const reload = useCallback(() => void api().tabBrowserReload({ viewId }).catch(() => undefined), [viewId]);

  return (
    <div
      className={
        embedded
          ? 'rounded-xl overflow-hidden border border-white/[0.07] bg-[#0c1018]'
          : 'flex min-h-0 flex-1 flex-col bg-[#0c1018]'
      }
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-[#0b1018] px-2 py-2">
        <button
          onClick={goBack}
          disabled={!state.canGoBack}
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
          title="Back"
          aria-label="Back"
        >
          ‹
        </button>
        <button
          onClick={goForward}
          disabled={!state.canGoForward}
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
          title="Forward"
          aria-label="Forward"
        >
          ›
        </button>
        <button
          onClick={reload}
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
          title="Reload"
          aria-label="Reload"
        >
          ↻
        </button>

        <form
          className="flex flex-1 items-center gap-2 rounded-full border border-white/[0.07] bg-black/30 px-3 py-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            load(inputUrl);
          }}
        >
          <span
            className={`text-[10px] ${state.loading ? 'text-amber-400' : isDisplayable(state.url) ? 'text-emerald-400' : 'text-zinc-600'}`}
          >
            {state.loading ? '◐' : '●'}
          </span>
          <input
            value={inputUrl}
            onChange={(event) => setInputUrl(event.target.value)}
            placeholder="Search or enter a URL — stays inside Infinite OS"
            aria-label="Address"
            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-500"
          />
          <button type="submit" className="text-[10px] font-medium text-cyan-300 transition-colors hover:text-cyan-200">
            Go
          </button>
        </form>

        {isDisplayable(state.url) && (
          <span className="hidden shrink-0 items-center gap-1 rounded-full border border-white/[0.06] px-2 py-1 text-[10px] text-zinc-500 sm:inline">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            In-app
          </span>
        )}
      </div>

      {/*
        The page does NOT live inside this div — main paints it over this exact
        rectangle. It is measured and transparent so the guest lines up with the
        toolbar and the status bar.
      */}
      <div
        ref={surfaceRef}
        className={`relative shrink-0 overflow-hidden ${embedded ? 'h-[560px]' : 'min-h-[280px] flex-1'}`}
      >
        {!isDisplayable(state.url) && !state.error && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0c1018]">
            <div className="max-w-sm px-6 text-center">
              <p className="text-[13px] text-zinc-300">Nothing loaded yet</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                Type a URL above, or just ask the agent — it drives this browser and shows you the page
                here, without opening anything on Windows.
              </p>
            </div>
          </div>
        )}
        {state.error && (
          <div className="absolute inset-x-0 bottom-0 flex items-start gap-2 border-t border-rose-400/25 bg-[#1a0f14]/95 px-3 py-2 text-[11px] leading-relaxed text-rose-200">
            <span className="flex-1">{state.error}</span>
          </div>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.06] bg-[#0b1018] px-3 py-1.5">
        <span className="truncate text-[11px] text-zinc-500" title={state.title}>
          {state.title}
        </span>
        <span className="hidden shrink-0 text-[10px] text-zinc-600 sm:inline">
          Real browser · AI drives this tab · nothing opens outside Infinite OS
        </span>
      </div>
    </div>
  );
}

/** Convenience wrapper kept for the existing call sites in DynamicTabView. */
export function WebsiteBrowser({ tab, embedded }: { tab: AiWorkspaceTab; embedded?: boolean }) {
  return <TabBrowser tab={tab} embedded={embedded} />;
}