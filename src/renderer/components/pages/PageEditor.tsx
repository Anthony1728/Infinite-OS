import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  Archive,
  Bold,
  Check,
  ChevronRight,
  Clock3,
  Code2,
  Copy,
  Download,
  FileDown,
  History,
  Image as ImageIcon,
  Info,
  Italic,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Palette,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  Upload,
  X,
} from 'lucide-react';
import {
  PAGE_COVER_PRESETS,
  type DatabaseValue,
  type PageBlock,
  type PageCover,
  type PageDatabase,
  type PageRecord,
  type PageSummary,
  type PageUpdateInput,
} from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';
import { useNotificationStore } from '../../stores/notifications';
import { PagePopover, PopoverItem, PopoverSeparator } from './PagePopover';
import { EmojiPicker } from './EmojiPicker';
import { PageBlocksEditor } from './PageBlocksEditor';
import { DatabaseView } from './DatabaseView';
import { PageInsights, type PageInsightTab } from './PageInsights';
import { PageHistory } from './PageHistory';
import { PagesAi } from './PagesAi';
import {
  formatDateTime,
  formatRelative,
  markdownToBlocks,
  newId,
  readImageAsDataUrl,
} from './pageUtils';

interface Draft {
  title: string;
  icon: string;
  cover: PageCover | null;
  blocks: PageBlock[];
  database?: PageDatabase;
}

function draftFromPage(page: PageRecord): Draft {
  return {
    title: page.title,
    icon: page.icon,
    cover: page.cover,
    blocks: page.blocks,
    database: page.database,
  };
}

