import { useEffect, useState } from 'react';
import { useNotificationStore } from '../../stores/notifications';

export function ComputerControlView() {
  const addToast = useNotificationStore((state) => state.addToast);
  const [live, setLive] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [status, setStatus] = useState('Stopped');
  const [app, setApp] = useState('chrome');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!live) {
      setStatus('Stopped');
      return;
    }
    let cancelled = false;
    let capturing = false;
    const capture = async () => {
      if (cancelled || capturing) return;
      capturing = true;
      try {
        const result = await window.api.computerLiveFrame() as { base64?: string; error?: string };
        if (!cancelled && result.base64) {
          setFrame(`data:image/png;base64,${result.base64}`);
          setStatus('Live');
        } else if (!cancelled && result.error) setStatus(result.error);
      } catch (error) {
        if (!cancelled) setStatus((error as Error).message);
      } finally {
        capturing = false;
      }
    };
    void capture();
    const timer = window.setInterval(() => void capture(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live]);

  const openApp = async (name = app) => {
    const result = await window.api.computerOpenApp({ name }) as { ok?: boolean; error?: string };
    addToast({ type: result.ok === false ? 'error' : 'success', title: result.ok === false ? result.error || 'Could not open app' : `Opened ${name}` });
  };

  const typeText = async () => {
    if (!text) return;
    await window.api.computerTypeText({ text, delay: 8 });
    setText('');
    addToast({ type: 'success', title: 'Typed into the active application' });
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in bg-[#09090c]">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Computer</h1>
          <p className="text-sm text-zinc-500 mt-1">Observe and control the Windows desktop while Infinite OS remains open.</p>
        </div>
        <button
          onClick={() => setLive((value) => !value)}
          className={`rounded-lg border px-3 py-2 text-xs ${live ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-zinc-300'}`}
        >
          {live ? 'Stop live view' : 'Start live view'}
        </button>
      </div>

      <div className="relative aspect-video max-h-[58vh] rounded-xl border border-white/[0.08] bg-black/40 overflow-hidden flex items-center justify-center">
        {frame ? <img src={frame} alt="Live Windows desktop" className="w-full h-full object-contain" /> : <span className="text-xs text-zinc-600">Live desktop is stopped</span>}
        <span className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[10px] text-zinc-300">{status}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Application and keyboard</h2>
          <div className="flex gap-2">
            <input value={app} onChange={(event) => setApp(event.target.value)} className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none" placeholder="Application name or path" />
            <button onClick={() => void openApp()} className="rounded-lg bg-indigo-500 px-3 py-2 text-xs text-white">Open</button>
          </div>
          <div className="flex gap-2 mt-2">
            <input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void typeText()} className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none" placeholder="Type into active application" />
            <button onClick={() => void typeText()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-200">Type</button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {['chrome', 'cmd', 'powershell', 'notepad', 'code', 'explorer'].map((name) => (
              <button key={name} onClick={() => void openApp(name)} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-400 hover:text-white">{name}</button>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
          <h2 className="text-sm font-semibold text-white mb-3">Mouse and hotkeys</h2>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void window.api.computerClick({ x: 640, y: 360, button: 'left' })} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Click center</button>
            <button onClick={() => void window.api.computerHotkey({ keys: ['alt', 'tab'] })} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Alt+Tab</button>
            <button onClick={() => void window.api.computerHotkey({ keys: ['ctrl', 'l'] })} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Ctrl+L</button>
            <button onClick={() => void window.api.computerPressKey({ key: 'enter' })} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Enter</button>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-zinc-600">Chat-driven Operator uses desktop state, screenshots, CDP, and precise mouse/keyboard actions automatically.</p>
        </section>
      </div>
    </div>
  );
}
