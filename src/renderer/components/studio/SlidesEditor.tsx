import { useEffect, useRef, useState } from 'react';
import type { StudioDeck, StudioItem, StudioSlide } from '../../../shared/studio';
import { newSlide } from '../../../shared/studio';
import { useStudioStore } from '../../stores/studio';
import { StudioIcon } from './Icons';
import './studio.css';

interface SlidesEditorProps {
  item: StudioItem;
}

export function SlidesEditor({ item }: SlidesEditorProps) {
  const initial = item.deck ?? { slides: [newSlide()] };
  const [slides, setSlides] = useState<StudioSlide[]>(initial.slides);
  const [selected, setSelected] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const localDeckRef = useRef<StudioDeck>(initial);
  const loadedIdRef = useRef(item.id);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<StudioSlide[] | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const next = item.deck ?? { slides: [newSlide()] };
    if (item.id !== loadedIdRef.current) {
      loadedIdRef.current = item.id;
      localDeckRef.current = next;
      setSlides(next.slides);
      setSelected(0);
      setPresenting(false);
      return;
    }
    if (sameDeck(next, localDeckRef.current)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    localDeckRef.current = next;
    setSlides(next.slides);
    setSelected((index) => Math.min(index, Math.max(0, next.slides.length - 1)));
  }, [item.id, item.deck, item.updatedAt]);

  useEffect(() => {
    const timer = timerRef;
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pendingRef.current) {
        const slidesToSave = pendingRef.current;
        pendingRef.current = null;
        void useStudioStore.getState().update(item.id, { deck: { slides: slidesToSave } });
      }
    };
  }, [item.id]);

  useEffect(() => {
    const title = titleRef.current;
    if (title) {
      title.style.height = 'auto';
      title.style.height = `${title.scrollHeight}px`;
    }
    const body = bodyRef.current;
    if (body) {
      body.style.height = 'auto';
      body.style.height = `${body.scrollHeight}px`;
    }
  }, [slides, selected, showNotes]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPresenting(false);
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
        event.preventDefault();
        setSelected((index) => Math.min(slides.length - 1, index + 1));
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setSelected((index) => Math.max(0, index - 1));
      }
      if (event.key === 'Home') setSelected(0);
      if (event.key === 'End') setSelected(slides.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, slides.length]);

  const flush = (next: StudioSlide[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = next;
    timerRef.current = setTimeout(() => {
      const payload = pendingRef.current;
      if (!payload) return;
      pendingRef.current = null;
      localDeckRef.current = { slides: payload };
      saveQueue.current = saveQueue.current
        .then(() => useStudioStore.getState().update(item.id, { deck: { slides: payload } }))
        .catch(() => undefined);
    }, 550);
  };

  const commit = (next: StudioSlide[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    setSlides(next);
    localDeckRef.current = { slides: next };
    saveQueue.current = saveQueue.current
      .then(() => useStudioStore.getState().update(item.id, { deck: { slides: next } }))
      .catch(() => undefined);
  };

  const patchSlide = (index: number, patch: Partial<StudioSlide>) => {
    const next = slides.map((slide, slideIndex) => (slideIndex === index ? { ...slide, ...patch } : slide));
    setSlides(next);
    flush(next);
  };

  const addSlide = () => {
    const slide = newSlide();
    const next = [...slides.slice(0, selected + 1), slide, ...slides.slice(selected + 1)];
    commit(next);
    setSelected(selected + 1);
  };

  const duplicateSlide = () => {
    const source = slides[selected];
    if (!source) return;
    const copy = { ...source, id: newSlide().id };
    const next = [...slides.slice(0, selected + 1), copy, ...slides.slice(selected + 1)];
    commit(next);
    setSelected(selected + 1);
  };

  const removeSlide = () => {
    if (slides.length <= 1) return;
    const next = slides.filter((_slide, index) => index !== selected);
    commit(next);
    setSelected(Math.max(0, Math.min(selected, next.length - 1)));
  };

  const moveSlide = (delta: number) => {
    const target = selected + delta;
    if (target < 0 || target >= slides.length) return;
    const next = [...slides];
    [next[selected], next[target]] = [next[target], next[selected]];
    commit(next);
    setSelected(target);
  };

  const current = slides[selected] ?? slides[0];

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[184px] shrink-0 flex-col border-r border-white/[0.06] bg-[#101015]/70">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {slides.length} {slides.length === 1 ? 'slide' : 'slides'}
          </span>
          <button
            type="button"
            onClick={addSlide}
            title="Add slide"
            className="grid h-6 w-6 place-items-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <StudioIcon name="plus" size={14} />
          </button>
        </div>
        <div className="studio-scroll min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-4">
          {slides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setSelected(index)}
              className={`group relative block w-full overflow-hidden rounded-lg border text-left transition-all ${
                index === selected
                  ? 'border-violet-400/70 bg-white/[0.05] shadow-[0_0_0_1px_rgba(139,92,246,0.3)]'
                  : 'border-white/[0.07] bg-white/[0.02] hover:border-white/[0.14]'
              }`}
            >
              <span className="absolute left-1 top-1 z-10 rounded bg-black/50 px-1 py-0.5 text-[9px] font-medium text-zinc-400">
                {index + 1}
              </span>
              <div className="aspect-video w-full bg-gradient-to-br from-[#1c1c26] to-[#111117] px-3 py-3">
                <div className="line-clamp-2 text-[10.5px] font-semibold leading-tight text-zinc-200">
                  {slide.title || 'Untitled slide'}
                </div>
                <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-[8.5px] leading-snug text-zinc-500">
                  {slide.body || ' '}
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 border-t border-white/[0.06] px-2 py-2">
          <IconAction label="Move up" icon="arrow-up" onClick={() => moveSlide(-1)} disabled={selected === 0} />
          <IconAction label="Move down" icon="arrow-down" onClick={() => moveSlide(1)} disabled={selected === slides.length - 1} />
          <IconAction label="Duplicate" icon="copy" onClick={duplicateSlide} />
          <IconAction label="Delete" icon="trash" onClick={removeSlide} disabled={slides.length <= 1} danger />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#101015]/80 px-4 py-2 backdrop-blur-xl">
          <span className="text-[11px] text-zinc-500">Slide {selected + 1} of {slides.length}</span>
          <span className="mx-1 h-5 w-px bg-white/[0.07]" />
          <button
            type="button"
            onClick={() => setShowNotes((value) => !value)}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
              showNotes ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
            }`}
          >
            Speaker notes
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPresenting(true)}
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-white/[0.08]"
            >
              <StudioIcon name="play" size={12} /> Present
            </button>
          </div>
        </div>

        <div className="studio-scroll min-h-0 flex-1 overflow-y-auto bg-[radial-gradient(1000px_400px_at_50%_-10%,rgba(139,92,246,0.05),transparent_70%),#0d0d12] px-6 py-8">
          <div className="mx-auto w-full max-w-[900px]">
            <div className="slide-canvas relative flex flex-col px-[7%] py-[6%]">
              <textarea
                ref={titleRef}
                rows={1}
                value={current?.title ?? ''}
                onChange={(event) => patchSlide(selected, { title: event.target.value.slice(0, 300) })}
                placeholder="Slide title"
                className="slide-title-input text-[clamp(22px,3.2vw,40px)] font-semibold leading-[1.12] tracking-[-0.025em] text-white"
              />
              <div className="my-[5%] h-px w-16 bg-gradient-to-r from-[color:var(--os-accent)] to-transparent opacity-70" />
              <textarea
                ref={bodyRef}
                value={current?.body ?? ''}
                onChange={(event) => patchSlide(selected, { body: event.target.value.slice(0, 20_000) })}
                placeholder={'Write the point of this slide.\nStart lines with • for bullets.'}
                className="slide-body-input text-[clamp(13px,1.45vw,18px)] text-zinc-300"
              />
              <span className="absolute bottom-4 right-5 text-[10px] tabular-nums text-zinc-600">
                {String(selected + 1).padStart(2, '0')}
              </span>
            </div>

            {showNotes && (
              <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.025] p-4">
                <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  <StudioIcon name="file" size={12} /> Speaker notes
                </div>
                <textarea
                  value={current?.notes ?? ''}
                  onChange={(event) => patchSlide(selected, { notes: event.target.value.slice(0, 8_000) })}
                  placeholder="What you want to say while this slide is on screen."
                  rows={3}
                  className="w-full resize-y bg-transparent text-[12.5px] leading-relaxed text-zinc-300 outline-none placeholder:text-zinc-600"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {presenting && current && (
        <div className="present-stage fixed inset-0 z-[80] flex flex-col items-center justify-center outline-none" tabIndex={0}>
          <div className="present-slide flex flex-col justify-center overflow-y-auto px-[7%] py-[6%]">
            <h1 className="present-slide-title text-white">{current.title || 'Untitled slide'}</h1>
            <div className="my-6 h-px w-24 bg-gradient-to-r from-[color:var(--os-accent)] to-transparent opacity-80" />
            <p className="present-slide-body">{current.body}</p>
          </div>
          <div className="mt-5 flex items-center gap-5 text-[12px] text-zinc-500">
            <button
              type="button"
              onClick={() => setSelected((index) => Math.max(0, index - 1))}
              disabled={selected === 0}
              className="rounded-lg p-2 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
              aria-label="Previous slide"
            >
              <StudioIcon name="chevron-left" size={18} />
            </button>
            <span className="tabular-nums">{selected + 1} / {slides.length}</span>
            <button
              type="button"
              onClick={() => setSelected((index) => Math.min(slides.length - 1, index + 1))}
              disabled={selected === slides.length - 1}
              className="rounded-lg p-2 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-30"
              aria-label="Next slide"
            >
              <StudioIcon name="chevron-right" size={18} />
            </button>
            <span className="ml-4 text-zinc-700">Esc to exit · ← → to move</span>
          </div>
          <button
            type="button"
            onClick={() => setPresenting(false)}
            className="absolute right-5 top-5 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label="Exit present mode"
          >
            <StudioIcon name="x" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}

function IconAction({
  label,
  icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: 'arrow-up' | 'arrow-down' | 'copy' | 'trash';
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.07] disabled:opacity-25 ${
        danger ? 'hover:text-rose-400' : 'hover:text-zinc-100'
      }`}
    >
      <StudioIcon name={icon} size={14} />
    </button>
  );
}

function sameDeck(a: StudioDeck, b: StudioDeck): boolean {
  if (a.slides.length !== b.slides.length) return false;
  return a.slides.every((slide, index) => {
    const other = b.slides[index];
    return other && slide.id === other.id && slide.title === other.title && slide.body === other.body && slide.notes === other.notes;
  });
}