function coverStyle(cover: PageCover | null): React.CSSProperties | undefined {
  if (!cover) return undefined;
  if (cover.type === 'image') return { backgroundImage: `url("${cover.value}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  return { background: cover.value };
}

function RichTextToolbar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onSelection = () => {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const inside = Boolean(element?.closest('.pages-text-block'));
      setVisible(Boolean(inside && selection && !selection.isCollapsed && selection.rangeCount > 0));
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, []);

  if (!visible) return null;

  const command = (name: string, value?: string) => {
    try {
      document.execCommand(name, false, value);
    } catch {
      /* the browser declined the formatting command */
    }
  };
  const makeLink = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0).cloneRange();
    const raw = window.prompt('Paste a link');
    if (!raw) return;
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (!/^https?:\/\//i.test(href)) return;
    selection.removeAllRanges();
    selection.addRange(range);
    command('createLink', href);
  };
  const inlineCode = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (!text) return;
    range.deleteContents();
    const code = document.createElement('code');
    code.textContent = text;
    range.insertNode(code);
    selection.removeAllRanges();
    const next = document.createRange();
    next.selectNodeContents(code);
    selection.addRange(next);
  };

  const buttons = [
    { label: 'Bold', icon: <Bold size={14} />, run: () => command('bold') },
    { label: 'Italic', icon: <Italic size={14} />, run: () => command('italic') },
    { label: 'Underline', icon: <Underline size={14} />, run: () => command('underline') },
    { label: 'Strikethrough', icon: <Strikethrough size={14} />, run: () => command('strikeThrough') },
    { label: 'Inline code', icon: <Code2 size={14} />, run: inlineCode },
    { label: 'Link', icon: <Link2 size={14} />, run: makeLink },
  ];

  return (
    <div className="pages-format-toolbar">
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          title={button.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={button.run}
        >
          {button.icon}
        </button>
      ))}
      <span className="pages-format-divider" />
      <button
        type="button"
        title="Clear formatting"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => command('removeFormat')}
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function PageEditor({ page, summaries }: { page: PageRecord; summaries: PageSummary[] }) {
  const [draft, setDraft] = useState<Draft>(() => draftFromPage(page));
  const [dirty, setDirty] = useState(false);
  const [sideTab, setSideTab] = useState<PageInsightTab>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<HTMLButtonElement | null>(null);
  const [iconAnchor, setIconAnchor] = useState<HTMLButtonElement | null>(null);
  const [coverAnchor, setCoverAnchor] = useState<HTMLButtonElement | null>(null);
  const [backlinks, setBacklinks] = useState(0);
  const [backlinksLoaded, setBacklinksLoaded] = useState(false);
  const [confirmRowId, setConfirmRowId] = useState<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PageUpdateInput>({});
  const timerRef = useRef<number | null>(null);
  const toast = useNotificationStore((state) => state.addToast);
  const update = usePagesStore((state) => state.update);
  const toggleFavorite = usePagesStore((state) => state.toggleFavorite);
  const duplicate = usePagesStore((state) => state.duplicate);
  const trash = usePagesStore((state) => state.trash);
  const select = usePagesStore((state) => state.select);
  const createRow = usePagesStore((state) => state.createRow);
  const deleteRow = usePagesStore((state) => state.deleteRow);
  const duplicateRow = usePagesStore((state) => state.duplicateRow);
  const openRow = usePagesStore((state) => state.openRow);
  const saveVersion = usePagesStore((state) => state.saveVersion);
  const exportPage = usePagesStore((state) => state.exportPage);
  const aiOpen = usePagesStore((state) => state.aiOpen);
  const setAiOpen = usePagesStore((state) => state.setAiOpen);
  const saving = usePagesStore((state) => state.saving);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (!Object.keys(patch).length) {
      setDirty(false);
      return;
    }
    await update(page.id, patch);
    if (!Object.keys(pendingRef.current).length) setDirty(false);
  }, [page.id, update]);

  const enqueue = useCallback((patch: PageUpdateInput) => {
    pendingRef.current = { ...pendingRef.current, ...patch };
    setDirty(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void flush(); }, 480);
  }, [flush]);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length) void usePagesStore.getState().update(page.id, patch);
  }, [page.id]);

  useEffect(() => {
    const onBlur = () => { void flush(); };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [flush]);

  useEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, [draft.title]);

  useEffect(() => {
    let cancelled = false;
    setBacklinksLoaded(false);
    void (window.api.pagesBacklinks({ id: page.id }) as Promise<PageSummary[]>)
      .then((links) => { if (!cancelled) { setBacklinks(links.length); setBacklinksLoaded(true); } })
      .catch(() => { if (!cancelled) { setBacklinks(0); setBacklinksLoaded(true); } });
    return () => { cancelled = true; };
  }, [page.id, page.title, page.updatedAt]);

  useEffect(() => {
    if (!aiOpen) return;
    setSideTab(null);
    // A floating writing surface should never stack on top of the insights rail.
  }, [aiOpen]);

  const ancestors = useMemo(() => {
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));
    const chain: PageSummary[] = [];
    const seen = new Set<string>();
    let cursor = page.parentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const parent = byId.get(cursor);
      if (!parent) break;
      chain.unshift(parent);
      cursor = parent.parentId;
    }
    return chain;
  }, [page.parentId, summaries]);

  const patchDraft = (patch: Partial<Draft>, save: PageUpdateInput) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    enqueue(save);
  };

  const onBlocksChange = (blocks: PageBlock[]) => {
    setDraft((previous) => ({ ...previous, blocks }));
    enqueue({ blocks });
  };

  const database = draft.database;
  const databasePage = page.kind === 'database' && database;

  const applyDatabase = (next: PageDatabase) => {
    setDraft((previous) => ({ ...previous, database: next }));
    enqueue({ database: next });
  };

  const updateRowValues = (rowId: string, values: Record<string, DatabaseValue>) => {
    if (!database) return;
    const now = Date.now();
    applyDatabase({
      ...database,
      rows: database.rows.map((row) => row.id === rowId ? { ...row, values, updatedAt: now } : row),
    });
  };

  const addRow = async (values?: Record<string, DatabaseValue>) => {
    await flush();
    const next = await createRow(page.id, { values });
    if (next) setDraft((previous) => ({ ...previous, database: next }));
  };

  const removeRow = (rowId: string) => {
    setConfirmRowId(rowId);
  };

  const confirmRemoveRow = async () => {
    if (!confirmRowId) return;
    const rowId = confirmRowId;
    setConfirmRowId(null);
    await flush();
    const next = await deleteRow(page.id, rowId);
    if (next) setDraft((previous) => ({ ...previous, database: next }));
  };

  const copyRow = async (rowId: string) => {
    await flush();
    const next = await duplicateRow(page.id, rowId);
    if (next) setDraft((previous) => ({ ...previous, database: next }));
  };

  const openDatabaseRow = async (rowId: string) => {
    await flush();
    await openRow(page.id, rowId);
  };

  const applyAiText = (text: string, mode: 'replace' | 'append') => {
    const imported = markdownToBlocks(text).blocks;
    if (!imported.length) return;
    const nextBlocks = mode === 'append'
      ? [...draft.blocks, ...(draft.blocks.length ? [{ id: newId(), type: 'divider' as const, html: '', depth: 0 }] : []), ...imported]
      : imported;
    setDraft((previous) => ({ ...previous, blocks: nextBlocks }));
    enqueue({ blocks: nextBlocks });
    toast({ type: 'success', title: mode === 'append' ? 'Added to note' : 'Note rewritten' });
  };

  const applyAiRows = async (rows: Array<Record<string, DatabaseValue>>) => {
    if (!database) return;
    await flush();
    const titleProperty = database.properties.find((property) => property.type === 'title');
    const now = Date.now();
    const maxOrder = database.rows.reduce((max, row) => Math.max(max, row.order), -1);
    const newRows = rows.map((values, index) => ({
      id: newId(),
      values: {
        ...values,
        ...(titleProperty && (!values[titleProperty.id] || !String(values[titleProperty.id]).trim())
          ? { [titleProperty.id]: 'Untitled' }
          : {}),
      },
      order: maxOrder + index + 1,
      createdAt: now,
      updatedAt: now,
    }));
    const next = { ...database, rows: [...database.rows, ...newRows] };
    setDraft((previous) => ({ ...previous, database: next }));
    const saved = await update(page.id, { database: next });
    if (saved?.database) setDraft((previous) => ({ ...previous, database: saved.database }));
  };

  const uploadCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const value = await readImageAsDataUrl(file);
      patchDraft({ cover: { type: 'image', value } }, { cover: { type: 'image', value } });
      setCoverAnchor(null);
    } catch (error) {
      toast({ type: 'error', title: 'Could not use that image', message: error instanceof Error ? error.message : undefined });
    }
  };

  const copyPageLink = async () => {
    try {
      await navigator.clipboard.writeText(`infinite://pages/${page.id}`);
      toast({ type: 'success', title: 'Note link copied' });
    } catch {
      toast({ type: 'error', title: 'Could not copy the link' });
    }
  };

  const focusFirstBlock = () => {
    const element = document.querySelector<HTMLElement>('.pages-blocks .pages-text-block');
    element?.focus();
  };

  const isRowPage = Boolean(page.rowDatabaseId);
  const unresolvedComments = page.comments.filter((comment) => !comment.resolved).length;
  const saveLabel = dirty || saving ? 'Saving…' : `Saved ${formatRelative(page.updatedAt)}`;

  return (
    <div className="pages-editor">
      <div className="pages-topbar">
        <div className="pages-breadcrumbs">
          <button type="button" className="pages-crumb-root" onClick={() => { const root = summaries.find((summary) => !summary.trashedAt && !summary.rowDatabaseId && !summary.archived); if (root) void select(root.id); }}>
            Pages
          </button>
          {ancestors.map((ancestor) => (
            <span key={ancestor.id} className="pages-crumb-wrap">
              <ChevronRight size={12} />
              <button type="button" className="pages-crumb" onClick={() => void select(ancestor.id)}>
                <span>{ancestor.icon}</span>{ancestor.title}
              </button>
            </span>
          ))}
          <ChevronRight size={12} />
          <span className="pages-crumb is-current">{draft.icon} {draft.title || 'Untitled'}</span>
        </div>
        <div className="pages-topbar-actions">
          <span className={`pages-save-state ${dirty || saving ? 'is-saving' : ''}`}>
            <span className="pages-save-dot" />
            {saveLabel}
          </span>
          <button
            type="button"
            className={`pages-topbar-button ${page.favorite ? 'is-on' : ''}`}
            title={page.favorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={() => void toggleFavorite(page.id)}
          >
            <span className={page.favorite ? 'text-amber-300' : ''}>★</span>
          </button>
          <button
            type="button"
            className="pages-topbar-button"
            title="Comments"
            onClick={() => { setAiOpen(false); setSideTab(sideTab === 'comments' ? null : 'comments'); }}
          >
            <MessageSquare size={15} />
            {unresolvedComments ? <span className="pages-topbar-badge">{unresolvedComments}</span> : null}
          </button>
          <button
            type="button"
            className={`pages-topbar-button ${sideTab === 'backlinks' ? 'is-on' : ''}`}
            title="Backlinks"
            onClick={() => { setAiOpen(false); setSideTab(sideTab === 'backlinks' ? null : 'backlinks'); }}
          >
            <Link2 size={15} />
            {backlinksLoaded && backlinks ? <span className="pages-topbar-badge">{backlinks}</span> : null}
          </button>
          <button type="button" className="pages-topbar-button" title="Page details" onClick={() => { setAiOpen(false); setSideTab(sideTab === 'info' ? null : 'info'); }}>
            <Info size={15} />
          </button>
          <button type="button" className={`pages-ai-trigger ${aiOpen ? 'is-on' : ''}`} onClick={() => setAiOpen(!aiOpen)}>
            <Sparkles size={14} />
            <span>AI</span>
          </button>
          <button type="button" className="pages-topbar-button" title="More" onClick={(event) => setMoreAnchor(moreAnchor ? null : event.currentTarget)}>
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      <div className="pages-editor-scroll custom-scrollbar">
        <div className="pages-canvas">
          {draft.cover ? (
            <div className={`pages-cover ${draft.cover.type === 'image' ? 'is-image' : ''}`} style={coverStyle(draft.cover)}>
              <div className="pages-cover-actions">
                <button type="button" className="pages-cover-button" onClick={(event) => setCoverAnchor(coverAnchor ? null : event.currentTarget)}>
                  <ImageIcon size={13} /> Change cover
                </button>
                <button type="button" className="pages-cover-button" onClick={() => patchDraft({ cover: null }, { cover: null })}>
                  <X size={13} /> Remove
                </button>
              </div>
            </div>
          ) : null}

          <div className={`pages-page-inner ${draft.cover ? 'has-cover' : ''}`}>
            <div className="pages-icon-row">
              {draft.icon ? (
                <button
                  type="button"
                  className="pages-page-icon"
                  title="Change icon"
                  onClick={(event) => setIconAnchor(iconAnchor ? null : event.currentTarget)}
                >
                  {draft.icon}
                </button>
              ) : (
                <button type="button" className="pages-add-icon" onClick={(event) => setIconAnchor(event.currentTarget)}>
                  <Palette size={14} /> Add icon
                </button>
              )}
              {!draft.cover ? (
                <button type="button" className="pages-add-cover" onClick={(event) => setCoverAnchor(coverAnchor ? null : event.currentTarget)}>
                  <ImageIcon size={13} /> Add cover
                </button>
              ) : null}
            </div>

            <textarea
              ref={titleRef}
              className="pages-title"
              value={draft.title}
              rows={1}
              maxLength={300}
              placeholder="Untitled"
              spellCheck
              onChange={(event) => patchDraft({ title: event.target.value }, { title: event.target.value })}
              onBlur={() => { void flush(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (!databasePage) focusFirstBlock();
                }
              }}
            />

            <div className="pages-byline">
              {isRowPage ? <span className="pages-byline-pill">Database row</span> : null}
              <span>{formatRelative(page.updatedAt)}</span>
              <span>·</span>
              <span>{draft.blocks.reduce((count, block) => count + (block.html.trim() ? 1 : 0), 0)} blocks</span>
              {database ? <><span>·</span><span>{database.rows.length} rows</span></> : null}
            </div>

            <div className="pages-page-content">
              {databasePage && database ? (
                <DatabaseView
                  database={database}
                  summaries={summaries}
                  onChange={applyDatabase}
                  onCreateRow={(values) => void addRow(values)}
                  onUpdateRow={updateRowValues}
                  onDuplicateRow={(rowId) => void copyRow(rowId)}
                  onDeleteRow={(rowId) => void removeRow(rowId)}
                  onOpenRow={(rowId) => void openDatabaseRow(rowId)}
                />
              ) : (
                <PageBlocksEditor
                  pageId={page.id}
                  blocks={draft.blocks}
                  onChange={onBlocksChange}
                  summaries={summaries}
                  onRequestAi={() => setAiOpen(true)}
                />
              )}
            </div>

            <div className="pages-page-footer">
              <span><Clock3 size={12} /> Created {formatDateTime(page.createdAt)}</span>
              <span>Last edited {formatRelative(page.updatedAt)}</span>
              {!databasePage ? (
                <button type="button" onClick={() => setAiOpen(true)}>
                  <Sparkles size={12} /> Write with AI
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <RichTextToolbar />

      {sideTab ? (
        <PageInsights
          page={page}
          tab={sideTab}
          onClose={() => setSideTab(null)}
          onNavigate={(id) => { setSideTab(null); void select(id); }}
        />
      ) : null}

      {aiOpen ? (
        <PagesAi
          page={page}
          title={draft.title}
          blocks={draft.blocks}
          database={database}
          onClose={() => setAiOpen(false)}
          onApplyText={applyAiText}
          onApplyRows={applyAiRows}
        />
      ) : null}

      {historyOpen ? (
        <PageHistory
          page={page}
          onClose={() => setHistoryOpen(false)}
          onRestored={(restored) => {
            setDraft(draftFromPage(restored));
            pendingRef.current = {};
            setDirty(false);
          }}
        />
      ) : null}

      {confirmRowId ? (
        <div
          className="pages-modal-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmRowId(null); }}
        >
          <div className="pages-modal pages-confirm-modal">
            <div className="pages-modal-head">
              <div>
                <h2>Delete this row?</h2>
                <p>Its row page moves to the trash, where you can restore it.</p>
              </div>
            </div>
            <div className="pages-modal-foot">
              <button type="button" className="pages-secondary-button" onClick={() => setConfirmRowId(null)}>Cancel</button>
              <button type="button" className="pages-danger-button" onClick={() => void confirmRemoveRow()}>Delete row</button>
            </div>
          </div>
        </div>
      ) : null}

      {iconAnchor ? (
        <PagePopover anchor={iconAnchor} onClose={() => setIconAnchor(null)} width={330}>
          <EmojiPicker
            onPick={(icon) => { patchDraft({ icon }, { icon }); setIconAnchor(null); }}
            onRemove={() => { patchDraft({ icon: '📄' }, { icon: '📄' }); setIconAnchor(null); }}
          />
        </PagePopover>
      ) : null}

      {coverAnchor ? (
        <PagePopover anchor={coverAnchor} onClose={() => setCoverAnchor(null)} width={376}>
          <div className="pages-cover-picker">
            <div className="pages-menu-head"><span>Cover</span><button type="button" onClick={() => setCoverAnchor(null)}><X size={14} /></button></div>
            <div className="pages-cover-grid">
              {PAGE_COVER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="pages-cover-swatch"
                  title={preset.label}
                  style={{ background: preset.value }}
                  onClick={() => {
                    patchDraft({ cover: { type: preset.type, value: preset.value } }, { cover: { type: preset.type, value: preset.value } });
                    setCoverAnchor(null);
                  }}
                >
                  {draft.cover?.value === preset.value ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
            <div className="pages-cover-picker-foot">
              <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadCover} />
              <button type="button" className="pages-secondary-button" onClick={() => coverInputRef.current?.click()}>
                <Upload size={13} /> Upload image
              </button>
              {draft.cover ? (
                <button type="button" className="pages-text-button" onClick={() => { patchDraft({ cover: null }, { cover: null }); setCoverAnchor(null); }}>
                  Remove cover
                </button>
              ) : null}
            </div>
          </div>
        </PagePopover>
      ) : null}

      {moreAnchor ? (
        <PagePopover anchor={moreAnchor} onClose={() => setMoreAnchor(null)} width={248}>
          <div className="p-1.5">
            <PopoverItem label="Save version" icon={<Check size={14} />} onClick={() => { setMoreAnchor(null); void flush().then(() => saveVersion(page.id)); }} />
            <PopoverItem label="Version history" icon={<History size={14} />} onClick={() => { setMoreAnchor(null); setHistoryOpen(true); }} />
            <PopoverItem label="Page details" icon={<Info size={14} />} onClick={() => { setMoreAnchor(null); setSideTab('info'); }} />
            <PopoverSeparator />
            {!isRowPage ? <PopoverItem label="Duplicate page" icon={<Copy size={14} />} onClick={() => { setMoreAnchor(null); void flush().then(() => duplicate(page.id)); }} /> : null}
            <PopoverItem
              label="Export Markdown"
              icon={<FileDown size={14} />}
              onClick={() => { setMoreAnchor(null); void flush().then(() => exportPage(page.id, 'md')); }}
            />
            {page.kind === 'database' ? (
              <PopoverItem
                label="Export CSV"
                icon={<Download size={14} />}
                onClick={() => { setMoreAnchor(null); void flush().then(() => exportPage(page.id, 'csv')); }}
              />
            ) : null}
            <PopoverItem label="Copy page link" icon={<Link2 size={14} />} onClick={() => { setMoreAnchor(null); void copyPageLink(); }} />
            <PopoverSeparator />
            <PopoverItem
              label={page.archived ? 'Unarchive page' : 'Archive page'}
              icon={<Archive size={14} />}
              onClick={() => {
                setMoreAnchor(null);
                void flush().then(async () => {
                  await update(page.id, { archived: !page.archived });
                  await usePagesStore.getState().refreshSummaries();
                  if (!page.archived) {
                    const next = usePagesStore.getState().summaries.find((summary) => !summary.trashedAt && !summary.archived && !summary.rowDatabaseId);
                    if (next) void select(next.id);
                  }
                });
              }}
            />
            <PopoverItem
              label="Move to trash"
              icon={<Trash2 size={14} />}
              danger
              onClick={() => { setMoreAnchor(null); void flush().then(() => trash(page.id)); }}
            />
          </div>
        </PagePopover>
      ) : null}
    </div>
  );
}
