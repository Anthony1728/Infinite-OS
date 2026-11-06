import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHomePinsStore, currentPinsKey, type HomePin } from '../../stores/homePins';
import { useAuthStore } from '../../stores/auth';

interface FileReadResult {
  type?: 'file' | 'directory';
  content?: string;
  isBinary?: boolean;
  error?: string;
}

interface PreviewState {
  text: string;
  error: string | null;
  loading: boolean;
}

const PREVIEW_LIMIT = 12_000;

/** Light markdown cleanup so the card reads like a note, not source code. */
function previewText(markdown: string): string {
  return markdown
    .replace(/```[\w-]*\n?/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .trim();
}

function PinCard({ pin }: { pin: HomePin }) {
  const removePin = useHomePinsStore((s) => s.removePin);
  const movePin = useHomePinsStore((s) => s.movePin);
  const toggleExpanded = useHomePinsStore((s) => s.toggleExpanded);
  const [preview, setPreview] = useState<PreviewState>({ text: '', error: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      const result = (await window.api.fileRead({ path: pin.path })) as FileReadResult;
      if (result.error) {
        setPreview({ text: '', error: result.error, loading: false });
        return;
      }
      if (result.type === 'directory') {
        setPreview({ text: '', error: 'This pin points at a folder, not a file.', loading: false });
        return;
      }
      if (result.isBinary) {
        setPreview({ text: '', error: 'Binary file — preview unavailable.', loading: false });
        return;
      }
      setPreview({
        text: previewText(String(result.content ?? '')).slice(0, PREVIEW_LIMIT),
        error: null,
        loading: false,
      });
    } catch {
      setPreview({ text: '', error: 'Could not read this file.', loading: false });
    }
  }, [pin.path]);

  useEffect(() => {
    setPreview({ text: '', error: null, loading: true });
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 25_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return (
    <article
      className={`group relative flex flex-col rounded-2xl border border-white/[0.07] bg-[#12131a] p-4 transition-colors hover:border-white/[0.13] ${
        pin.expanded ? 'lg:col-span-2' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[12px] font-semibold text-zinc-100" title={pin.path}>{pin.title}</h3>
          <p className="mt-0.5 truncate font-mono text-[9.5px] text-zinc-600" title={pin.path}>{pin.path}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            onClick={() => movePin(pin.id, -1)}
            aria-label="Move pin earlier"
            title="Move earlier"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => movePin(pin.id, 1)}
            aria-label="Move pin later"
            title="Move later"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => toggleExpanded(pin.id)}
            aria-label={pin.expanded ? 'Make pin compact' : 'Make pin tall'}
            title={pin.expanded ? 'Compact' : 'Tall'}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              {pin.expanded
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 8.25 12 15.75l7.5-7.5" />}
            </svg>
          </button>
          <button
            type="button"
            onClick={() => removePin(pin.id)}
            aria-label={`Unpin ${pin.title}`}
            title="Unpin"
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-600 hover:bg-rose-500/10 hover:text-rose-300"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className={`mt-2 overflow-hidden ${pin.expanded ? 'max-h-[26rem]' : 'max-h-36'}`}>
        {preview.loading ? (
          <div className="space-y-2">
            <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.05]" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-white/[0.04]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/[0.03]" />
          </div>
        ) : preview.error ? (
          <p className="text-[11px] leading-4 text-amber-300/80">{preview.error}</p>
        ) : preview.text ? (
          <p className="whitespace-pre-wrap break-words text-[11.5px] leading-[1.55] text-zinc-400">{preview.text}</p>
        ) : (
          <p className="text-[11px] text-zinc-600">Empty file. Nothing to preview yet.</p>
        )}
      </div>

      {preview.text.length >= PREVIEW_LIMIT && (
        <p className="mt-2 text-[9.5px] text-zinc-600">Preview stops at {PREVIEW_LIMIT.toLocaleString()} characters — the file itself is untouched.</p>
      )}
    </article>
  );
}

