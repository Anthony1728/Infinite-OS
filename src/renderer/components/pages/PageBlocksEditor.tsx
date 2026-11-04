import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  GripVertical,
  ImagePlus,
  Link2,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { PageBlock, PageBlockTable, PageBlockType, PageRecord, PageSummary } from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';
import { PagePopover, PopoverItem, PopoverSeparator } from './PagePopover';
import { EmojiPicker } from './EmojiPicker';
import {
  SLASH_COMMANDS,
  escapeHtml,
  htmlToPlainText,
  newId,
  readImageAsDataUrl,
  type SlashCommand,
} from './pageUtils';

const TEXT_TYPES = new Set<PageBlockType>([
  'paragraph', 'heading1', 'heading2', 'heading3', 'bulleted', 'numbered',
  'todo', 'toggle', 'quote', 'callout',
]);

const CALLOUT_TONES: Array<{ id: string; label: string; color: string }> = [
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'sky', label: 'Sky', color: '#38bdf8' },
  { id: 'green', label: 'Green', color: '#4ade80' },
  { id: 'amber', label: 'Amber', color: '#fbbf24' },
  { id: 'rose', label: 'Rose', color: '#fb7185' },
  { id: 'zinc', label: 'Graphite', color: '#a1a1aa' },
];

interface PageBlocksEditorProps {
  pageId: string;
  blocks: PageBlock[];
  onChange: (blocks: PageBlock[]) => void;
  summaries: PageSummary[];
  onRequestAi?: () => void;
}

interface BlockRowProps {
  block: PageBlock;
  index: number;
  blocks: PageBlock[];
  number: number | null;
  onChange: (patch: Partial<PageBlock>) => void;
  onInsertAfter: (type?: PageBlockType) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (from: number, to: number) => void;
  onIndent: (direction: 1 | -1) => void;
  onFocusPrevious: () => void;
  onFocusNext: () => void;
  pageId: string;
  summaries: PageSummary[];
}

function isAtStart(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const preRange = document.createRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length === 0;
}

function isAtEnd(element: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed) return false;
  const postRange = document.createRange();
  postRange.selectNodeContents(element);
  postRange.setStart(range.endContainer, range.endOffset);
  return postRange.toString().length === 0;
}

