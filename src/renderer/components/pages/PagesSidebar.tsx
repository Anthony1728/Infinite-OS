import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  FileDown,
  FileText,
  FolderPlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import type { PageSummary } from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';
import { AppIcon, BRAND_GRADIENT } from '../brand/AppIcon';
import { formatRelative, htmlToPlainText } from './pageUtils';
import { PagePopover, PopoverItem, PopoverSeparator } from './PagePopover';

interface PagesSidebarProps {
  onOpenTemplates: () => void;
  onOpenTrash: () => void;
  onOpenAI: () => void;
}

interface TreeNodeProps {
  page: PageSummary;
  childrenOf: Map<string | null, PageSummary[]>;
  expanded: Set<string>;
  toggleExpanded: (id: string) => void;
  activeId: string | null;
  depth: number;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
}

function TreeNode({
  page,
  childrenOf,
  expanded,
  toggleExpanded,
  activeId,
  depth,
  onSelect,
  onAddChild,
}: TreeNodeProps) {
  const children = childrenOf.get(page.id) ?? [];
  const isExpanded = expanded.has(page.id);
  const isActive = activeId === page.id;
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(page.title);
  const renameRef = useRef<HTMLInputElement>(null);
  const update = usePagesStore((state) => state.update);
  const duplicate = usePagesStore((state) => state.duplicate);
  const trash = usePagesStore((state) => state.trash);
  const toggleFavorite = usePagesStore((state) => state.toggleFavorite);
  const exportPage = usePagesStore((state) => state.exportPage);
  const select = usePagesStore((state) => state.select);

  useEffect(() => {
    if (renaming) {
      setDraftTitle(page.title);
      requestAnimationFrame(() => {
        renameRef.current?.focus();
        renameRef.current?.select();
      });
    }
  }, [renaming, page.title]);

  const commitRename = () => {
    const title = draftTitle.trim() || 'Untitled';
    setRenaming(false);
    if (title !== page.title) void update(page.id, { title });
  };

  return (
    <div className="pages-tree-branch">
      <div
        className={`pages-tree-row ${isActive ? 'is-active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-infinite-page', page.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-infinite-page')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }
        }}
        onDrop={(event) => {
          const source = event.dataTransfer.getData('application/x-infinite-page');
          if (!source || source === page.id) return;
          event.preventDefault();
          void update(source, { parentId: page.id }).then(() => {
            if (!expanded.has(page.id)) toggleExpanded(page.id);
          });
        }}
      >
        <button
          type="button"
          className="pages-tree-chevron"
          onClick={(event) => {
            event.stopPropagation();
            if (children.length) toggleExpanded(page.id);
          }}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {children.length ? (isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
        </button>
        <button
          type="button"
          className="pages-tree-label"
          onClick={() => onSelect(page.id)}
          onDoubleClick={() => setRenaming(true)}
          title={page.title}
        >
          <span className="pages-tree-icon">{page.icon}</span>
          {renaming ? (
            <input
              ref={renameRef}
              className="pages-tree-rename"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setRenaming(false);
                }
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span className="pages-tree-title">{page.title}</span>
          )}
          {page.kind === 'database' ? <span className="pages-tree-kind">DB</span> : null}
        </button>
        <div className="pages-tree-actions">
          <button
            type="button"
            className="pages-tree-action"
            title="Add a page inside"
            onClick={(event) => {
              event.stopPropagation();
              onAddChild(page.id);
            }}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="pages-tree-action"
            title="Page options"
            onClick={(event) => {
              event.stopPropagation();
              setMenuAnchor(menuAnchor ? null : event.currentTarget);
            }}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
      {isExpanded && children.length ? (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.id}
              page={child}
              childrenOf={childrenOf}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              activeId={activeId}
              depth={depth + 1}
              onSelect={onSelect}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      ) : null}
      {menuAnchor ? (
        <PagePopover anchor={menuAnchor} onClose={() => setMenuAnchor(null)} width={232}>
          <div className="p-1.5">
            <PopoverItem label="Rename" icon={<FileText size={14} />} onClick={() => { setMenuAnchor(null); setRenaming(true); }} />
            <PopoverItem label="Add page inside" icon={<FolderPlus size={14} />} onClick={() => { setMenuAnchor(null); onAddChild(page.id); }} />
            <PopoverItem
              label={page.favorite ? 'Remove from favorites' : 'Add to favorites'}
              icon={<Star size={14} />}
              onClick={() => { setMenuAnchor(null); void toggleFavorite(page.id); }}
            />
            <PopoverItem label="Duplicate" icon={<Copy size={14} />} onClick={() => { setMenuAnchor(null); void duplicate(page.id); }} />
            <PopoverItem label="Export Markdown" icon={<FileDown size={14} />} onClick={() => { setMenuAnchor(null); void exportPage(page.id, 'md'); }} />
            <PopoverItem label="Open" hint={formatRelative(page.updatedAt)} icon={<ChevronRight size={14} />} onClick={() => { setMenuAnchor(null); void select(page.id); }} />
            <PopoverSeparator />
            <PopoverItem label="Move to trash" icon={<Trash2 size={14} />} danger onClick={() => { setMenuAnchor(null); void trash(page.id); }} />
          </div>
        </PagePopover>
      ) : null}
    </div>
  );
}

export function PagesSidebar({ onOpenTemplates, onOpenTrash, onOpenAI }: PagesSidebarProps) {
  const summaries = usePagesStore((state) => state.summaries);
  const activeId = usePagesStore((state) => state.activeId);
  const collapsed = usePagesStore((state) => state.sidebarCollapsed);
  const toggleSidebar = usePagesStore((state) => state.toggleSidebar);
  const select = usePagesStore((state) => state.select);
  const create = usePagesStore((state) => state.create);
  const search = usePagesStore((state) => state.search);
  const searchHits = usePagesStore((state) => state.searchHits);
  const searching = usePagesStore((state) => state.searching);
  const clearSearch = usePagesStore((state) => state.clearSearch);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [lastActive, setLastActive] = useState<string | null>(null);

  const selectable = useMemo(
    () => summaries.filter((summary) => !summary.trashedAt && !summary.rowDatabaseId && !summary.archived),
    [summaries],
  );
  const favorites = useMemo(() => selectable.filter((summary) => summary.favorite), [selectable]);
  const childrenOf = useMemo(() => {
    const map = new Map<string | null, PageSummary[]>();
    const ids = new Set(selectable.map((summary) => summary.id));
    for (const summary of selectable) {
      const key = summary.parentId && ids.has(summary.parentId) ? summary.parentId : null;
      const list = map.get(key) ?? [];
      list.push(summary);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    return map;
  }, [selectable]);

  const pageCount = selectable.length;
  const databaseCount = selectable.filter((summary) => summary.kind === 'database').length;

  useEffect(() => {
    if (!activeId) return;
    setLastActive(activeId);
    const parentById = new Map(selectable.map((summary) => [summary.id, summary.parentId]));
    setExpanded((previous) => {
      const next = new Set(previous);
      let cursor = parentById.get(activeId) ?? null;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        next.add(cursor);
        cursor = parentById.get(cursor) ?? null;
      }
      return next;
    });
  }, [activeId, selectable]);

  useEffect(() => {
    if (!query.trim()) {
      clearSearch();
      return;
    }
    const timer = window.setTimeout(() => void search(query), 170);
    return () => window.clearTimeout(timer);
  }, [query, search, clearSearch]);

  const toggleExpanded = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddChild = (parentId: string) => {
    void create({ parentId, title: 'Untitled' }).then((page) => {
      if (!page) return;
      setExpanded((previous) => new Set(previous).add(parentId));
    });
  };

  const openSearchResult = (id: string) => {
    setQuery('');
    clearSearch();
    void select(id);
  };

  if (collapsed) {
    return (
      <aside className="pages-sidebar is-collapsed">
        <div className="pages-sidebar-collapsed">
          <button type="button" className="pages-icon-button" onClick={toggleSidebar} title="Expand Pages sidebar">
            <PanelLeftOpen size={17} />
          </button>
          <button type="button" className="pages-icon-button" onClick={() => void create({ title: 'Untitled' })} title="New page">
            <Plus size={18} />
          </button>
          <button type="button" className="pages-icon-button" onClick={onOpenAI} title="AI writing">
            <Sparkles size={17} />
          </button>
          <div className="pages-collapsed-favorites">
            {favorites.slice(0, 8).map((page) => (
              <button
                key={page.id}
                type="button"
                className={`pages-collapsed-page ${activeId === page.id ? 'is-active' : ''}`}
                onClick={() => void select(page.id)}
                title={page.title}
              >
                {page.icon}
              </button>
            ))}
          </div>
          <button type="button" className="pages-icon-button mt-auto" onClick={onOpenTrash} title="Trash">
            <Trash2 size={17} />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="pages-sidebar">
      <div className="pages-sidebar-head">
        <div className="flex items-center gap-2 min-w-0">
          <div className="pages-mark"><AppIcon name="inf.note" className="h-4 w-4" gradient={BRAND_GRADIENT} /></div>
          <div className="min-w-0">
            <div className="pages-sidebar-title">Pages</div>
            <div className="pages-sidebar-subtitle">Your second brain</div>
          </div>
        </div>
        <button type="button" className="pages-icon-button" onClick={toggleSidebar} title="Collapse Pages sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="pages-sidebar-actions">
        <button type="button" className="pages-primary-button flex-1" onClick={() => void create({ title: 'Untitled' })}>
          <Plus size={15} />
          <span>New note</span>
        </button>
        <button type="button" className="pages-secondary-button" onClick={onOpenTemplates} title="Start from a template">
          <Sparkles size={15} />
        </button>
      </div>

      <div className="pages-sidebar-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search every note…"
          aria-label="Search pages"
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} className="pages-search-clear" aria-label="Clear search">×</button>
        ) : null}
      </div>

      {query.trim() ? (
        <div className="pages-search-results custom-scrollbar">
          <div className="pages-sidebar-section-label">
            {searching ? 'Searching…' : `${searchHits.length} result${searchHits.length === 1 ? '' : 's'}`}
          </div>
          {searchHits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className={`pages-search-result ${hit.trashed ? 'is-trashed' : ''}`}
              onClick={() => openSearchResult(hit.id)}
            >
              <span className="text-base leading-none">{hit.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="pages-search-result-title">{hit.title}</span>
                {hit.excerpt ? <span className="pages-search-result-excerpt">{htmlToPlainText(hit.excerpt)}</span> : null}
              </span>
              {hit.trashed ? <span className="pages-search-trash-tag">Trash</span> : null}
            </button>
          ))}
          {!searching && searchHits.length === 0 ? (
            <div className="pages-sidebar-empty">No page matches “{query.trim()}”.</div>
          ) : null}
        </div>
      ) : (
        <div className="pages-sidebar-scroll custom-scrollbar">
          <button
            type="button"
            className={`pages-sidebar-link ${lastActive === activeId ? '' : ''}`}
            onClick={() => {
              const first = selectable[0];
              if (first) void select(first.id);
            }}
          >
            <FileText size={14} />
            <span>All notes</span>
            <span className="pages-sidebar-count">{pageCount}</span>
          </button>

          {favorites.length ? (
            <div className="pages-sidebar-section">
              <button type="button" className="pages-sidebar-section-label is-button" onClick={() => setFavoritesOpen((open) => !open)}>
                {favoritesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Favorites
                <span>{favorites.length}</span>
              </button>
              {favoritesOpen ? favorites.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`pages-favorite-row ${activeId === page.id ? 'is-active' : ''}`}
                  onClick={() => void select(page.id)}
                >
                  <span>{page.icon}</span>
                  <span className="truncate">{page.title}</span>
                  <Star size={11} className="pages-favorite-star" />
                </button>
              )) : null}
            </div>
          ) : null}

          <div className="pages-sidebar-section">
            <div className="pages-sidebar-section-label">
              <ChevronDown size={12} />
              Workspace
              <span>{pageCount}</span>
            </div>
            <div className="pages-tree">
              {(childrenOf.get(null) ?? []).map((page) => (
                <TreeNode
                  key={page.id}
                  page={page}
                  childrenOf={childrenOf}
                  expanded={expanded}
                  toggleExpanded={toggleExpanded}
                  activeId={activeId}
                  depth={0}
                  onSelect={(id) => void select(id)}
                  onAddChild={handleAddChild}
                />
              ))}
              {pageCount === 0 ? (
                <div className="pages-sidebar-empty">
                  A blank canvas is waiting.
                  <button type="button" onClick={() => void create({ title: 'Untitled' })}>Create your first note</button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="pages-sidebar-section mt-2">
            <button type="button" className="pages-sidebar-link" onClick={onOpenTemplates}>
              <Sparkles size={14} />
              <span>New from template</span>
            </button>
            <button type="button" className="pages-sidebar-link" onClick={onOpenTrash}>
              <Trash2 size={14} />
              <span>Trash</span>
              <span className="pages-sidebar-count">{summaries.filter((summary) => summary.trashedAt).length}</span>
            </button>
            <button type="button" className="pages-sidebar-link" onClick={onOpenAI}>
              <Sparkles size={14} />
              <span>Write with AI</span>
            </button>
          </div>
        </div>
      )}

      <div className="pages-sidebar-foot">
        <div className="flex items-center gap-1.5">
          <span>{pageCount} pages</span>
          <span className="pages-dot" />
          <span>{databaseCount} databases</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="pages-icon-button small" title="Trash" onClick={onOpenTrash}><Trash2 size={13} /></button>
          <button type="button" className="pages-icon-button small" title="Templates" onClick={onOpenTemplates}><Archive size={13} /></button>
        </div>
      </div>
    </aside>
  );
}