export function HomePins() {
  const storedPins = useHomePinsStore((s) => s.pins);
  const storageKey = useHomePinsStore((s) => s.storageKey);
  const load = useHomePinsStore((s) => s.load);
  const addPin = useHomePinsStore((s) => s.addPin);
  const userId = useAuthStore((s) => s.user?.id ?? 'local');
  // A profile switch must never leave the previous account's cards on screen.
  // If the key no longer matches the live profile/workspace, render nothing
  // until load() refreshes the list.
  const activeKey = currentPinsKey();
  const pins = useMemo(
    () => (storageKey === activeKey ? storedPins : []),
    [storageKey, activeKey, storedPins],
  );
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, [load, userId]);

  // Workspace changes live in localStorage rather than a store; refresh on
  // focus so the cards follow the active workspace without a reload.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  useEffect(() => {
    if (!adding) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    let cancelled = false;
    void (async () => {
      try {
        const result = (await window.api.indexSearch({ query: '.md', limit: 12 })) as {
          ok: boolean;
          results?: Array<{ file: { path: string } }>;
        };
        if (cancelled) return;
        const found = (result.results ?? [])
          .map((row) => row.file?.path)
          .filter((value): value is string => Boolean(value));
        setSuggestions(Array.from(new Set(found)).slice(0, 8));
      } catch { /* suggestions are optional */ }
    })();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [adding]);

  const suggestionList = useMemo(() => suggestions.filter((item) => !pins.some((pin) => pin.path === item)), [suggestions, pins]);

  const commit = async () => {
    const clean = path.trim();
    if (!clean) return;
    setError('');
    try {
      const result = (await window.api.fileRead({ path: clean })) as FileReadResult;
      if (result.error) { setError(result.error); return; }
      if (result.type === 'directory') { setError('Pick a file, not a folder.'); return; }
      if (result.isBinary) { setError('That file is binary — pin a text or markdown file.'); return; }
      addPin(clean);
      setPath('');
      setAdding(false);
    } catch {
      setError('Could not read that path.');
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="micro-label">Pinned</span>
          <span className="text-[11px] text-zinc-600">
            {pins.length === 0 ? 'Live previews of notes and docs' : `${pins.length} card${pins.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => { setAdding((value) => !value); setError(''); }}
          className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-white/[0.16] hover:bg-white/[0.06]"
        >
          {adding ? 'Close' : '+ Pin a file'}
        </button>
      </div>

      {adding && (
        <div className="mb-3 rounded-2xl border border-white/[0.08] bg-[#12131a] p-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              value={path}
              onChange={(event) => { setPath(event.target.value); setError(''); }}
              onKeyDown={(event) => { if (event.key === 'Enter') void commit(); if (event.key === 'Escape') setAdding(false); }}
              placeholder="Path to a markdown or text file"
              aria-label="File path to pin"
              list="home-pin-suggestions"
              className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-[11px] text-white placeholder:font-sans placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
            />
            <datalist id="home-pin-suggestions">
              {suggestionList.map((item) => <option key={item} value={item} />)}
            </datalist>
            <button
              type="button"
              onClick={() => void commit()}
              disabled={!path.trim()}
              className="rounded-xl bg-white px-3 py-2 text-[12px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-40"
            >
              Pin
            </button>
          </div>
          {suggestionList.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {suggestionList.slice(0, 4).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setPath(item)}
                  className="max-w-[22rem] truncate rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-zinc-400 transition-colors hover:border-white/[0.14] hover:text-zinc-200"
                  title={item}
                >
                  {item.split(/[\\/]/).pop()}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mt-2 text-[11px] text-amber-300/90">{error}</p>}
        </div>
      )}

      {pins.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] px-4 py-5">
          <p className="text-[12px] text-zinc-500">Pin a note, a brief, or any markdown file. The card reads the file live — editing the source changes the card.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pins.map((pin) => <PinCard key={pin.id} pin={pin} />)}
        </div>
      )}
    </section>
  );
}