function placeCaretAtEnd(element: HTMLElement): void {
  element.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function TableEditor({ block, onChange }: { block: PageBlock; onChange: (patch: Partial<PageBlock>) => void }) {
  const table = block.table ?? { headers: ['Column 1', 'Column 2'], rows: [['', '']] };
  const emit = (next: PageBlockTable) => onChange({ table: next });
  const setHeader = (index: number, value: string) => {
    const headers = [...table.headers];
    headers[index] = value;
    emit({ ...table, headers });
  };
  const setCell = (rowIndex: number, cellIndex: number, value: string) => {
    const rows = table.rows.map((row, index) => (
      index === rowIndex ? row.map((cell, cellIdx) => (cellIdx === cellIndex ? value : cell)) : row
    ));
    emit({ ...table, rows });
  };
  const addRow = () => emit({ ...table, rows: [...table.rows, table.headers.map(() => '')].slice(0, 100) });
  const addColumn = () => {
    if (table.headers.length >= 12) return;
    emit({
      headers: [...table.headers, `Column ${table.headers.length + 1}`],
      rows: table.rows.map((row) => [...row, '']),
    });
  };
  return (
    <div className="pages-table-wrap">
      <table className="pages-table">
        <thead>
          <tr>
            {table.headers.map((header, index) => (
              <th key={index}>
                <div className="pages-table-header">
                  <input value={htmlToPlainText(header)} onChange={(event) => setHeader(index, event.target.value)} placeholder={`Column ${index + 1}`} />
                  {table.headers.length > 1 ? (
                    <button
                      type="button"
                      className="pages-table-remove"
                      title="Delete column"
                      onClick={() => emit({
                        headers: table.headers.filter((_cell, cellIndex) => cellIndex !== index),
                        rows: table.rows.map((row) => row.filter((_cell, cellIndex) => cellIndex !== index)),
                      })}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </th>
            ))}
            <th className="pages-table-add-col">
              <button type="button" onClick={addColumn} title="Add column"><Plus size={13} /></button>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {table.headers.map((_header, cellIndex) => (
                <td key={cellIndex}>
                  <input
                    value={htmlToPlainText(row[cellIndex] ?? '')}
                    onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)}
                  />
                </td>
              ))}
              <td className="pages-table-row-action">
                <button
                  type="button"
                  title="Delete row"
                  onClick={() => emit({ ...table, rows: table.rows.filter((_cell, index) => index !== rowIndex) })}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="pages-add-table-row" onClick={addRow}>
        <Plus size={13} /> New row
      </button>
    </div>
  );
}

function ImageBlock({ block, onChange }: { block: PageBlock; onChange: (patch: Partial<PageBlock>) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const url = await readImageAsDataUrl(file);
      onChange({ url, caption: block.caption });
    } catch {
      /* the browser has already told us the file is unreadable */
    } finally {
      setBusy(false);
    }
  };
  if (block.url) {
    return (
      <figure className="pages-image-block">
        <img src={block.url} alt={block.caption || 'Page image'} />
        <figcaption>
          <input
            value={block.caption ?? ''}
            onChange={(event) => onChange({ caption: event.target.value })}
            placeholder="Add a caption…"
          />
          <div className="pages-image-actions">
            <button type="button" onClick={() => inputRef.current?.click()} title="Replace image"><Upload size={13} /></button>
            <button type="button" onClick={() => onChange({ url: undefined, caption: undefined })} title="Remove image"><Trash2 size={13} /></button>
          </div>
        </figcaption>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} />
      </figure>
    );
  }
  return (
    <div className="pages-image-placeholder">
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} />
      <div className="pages-image-placeholder-icon"><ImagePlus size={22} /></div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-300">{busy ? 'Optimising image…' : 'Add an image'}</div>
        <div className="text-xs text-zinc-600">PNG, JPG, or WebP · resized locally for speed</div>
      </div>
      <button type="button" className="pages-secondary-button" onClick={() => inputRef.current?.click()} disabled={busy}>Upload</button>
      {urlMode ? (
        <div className="pages-image-url-row">
          <input autoFocus value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} placeholder="https://…" />
          <button
            type="button"
            className="pages-secondary-button"
            onClick={() => {
              if (/^https:\/\//i.test(urlDraft.trim())) onChange({ url: urlDraft.trim() });
              setUrlMode(false);
            }}
          >
            Embed
          </button>
        </div>
      ) : (
        <button type="button" className="pages-text-button" onClick={() => setUrlMode(true)}>Use a URL</button>
      )}
    </div>
  );
}

function BookmarkBlock({ block, onChange }: { block: PageBlock; onChange: (patch: Partial<PageBlock>) => void }) {
  const [editing, setEditing] = useState(!block.url);
  const [url, setUrl] = useState(block.url ?? '');
  const valid = /^https?:\/\//i.test(url.trim());
  if (!editing && block.url) {
    return (
      <a className="pages-bookmark" href={block.url} target="_blank" rel="noreferrer">
        <span className="pages-bookmark-glyph"><Link2 size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="pages-bookmark-title">{block.caption || block.url}</span>
          <span className="pages-bookmark-url">{block.url}</span>
        </span>
        <ExternalLink size={14} className="text-zinc-600" />
      </a>
    );
  }
  return (
    <div className="pages-bookmark-editor">
      <Link2 size={16} />
      <input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a link…" />
      <button
        type="button"
        className="pages-secondary-button"
        disabled={!valid}
        onClick={() => {
          onChange({ url: url.trim() });
          setEditing(false);
        }}
      >
        Save
      </button>
      {block.url ? <button type="button" className="pages-text-button" onClick={() => setEditing(false)}>Cancel</button> : null}
    </div>
  );
}

function ChildPageCard({ block, summaries }: { block: PageBlock; summaries: PageSummary[] }) {
  const target = summaries.find((summary) => summary.id === block.pageId);
  const select = usePagesStore((state) => state.select);
  if (!block.pageId) {
    return <div className="pages-child-missing">This nested page was removed.</div>;
  }
  return (
    <button
      type="button"
      className="pages-child-card"
      onClick={() => void select(block.pageId!)}
      title={`Open ${target?.title ?? 'nested page'}`}
    >
      <span className="pages-child-icon">{target?.icon ?? (block.type === 'child_database' ? '🗂️' : '📄')}</span>
      <span className="min-w-0 flex-1">
        <span className="pages-child-title">{target?.title ?? 'Untitled'}</span>
        <span className="pages-child-subtitle">{block.type === 'child_database' ? 'Database' : 'Page'} · click to open</span>
      </span>
      <ChevronRight size={15} className="text-zinc-600" />
    </button>
  );
}

