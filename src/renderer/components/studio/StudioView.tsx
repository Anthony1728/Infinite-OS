import { useEffect, useMemo, useRef, useState } from 'react';
import type { StudioItem, StudioKind } from '../../../shared/studio';
import { STUDIO_KIND_LABEL } from '../../../shared/studio';
import { useStudioStore } from '../../stores/studio';
import { StudioIcon, type StudioIconName } from './Icons';
import { DocumentEditor } from './DocumentEditor';
import { SheetEditor } from './SheetEditor';
import { SlidesEditor } from './SlidesEditor';
import { StudioAiPanel } from './StudioAiPanel';
import { formatRelative } from './studioUtils';
import './studio.css';

const KIND_ICON: Record<StudioKind, StudioIconName> = {
  document: 'file',
  sheet: 'sheet',
  slides: 'slides',
};

const KIND_ACCENT: Record<StudioKind, string> = {
  document: 'from-violet-500/20 to-fuchsia-500/10 text-violet-300',
  sheet: 'from-emerald-500/20 to-teal-500/10 text-emerald-300',
  slides: 'from-amber-500/20 to-orange-500/10 text-amber-300',
};

const NEW_ITEMS: Array<{ kind: StudioKind; label: string; description: string }> = [
  { kind: 'document', label: 'Document', description: 'Write, edit, and export Word files' },
  { kind: 'sheet', label: 'Spreadsheet', description: 'Formulas, CSV import, Excel export' },
  { kind: 'slides', label: 'Deck', description: 'Build and present slide decks' },
];

type Filter = 'all' | StudioKind;

