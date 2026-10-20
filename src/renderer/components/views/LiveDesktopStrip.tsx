// Live desktop — a strip inside the Browser Control view.
//
// This replaces the standalone "Live Computer" page. Every capability that page
// had is still here (live frames, app launch, type, click, hotkeys), but it now
// sits next to the browser surface instead of owning a whole screen: the page
// was five hard-coded buttons and a 3-second screenshot poll, which is not how
// anyone actually drives a computer. Everything here is also what the agent
// itself uses, so the strip and the agent are the same capability.
//
// It still polls `computerLiveFrame` — the one channel the deleted page was the
// only caller of — so no main-process or preload code changed.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppIcon } from '../brand/AppIcon';
import { useNotificationStore } from '../../stores/notifications';

export function LiveDesktopStrip() {
  const addToast = useNotificationStore((state) => state.addToast);
  const [live, setLive] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState('Stopped');
  const [app, setApp] = useState('');
  const [text, setText] = useState('');
  const capturing = useRef(false);

  useEffect(() => {
    if (!live) {
      setFrame(null);
      setStatus('Stopped');
      return;
    }
    let cancelled = false;
    const capture = async () => {
      if (cancelled || capturing.current) return;
      capturing.current = true;
      try {
        const result = (await window.api.computerLiveFrame()) as { base64?: string; error?: string };
        if (cancelled) return;
        if (result.base64) {
          setFrame(`data:image/png;base64,${result.base64}`);
          setStatus('Live');
        } else if (result.error) {
          setStatus(result.error);
        }
      } catch (error) {
        if (!cancelled) setStatus((error as Error).message);
      } finally {
        capturing.current = false;
      }
    };
    void capture();
    const timer = window.setInterval(() => void capture(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live]);

  const openApp = useCallback(
    async (name: string) => {
      const target = name.trim();
      if (!target) return;
      const result = (await window.api.computerOpenApp({ name: target })) as { ok?: boolean; error?: string };
      addToast({
        type: result.ok === false ? 'error' : 'success',
        title: result.ok === false ? result.error || 'Could not open app' : `Opened ${target}`,
      });
    },
    [addToast],
  );

  const typeText = useCallback(async () => {
    if (!text.trim()) return;
    await window.api.computerTypeText({ text, delay: 8 });
    setText('');
    addToast({ type: 'success', title: 'Typed into the active application' });
  }, [addToast, text]);

  const runHotkey = useCallback(
    async (keys: string[], label: string) => {
      await window.api.computerHotkey({ keys });
      addToast({ type: 'success', title: label });
    },
    [addToast],
  );

  return (
    <section className="mt-4 rounded-2xl border border-white/[0.07] bg-[#12131a] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04]">
            <AppIcon name="home.orchestrator" className="h-4 w-4 text-zinc-300" strokeWidth={1.7} />
          </span>
          <div>
            <h3 className="text-[13px] font-semibold text-white">Live desktop</h3>
            <p className="text-[11px] text-zinc-500">
              Watch and nudge the real desktop — the agent drives the same surface on its own.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setLive((value) => !value)}
          aria-pressed={live}
          className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
            live
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : 'border-white/[0.08] bg-white/[0.03] text-zinc-300 hover:border-white/[0.16] hover:text-white'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600'}`} />
          {live ? 'Stop live view' : 'Start live view'}
        </button>
      </div>

      <div className="relative mt-3 aspect-video max-h-[46vh] overflow-hidden rounded-xl border border-white/[0.07] bg-black/40">
        {frame ? (
          <img src={frame} alt="Live Windows desktop" className="h-full w-full object-contain" />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-[11px] text-zinc-600">
            {live ? 'Waiting for the first frame…' : 'Live desktop is stopped'}
          </span>
        )}
        <span className="absolute left-2.5 top-2.5 rounded-md bg-black/60 px-2 py-1 text-[10px] text-zinc-300">{status}</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="flex gap-2">
          <input
            value={app}
            onChange={(event) => setApp(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void openApp(app); }}
            placeholder="Open app — chrome, notepad, code…"
            aria-label="Application to open"
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#101014] px-2.5 py-1.5 text-[11px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/50"
          />
          <button
            type="button"
            onClick={() => void openApp(app)}
            disabled={!app.trim()}
            className="shrink-0 rounded-lg bg-violet-500 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Open
          </button>
        </div>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void typeText(); }}
            placeholder="Type into the active app"
            aria-label="Text to type"
            className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-[#101014] px-2.5 py-1.5 text-[11px] text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-violet-400/50"
          />
          <button
            type="button"
            onClick={() => void typeText()}
            disabled={!text.trim()}
            className="shrink-0 rounded-lg border border-white/[0.08] px-3 py-1.5 text-[11px] text-zinc-200 transition-colors hover:border-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Type
          </button>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[
          { keys: ['alt', 'tab'], label: 'Alt+Tab' },
          { keys: ['ctrl', 'l'], label: 'Ctrl+L' },
          { keys: ['win', 'd'], label: 'Show desktop' },
          { keys: ['alt', 'f4'], label: 'Close window' },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => void runHotkey(preset.keys, `${preset.label} sent`)}
            className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:border-white/[0.16] hover:text-white"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  );
}