function BlockRow({
  block,
  index,
  number,
  onChange,
  onInsertAfter,
  onDelete,
  onDuplicate,
  onMove,
  onIndent,
  onFocusPrevious,
  onFocusNext,
  pageId,
  summaries,
}: BlockRowProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLButtonElement | null>(null);
  const [slashAnchor, setSlashAnchor] = useState<HTMLElement | null>(null);
  const [slashQuery, setSlashQuery] = useState('');
  const [iconAnchor, setIconAnchor] = useState<HTMLButtonElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const isText = TEXT_TYPES.has(block.type);

  useEffect(() => {
    const element = textRef.current;
    if (!element || document.activeElement === element) return;
    if (element.innerHTML !== block.html) element.innerHTML = block.html;
  }, [block.html]);

  useEffect(() => {
    if (!isText) return;
    const element = textRef.current;
    if (!element) return;
    const plain = htmlToPlainText(block.html);
    if (!plain.startsWith('/')) {
      setSlashQuery('');
      setSlashAnchor(null);
      return;
    }
    const query = plain.slice(1).trim();
    setSlashQuery(query);
    setSlashAnchor(element);
  }, [block.html, isText]);

  const changeText = (value: string) => {
    onChange({ html: value });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isText) return;
    const element = textRef.current;
    if (!element) return;
    if (event.key === 'Escape' && slashAnchor) {
      event.preventDefault();
      setSlashAnchor(null);
      setSlashQuery('');
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onInsertAfter(block.type);
      return;
    }
    if (event.key === 'Backspace' && isAtStart(element)) {
      const text = htmlToPlainText(element.innerHTML);
      if (!text.trim()) {
        event.preventDefault();
        onDelete();
      }
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      onIndent(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'ArrowUp' && isAtStart(element)) {
      event.preventDefault();
      onFocusPrevious();
      return;
    }
    if (event.key === 'ArrowDown' && isAtEnd(element)) {
      event.preventDefault();
      onFocusNext();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    document.execCommand('insertText', false, text.replace(/\r\n/g, '\n'));
  };

  const applyCommand = async (command: SlashCommand) => {
    setSlashAnchor(null);
    setSlashQuery('');
    if (command.id === 'child_page' || command.id === 'child_database') {
      try {
        const page = (await window.api.pagesCreate({
          parentId: pageId,
          kind: command.id === 'child_database' ? 'database' : 'page',
          title: command.id === 'child_database' ? 'Untitled database' : 'Untitled',
        })) as PageRecord;
        await usePagesStore.getState().refreshSummaries();
        onChange({
          type: command.id,
          html: '',
          pageId: page.id,
        });
      } catch {
        /* create already reports through the store refresh */
      }
      return;
    }
    onChange({ type: command.id as PageBlockType, html: '' });
    requestAnimationFrame(() => {
      textRef.current?.focus();
      if (textRef.current) placeCaretAtEnd(textRef.current);
    });
  };

  const filteredCommands = useMemo(() => {
    const query = slashQuery.toLowerCase();
    if (!query) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((command) =>
      command.label.toLowerCase().includes(query)
      || command.keywords.some((keyword) => keyword.includes(query)));
  }, [slashQuery]);

  const textProps = {
    ref: textRef,
    contentEditable: true as const,
    suppressContentEditableWarning: true,
    spellCheck: true,
    className: 'pages-text-block',
    onInput: (event: React.FormEvent<HTMLDivElement>) => changeText(event.currentTarget.innerHTML),
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    'data-placeholder': block.type === 'heading1' ? 'Heading 1'
      : block.type === 'heading2' ? 'Heading 2'
        : block.type === 'heading3' ? 'Heading 3'
          : block.type === 'quote' ? 'Quote something…'
            : block.type === 'callout' ? 'Make a thought stand out…'
              : block.type === 'todo' ? 'To-do'
                : block.type === 'toggle' ? 'Toggle'
                  : block.type === 'numbered' ? 'List item'
                    : block.type === 'bulleted' ? 'List item'
                      : "Write something, or type '/' for commands…",
  };

  const content = (() => {
    switch (block.type) {
      case 'divider':
        return <div className="pages-divider"><hr /></div>;
      case 'code':
        return (
          <div className="pages-code-block">
            <div className="pages-code-head">
              <select
                value={block.language ?? 'plain text'}
                onChange={(event) => onChange({ language: event.target.value })}
                aria-label="Code language"
              >
                {['plain text', 'javascript', 'typescript', 'tsx', 'python', 'shell', 'json', 'sql', 'css', 'html', 'markdown'].map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
              </select>
              <button
                type="button"
                className="pages-text-button"
                onClick={() => void navigator.clipboard.writeText(htmlToPlainText(block.html))}
              >
                Copy
              </button>
            </div>
            <textarea
              value={htmlToPlainText(block.html)}
              onChange={(event) => onChange({ html: escapeHtml(event.target.value) })}
              spellCheck={false}
              placeholder="Code"
            />
          </div>
        );
      case 'image':
        return <ImageBlock block={block} onChange={onChange} />;
      case 'bookmark':
        return <BookmarkBlock block={block} onChange={onChange} />;
      case 'table':
        return <TableEditor block={block} onChange={onChange} />;
      case 'child_page':
      case 'child_database':
        return <ChildPageCard block={block} summaries={summaries} />;
      case 'todo':
        return (
          <div className="pages-todo-row">
            <button
              type="button"
              className={`pages-checkbox ${block.checked ? 'is-checked' : ''}`}
              onClick={() => onChange({ checked: !block.checked })}
              aria-label={block.checked ? 'Mark incomplete' : 'Mark complete'}
            >
              {block.checked ? '✓' : ''}
            </button>
            <div {...textProps} className={`${textProps.className} ${block.checked ? 'is-checked' : ''}`} />
          </div>
        );
      case 'toggle':
        return (
          <div className="pages-toggle-row">
            <button type="button" className="pages-toggle-chevron" onClick={() => onChange({ collapsed: !block.collapsed })}>
              {block.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </button>
            <div {...textProps} />
          </div>
        );
      case 'quote':
        return <blockquote className="pages-quote"><div {...textProps} /></blockquote>;
      case 'callout':
        return (
          <div className="pages-callout" data-tone={block.tone ?? 'violet'}>
            <button
              type="button"
              className="pages-callout-icon"
              onClick={(event) => setIconAnchor(iconAnchor ? null : event.currentTarget)}
            >
              {block.icon ?? '💡'}
            </button>
            <div {...textProps} />
            {iconAnchor ? (
              <PagePopover anchor={iconAnchor} onClose={() => setIconAnchor(null)} width={310}>
                <EmojiPicker onPick={(icon) => { onChange({ icon }); setIconAnchor(null); }} compact />
                <div className="pages-callout-tones">
                  {CALLOUT_TONES.map((tone) => (
                    <button
                      key={tone.id}
                      type="button"
                      className={`pages-tone-dot ${block.tone === tone.id ? 'is-active' : ''}`}
                      style={{ backgroundColor: tone.color }}
                      title={tone.label}
                      onClick={() => onChange({ tone: tone.id })}
                    />
                  ))}
                </div>
              </PagePopover>
            ) : null}
          </div>
        );
      case 'bulleted':
        return <div className="pages-list-row"><span className="pages-list-marker">•</span><div {...textProps} /></div>;
      case 'numbered':
        return <div className="pages-list-row"><span className="pages-list-marker numbered">{number ?? 1}.</span><div {...textProps} /></div>;
      case 'heading1':
      case 'heading2':
      case 'heading3':
        return <div {...textProps} className={`${textProps.className} pages-${block.type}`} />;
      default:
        return <div {...textProps} />;
    }
  })();

  return (
    <div
      className={`pages-block ${dragging ? 'is-dragging' : ''}`}
      data-block-id={block.id}
      style={{ marginLeft: `${Math.min(4, block.depth) * 26}px` }}
      draggable={false}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-infinite-block')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(event) => {
        const source = Number(event.dataTransfer.getData('application/x-infinite-block'));
        if (Number.isFinite(source) && source !== index) {
          event.preventDefault();
          onMove(source, index);
        }
      }}
    >
      <div className="pages-block-gutter">
        <button
          type="button"
          className="pages-gutter-button"
          title="Add block"
          onClick={(event: MouseEvent) => {
            setAddAnchor(addAnchor ? null : event.currentTarget as HTMLButtonElement);
          }}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className="pages-gutter-button"
          title="Block options"
          onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
        >
          <MoreHorizontal size={14} />
        </button>
        <button
          type="button"
          className="pages-drag-handle"
          title="Drag to reorder"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-infinite-block', String(index));
            event.dataTransfer.effectAllowed = 'move';
            setDragging(true);
          }}
          onDragEnd={() => setDragging(false)}
        >
          <GripVertical size={14} />
        </button>
      </div>
      <div className="pages-block-content">{content}</div>

      {addAnchor ? (
        <PagePopover anchor={addAnchor} onClose={() => setAddAnchor(null)} width={330} className="pages-command-menu">
          <div className="pages-command-search">
            <span>Blocks</span>
            <span className="pages-kbd">/</span>
          </div>
          <div className="pages-command-list custom-scrollbar">
            {SLASH_COMMANDS.map((command) => (
              <button
                key={command.id}
                type="button"
                className="pages-command-item"
                onClick={() => {
                  setAddAnchor(null);
                  void applyCommand(command);
                }}
              >
                <span className="pages-command-icon">{command.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="pages-command-label">{command.label}</span>
                  <span className="pages-command-desc">{command.description}</span>
                </span>
              </button>
            ))}
          </div>
        </PagePopover>
      ) : null}

      {menuAnchor ? (
        <PagePopover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={220}>
          <div className="p-1.5">
            <PopoverItem label="Duplicate" icon={<Copy size={14} />} onClick={() => { setMenuAnchor(null); onDuplicate(); }} />
            <PopoverItem label="Indent" icon={<ChevronRight size={14} />} hint="Tab" onClick={() => { setMenuAnchor(null); onIndent(1); }} />
            <PopoverItem label="Outdent" icon={<ChevronDown size={14} />} hint="Shift + Tab" onClick={() => { setMenuAnchor(null); onIndent(-1); }} />
            <PopoverSeparator />
            <PopoverItem label="Delete block" icon={<Trash2 size={14} />} danger onClick={() => { setMenuAnchor(null); onDelete(); }} />
          </div>
        </PagePopover>
      ) : null}

      {slashAnchor && filteredCommands.length ? (
        <PagePopover anchor={slashAnchor} onClose={() => { setSlashAnchor(null); setSlashQuery(''); }} width={330} className="pages-command-menu">
          <div className="pages-command-search">
            <span>Basic blocks</span>
            <span className="pages-slash-query">/{slashQuery}</span>
          </div>
          <div className="pages-command-list custom-scrollbar">
            {filteredCommands.map((command) => (
              <button
                key={command.id}
                type="button"
                className="pages-command-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void applyCommand(command)}
              >
                <span className="pages-command-icon">{command.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="pages-command-label">{command.label}</span>
                  <span className="pages-command-desc">{command.description}</span>
                </span>
              </button>
            ))}
          </div>
        </PagePopover>
      ) : null}
    </div>
  );
}

export function PageBlocksEditor({ pageId, blocks, onChange, summaries, onRequestAi }: PageBlocksEditorProps) {
  const focusRef = useRef<{ id: string; atEnd: boolean } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    const target = focusRef.current;
    if (!target) return;
    focusRef.current = null;
    const element = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(target.id)}"] .pages-text-block`);
    if (!element) return;
    if (target.atEnd) placeCaretAtEnd(element);
    else {
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [blocks]);

  const updateBlock = useCallback((id: string, patch: Partial<PageBlock>) => {
    onChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  }, [blocks, onChange]);

  const insertAfter = useCallback((index: number, type: PageBlockType = 'paragraph') => {
    const current = blocks[index];
    const nextType = ['bulleted', 'numbered', 'todo', 'toggle'].includes(type) ? type : 'paragraph';
    const next: PageBlock = { id: newId(), type: nextType, html: '', depth: current?.depth ?? 0 };
    if (nextType === 'todo') next.checked = false;
    if (nextType === 'toggle') next.collapsed = false;
    const copy = [...blocks];
    copy.splice(index + 1, 0, next);
    focusRef.current = { id: next.id, atEnd: false };
    onChange(copy);
  }, [blocks, onChange]);

  const deleteBlock = useCallback((index: number) => {
    if (blocks.length <= 1) {
      onChange([{ id: blocks[0]?.id ?? newId(), type: 'paragraph', html: '', depth: 0 }]);
      return;
    }
    const previous = blocks[index - 1];
    const next = blocks.filter((_block, blockIndex) => blockIndex !== index);
    if (previous) focusRef.current = { id: previous.id, atEnd: true };
    onChange(next);
  }, [blocks, onChange]);

  const duplicateBlock = useCallback((index: number) => {
    const source = blocks[index];
    if (!source) return;
    const copy: PageBlock = {
      ...JSON.parse(JSON.stringify(source)) as PageBlock,
      id: newId(),
    };
    if (copy.table) {
      copy.table.headers = [...copy.table.headers];
      copy.table.rows = copy.table.rows.map((row) => [...row]);
    }
    const next = [...blocks];
    next.splice(index + 1, 0, copy);
    focusRef.current = { id: copy.id, atEnd: true };
    onChange(next);
  }, [blocks, onChange]);

  const moveBlock = useCallback((from: number, to: number) => {
    if (from === to) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  }, [blocks, onChange]);

  const indentBlock = useCallback((id: string, direction: 1 | -1) => {
    const block = blocks.find((candidate) => candidate.id === id);
    if (!block) return;
    const depth = Math.max(0, Math.min(4, block.depth + direction));
    updateBlock(id, { depth });
  }, [blocks, updateBlock]);

  const focusBlockAt = useCallback((index: number, atEnd: boolean) => {
    const block = blocks[index];
    if (!block) return;
    focusRef.current = { id: block.id, atEnd };
    const element = document.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(block.id)}"] .pages-text-block`);
    if (element) {
      if (atEnd) placeCaretAtEnd(element);
      else {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      focusRef.current = null;
    }
  }, [blocks]);

  const numbering = useMemo(() => {
    const numbers: Array<number | null> = [];
    let counters = new Map<number, number>();
    for (const block of blocks) {
      if (block.type === 'numbered') {
        const value = (counters.get(block.depth) ?? 0) + 1;
        counters.set(block.depth, value);
        numbers.push(value);
        for (const key of [...counters.keys()]) if (key > block.depth) counters.delete(key);
      } else {
        numbers.push(null);
        counters = new Map();
      }
    }
    return numbers;
  }, [blocks]);

  return (
    <div className="pages-blocks" onFocusCapture={(event) => {
      const block = (event.target as HTMLElement).closest('[data-block-id]');
      setFocusedId(block?.getAttribute('data-block-id') ?? null);
    }}>
      {blocks.map((block, index) => (
        <BlockRow
          key={block.id}
          block={block}
          index={index}
          blocks={blocks}
          number={numbering[index] ?? null}
          onChange={(patch) => updateBlock(block.id, patch)}
          onInsertAfter={(type) => insertAfter(index, type)}
          onDelete={() => deleteBlock(index)}
          onDuplicate={() => duplicateBlock(index)}
          onMove={moveBlock}
          onIndent={(direction) => indentBlock(block.id, direction)}
          onFocusPrevious={() => focusBlockAt(index - 1, true)}
          onFocusNext={() => focusBlockAt(index + 1, false)}
          pageId={pageId}
          summaries={summaries}
        />
      ))}
      <button type="button" className="pages-click-empty" onClick={() => insertAfter(blocks.length - 1)}>
        <Plus size={13} /> Add a block
      </button>
      {onRequestAi ? (
        <button type="button" className="pages-write-with-ai" onClick={onRequestAi}>
          <span className="pages-ai-glyph">✦</span>
          Write with AI
        </button>
      ) : null}
      {focusedId ? <span className="sr-only" aria-live="polite">Editing block</span> : null}
    </div>
  );
}