export function StudioView() {
  const items = useStudioStore((state) => state.items);
  const activeId = useStudioStore((state) => state.activeId);
  const loading = useStudioStore((state) => state.loading);
  const saving = useStudioStore((state) => state.saving);
  const load = useStudioStore((state) => state.load);
  const select = useStudioStore((state) => state.select);
  const create = useStudioStore((state) => state.create);
  const update = useStudioStore((state) => state.update);
  const remove = useStudioStore((state) => state.remove);
  const duplicate = useStudioStore((state) => state.duplicate);
  const exportItem = useStudioStore((state) => state.exportItem);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const active = items.find((item) => item.id === activeId) ?? null;

  useEffect(() => {
    setTitle(active?.title ?? '');
    setExportOpen(false);
    setMoreOpen(false);
    setConfirmDelete(false);
  }, [active?.id, active?.title]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => (filter === 'all' ? true : item.kind === filter))
      .filter((item) => !query || item.title.toLowerCase().includes(query))
      .sort((a, b) => Number(b.starred) - Number(a.starred) || b.updatedAt - a.updatedAt);
  }, [items, filter, search]);

  const counts = useMemo(
    () => ({
      all: items.length,
      document: items.filter((item) => item.kind === 'document').length,
      sheet: items.filter((item) => item.kind === 'sheet').length,
      slides: items.filter((item) => item.kind === 'slides').length,
    }),
    [items],
  );

  const changeTitle = (value: string) => {
    setTitle(value);
    if (!active) return;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => {
      const cleaned = value.trim() || 'Untitled';
      if (cleaned !== active.title) void update(active.id, { title: cleaned.slice(0, 200) });
    }, 500);
  };

  const newItem = async (kind: StudioKind) => {
    setNewOpen(false);
    setFilter('all');
    await create(kind);
  };

  const chooseItem = (item: StudioItem) => {
    select(item.id);
    setFilter((current) => (current === 'all' || current === item.kind ? current : 'all'));
  };

  const exportFormats = active
    ? active.kind === 'document'
      ? [
          { label: 'Word document (.docx)', format: 'docx' },
          { label: 'Markdown (.md)', format: 'md' },
          { label: 'Web page (.html)', format: 'html' },
        ]
      : active.kind === 'sheet'
        ? [
            { label: 'Excel workbook (.xlsx)', format: 'xlsx' },
            { label: 'CSV (.csv)', format: 'csv' },
          ]
        : [
            { label: 'PowerPoint (.pptx)', format: 'pptx' },
            { label: 'Markdown outline (.md)', format: 'md' },
          ]
    : [];

  return (
    <div className="flex h-full min-h-0 bg-transparent text-[12px]">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c11]/80 backdrop-blur-xl">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-400/15 text-violet-300 ring-1 ring-white/[0.08]">
              <StudioIcon name="file" size={15} />
            </span>
            <div>
              <div className="text-[13px] font-semibold tracking-[-0.01em] text-zinc-100">Studio</div>
              <div className="text-[9.5px] uppercase tracking-[0.16em] text-zinc-600">Documents · Sheets · Decks</div>
            </div>
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setNewOpen((value) => !value)}
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/[0.09] hover:text-white"
              aria-label="Create new Studio item"
            >
              <StudioIcon name="plus" size={15} />
            </button>
            {newOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setNewOpen(false)} />
                <div className="absolute right-0 top-9 z-40 w-[260px] overflow-hidden rounded-xl border border-white/[0.08] bg-[#14141b] p-1.5 shadow-2xl">
                  {NEW_ITEMS.map((entry) => (
                    <button
                      key={entry.kind}
                      type="button"
                      onClick={() => void newItem(entry.kind)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.06]"
                    >
                      <span className={`grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br ${KIND_ACCENT[entry.kind]}`}>
                        <StudioIcon name={KIND_ICON[entry.kind]} size={15} />
                      </span>
                      <span>
                        <span className="block text-[12px] font-medium text-zinc-200">{entry.label}</span>
                        <span className="block text-[10px] text-zinc-500">{entry.description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="px-3 pb-2">
          <div className="flex h-8 items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 focus-within:border-white/[0.14]">
            <StudioIcon name="search" size={13} className="text-zinc-600" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Studio"
              className="min-w-0 flex-1 bg-transparent text-[11.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="text-zinc-600 hover:text-zinc-300">
                <StudioIcon name="x" size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-1 px-3 pb-2">
          {(['all', 'document', 'sheet', 'slides'] as Filter[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`flex-1 rounded-md px-1 py-1 text-[9.5px] font-medium transition-colors ${
                filter === value ? 'bg-white/[0.09] text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
              }`}
            >
              {value === 'all' ? 'All' : value === 'document' ? 'Docs' : value === 'sheet' ? 'Sheets' : 'Decks'}
              <span className="ml-1 text-[8.5px] text-zinc-600">{counts[value]}</span>
            </button>
          ))}
        </div>

        <div className="studio-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {loading && (
            <div className="px-2 py-6 text-center text-[11px] text-zinc-600">Opening Studio…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-[11px] leading-relaxed text-zinc-600">
              {items.length ? 'Nothing matches that search.' : 'A blank page is one click away.'}
            </div>
          )}
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => chooseItem(item)}
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                item.id === activeId ? 'bg-white/[0.075]' : 'hover:bg-white/[0.04]'
              }`}
            >
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br ${KIND_ACCENT[item.kind]}`}>
                <StudioIcon name={KIND_ICON[item.kind]} size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[11.5px] ${item.id === activeId ? 'font-medium text-zinc-100' : 'text-zinc-300'}`}>
                  {item.title}
                </span>
                <span className="block truncate text-[9.5px] text-zinc-600">
                  {STUDIO_KIND_LABEL[item.kind]} · {formatRelative(item.updatedAt)}
                </span>
              </span>
              {item.starred && <StudioIcon name="star-filled" size={11} className="shrink-0 text-amber-400/80" />}
            </button>
          ))}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-2.5 text-[9.5px] leading-relaxed text-zinc-600">
          Ask Infinite AI to write, fix, or build a table. Your files stay on this computer.
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="flex min-h-[54px] items-center gap-3 border-b border-white/[0.06] bg-[#0d0d12]/85 px-4 backdrop-blur-xl">
              <span className="hidden items-center gap-1.5 text-[10px] uppercase tracking-[0.13em] text-zinc-600 sm:flex">
                <StudioIcon name={KIND_ICON[active.kind]} size={12} />
                {STUDIO_KIND_LABEL[active.kind]}
              </span>
              <span className="hidden h-5 w-px bg-white/[0.07] sm:block" />
              <input
                value={title}
                onChange={(event) => changeTitle(event.target.value)}
                onBlur={() => {
                  if (titleTimer.current) clearTimeout(titleTimer.current);
                  const cleaned = title.trim() || 'Untitled';
                  setTitle(cleaned);
                  if (cleaned !== active.title) void update(active.id, { title: cleaned.slice(0, 200) });
                }}
                spellCheck={false}
                aria-label="Document title"
                className="studio-title-input min-w-0 flex-1 text-[14px] font-semibold tracking-[-0.01em] text-zinc-100"
              />
              <span className={`hidden text-[10px] sm:block ${saving ? 'text-amber-400/80' : 'text-zinc-600'}`}>
                {saving ? 'Saving…' : `Edited ${formatRelative(active.updatedAt)}`}
              </span>
              <button
                type="button"
                onClick={() => void update(active.id, { starred: !active.starred })}
                className={`grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-white/[0.06] ${
                  active.starred ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-200'
                }`}
                aria-label={active.starred ? 'Remove star' : 'Star item'}
              >
                <StudioIcon name={active.starred ? 'star-filled' : 'star'} size={14} />
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setExportOpen((value) => !value)}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[10.5px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
                >
                  <StudioIcon name="download" size={13} /> Export
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-9 z-40 w-[220px] rounded-xl border border-white/[0.08] bg-[#14141b] p-1.5 shadow-2xl">
                      {exportFormats.map((entry) => (
                        <button
                          key={entry.format}
                          type="button"
                          onClick={() => {
                            setExportOpen(false);
                            void exportItem(active.id, entry.format);
                          }}
                          className="block w-full rounded-lg px-2.5 py-2 text-left text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                        >
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMoreOpen((value) => !value)}
                  className="grid h-7 w-7 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
                  aria-label="More actions"
                >
                  <StudioIcon name="more" size={15} />
                </button>
                {moreOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMoreOpen(false)} />
                    <div className="absolute right-0 top-9 z-40 w-[190px] rounded-xl border border-white/[0.08] bg-[#14141b] p-1.5 shadow-2xl">
                      <MenuItem icon="copy" label="Duplicate" onClick={() => { setMoreOpen(false); void duplicate(active.id); }} />
                      <MenuItem icon="star" label={active.starred ? 'Remove star' : 'Star'} onClick={() => { setMoreOpen(false); void update(active.id, { starred: !active.starred }); }} />
                      <div className="my-1 h-px bg-white/[0.06]" />
                      <MenuItem icon="trash" label="Delete" danger onClick={() => { setMoreOpen(false); setConfirmDelete(true); }} />
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAiOpen((value) => !value)}
                className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[10.5px] font-medium transition-all ${
                  aiOpen
                    ? 'border-violet-400/40 bg-violet-500/15 text-violet-200'
                    : 'border-white/[0.08] bg-white/[0.035] text-zinc-300 hover:bg-white/[0.07]'
                }`}
              >
                <StudioIcon name="sparkles" size={12} /> AI
              </button>
            </header>

            {active.kind === 'document' && <DocumentEditor key={active.id} item={active} />}
            {active.kind === 'sheet' && <SheetEditor key={active.id} item={active} />}
            {active.kind === 'slides' && <SlidesEditor key={active.id} item={active} />}
          </>
        ) : (
          <EmptyStudio onCreate={newItem} />
        )}
      </section>

      {active && aiOpen && <StudioAiPanel item={active} onClose={() => setAiOpen(false)} />}

      {confirmDelete && active && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(false)}>
          <div className="w-[380px] rounded-2xl border border-white/[0.08] bg-[#14141b] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-1 text-[14px] font-semibold text-zinc-100">Delete “{active.title}”?</div>
            <p className="mb-5 text-[11.5px] leading-relaxed text-zinc-500">
              This removes the {STUDIO_KIND_LABEL[active.kind].toLowerCase()} from this computer. Export it first if you want a copy.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg px-3 py-1.5 text-[11.5px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  void remove(active.id);
                }}
                className="rounded-lg bg-rose-500/15 px-3 py-1.5 text-[11.5px] font-medium text-rose-300 transition-colors hover:bg-rose-500/25"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: StudioIconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11.5px] transition-colors ${
        danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      <StudioIcon name={icon} size={13} /> {label}
    </button>
  );
}

function EmptyStudio({ onCreate }: { onCreate: (kind: StudioKind) => Promise<void> }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[radial-gradient(900px_400px_at_50%_0%,rgba(139,92,246,0.07),transparent_70%),#0d0d12] p-8">
      <div className="w-full max-w-[680px] text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.08] bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-300 shadow-2xl">
          <StudioIcon name="file" size={28} />
        </div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-zinc-100">Your words, in one place</h1>
        <p className="mx-auto mt-2 max-w-[440px] text-[12.5px] leading-relaxed text-zinc-500">
          Write documents, build spreadsheets with real formulas, and present decks — with Infinite AI beside you at every step.
        </p>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {NEW_ITEMS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              onClick={() => void onCreate(entry.kind)}
              className="group rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.045]"
            >
              <span className={`mb-3 grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br ${KIND_ACCENT[entry.kind]}`}>
                <StudioIcon name={KIND_ICON[entry.kind]} size={17} />
              </span>
              <div className="text-[12.5px] font-medium text-zinc-200">{entry.label}</div>
              <div className="mt-1 text-[10.5px] leading-relaxed text-zinc-600">{entry.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
