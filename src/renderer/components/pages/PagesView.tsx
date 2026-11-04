import { useEffect, useMemo, useState } from 'react';
import {
  Database,
  FileText,
  LayoutGrid,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { PageSummary } from '../../../shared/pages';
import { PAGE_TEMPLATES } from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';
import { PagesSidebar } from './PagesSidebar';
import { PageEditor } from './PageEditor';
import { PageTemplates } from './PageTemplates';
import { formatRelative } from './pageUtils';
import './pages.css';

function PagesLoading() {
  return (
    <div className="pages-loading">
      <div className="pages-loading-canvas">
        <div className="pages-skeleton pages-skeleton-title" />
        <div className="pages-skeleton pages-skeleton-line is-short" />
        <div className="pages-skeleton pages-skeleton-line" />
        <div className="pages-skeleton pages-skeleton-line" />
        <div className="pages-skeleton pages-skeleton-line is-medium" />
      </div>
    </div>
  );
}

function PagesLanding() {
  const summaries = usePagesStore((state) => state.summaries);
  const create = usePagesStore((state) => state.create);
  const select = usePagesStore((state) => state.select);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const recent = useMemo(
    () => summaries
      .filter((summary) => !summary.trashedAt && !summary.rowDatabaseId && !summary.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6),
    [summaries],
  );

  return (
    <div className="pages-landing custom-scrollbar">
      <div className="pages-landing-inner">
        <div className="pages-landing-orb">
          <span className="pages-landing-orb-inner"><LayoutGrid size={26} /></span>
          <span className="pages-landing-spark is-one" />
          <span className="pages-landing-spark is-two" />
          <span className="pages-landing-spark is-three" />
        </div>
        <div className="pages-eyebrow"><Sparkles size={12} /> Infinite Pages</div>
        <h1>A home for every thought.</h1>
        <p className="pages-landing-lead">
          Write without friction. Shape ideas into pages, databases, and living systems — then let AI help you move faster.
        </p>
        <div className="pages-landing-actions">
          <button type="button" className="pages-primary-button is-large" onClick={() => void create({ title: 'Untitled' })}>
            <Plus size={16} /> New page
          </button>
          <button type="button" className="pages-secondary-button is-large" onClick={() => void create({ kind: 'database', title: 'Untitled database' })}>
            <Database size={16} /> New database
          </button>
          <button type="button" className="pages-text-button is-large" onClick={() => setTemplatesOpen(true)}>
            <Sparkles size={15} /> Browse templates
          </button>
        </div>

        {recent.length ? (
          <div className="pages-landing-recent">
            <div className="pages-landing-section-head">
              <span>Continue where you left off</span>
              <span className="pages-landing-count">{summaries.filter((summary) => !summary.trashedAt && !summary.rowDatabaseId).length} pages</span>
            </div>
            <div className="pages-landing-grid">
              {recent.map((page) => (
                <button key={page.id} type="button" className="pages-landing-card" onClick={() => void select(page.id)}>
                  <div className="pages-landing-card-cover" style={cardCover(page)}>
                    <span>{page.icon}</span>
                  </div>
                  <div className="pages-landing-card-body">
                    <div className="pages-landing-card-title">{page.title}</div>
                    <div className="pages-landing-card-meta">
                      {page.kind === 'database' ? <Database size={11} /> : <FileText size={11} />}
                      {page.kind === 'database' ? 'Database' : 'Page'}
                      <span>·</span>
                      {formatRelative(page.updatedAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="pages-landing-tips">
            {PAGE_TEMPLATES.filter((template) => ['meeting', 'project', 'task', 'wiki'].includes(template.id)).map((template) => (
              <button
                key={template.id}
                type="button"
                className="pages-landing-tip"
                onClick={() => void usePagesStore.getState().createFromTemplate(template.id, null)}
              >
                <span className="pages-landing-tip-icon">{template.icon}</span>
                <span>
                  <strong>{template.name}</strong>
                  <small>{template.description}</small>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="pages-landing-hint">
          Tip: press <kbd>Alt</kbd> <kbd>N</kbd> for a new page, type <kbd>/</kbd> for blocks, or <kbd>[[</kbd> to link another page.
        </div>
      </div>

      {templatesOpen ? <PageTemplates parentId={null} onClose={() => setTemplatesOpen(false)} /> : null}
    </div>
  );
}

function cardCover(page: PageSummary): React.CSSProperties {
  if (page.cover?.type === 'image') {
    return { backgroundImage: `url("${page.cover.value}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  if (page.cover?.value) return { background: page.cover.value };
  return { background: 'linear-gradient(135deg, rgba(124,58,237,.28), rgba(34,211,238,.14))' };
}

function TrashDialog({ onClose }: { onClose: () => void }) {
  const summaries = usePagesStore((state) => state.summaries);
  const restore = usePagesStore((state) => state.restore);
  const deletePermanent = usePagesStore((state) => state.deletePermanent);
  const emptyTrash = usePagesStore((state) => state.emptyTrash);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const trashed = summaries
    .filter((summary) => Boolean(summary.trashedAt))
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));

  return (
    <div className="pages-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pages-modal pages-trash-modal">
        <div className="pages-modal-head">
          <div>
            <div className="pages-eyebrow"><Trash2 size={12} /> Recover or clear</div>
            <h2>Trash</h2>
            <p>Restore anything you removed by mistake. Permanent deletion cannot be undone.</p>
          </div>
          <button type="button" className="pages-icon-button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="pages-trash-list custom-scrollbar">
          {trashed.length === 0 ? (
            <div className="pages-trash-empty">
              <div className="pages-empty-glyph"><Trash2 size={22} /></div>
              <h3>Trash is empty</h3>
              <p>Deleted pages will wait here until you decide what to do with them.</p>
            </div>
          ) : trashed.map((page) => (
            <div key={page.id} className="pages-trash-row">
              <span className="pages-trash-icon">{page.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="pages-trash-title">{page.title}</div>
                <div className="pages-trash-meta">
                  {page.kind === 'database' ? 'Database' : 'Page'}
                  {page.trashedAt ? ` · deleted ${formatRelative(page.trashedAt)}` : ''}
                </div>
              </div>
              <button type="button" className="pages-secondary-button" onClick={() => void restore(page.id)}>
                <Undo2 size={13} /> Restore
              </button>
              {confirmId === page.id ? (
                <>
                  <button type="button" className="pages-danger-button" onClick={() => { setConfirmId(null); void deletePermanent(page.id); }}>
                    Confirm delete
                  </button>
                  <button type="button" className="pages-text-button" onClick={() => setConfirmId(null)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="pages-icon-button small" title="Delete permanently" onClick={() => setConfirmId(page.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="pages-modal-foot">
          <span>{trashed.length} item{trashed.length === 1 ? '' : 's'} in trash</span>
          {trashed.length ? (
            confirmEmpty ? (
              <span className="flex items-center gap-2">
                <button type="button" className="pages-danger-button" onClick={() => { setConfirmEmpty(false); void emptyTrash(); }}>
                  Yes, delete everything
                </button>
                <button type="button" className="pages-text-button" onClick={() => setConfirmEmpty(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="pages-danger-text" onClick={() => setConfirmEmpty(true)}>
                Empty trash
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PagesView() {
  const summaries = usePagesStore((state) => state.summaries);
  const pages = usePagesStore((state) => state.pages);
  const activeId = usePagesStore((state) => state.activeId);
  const loading = usePagesStore((state) => state.loading);
  const loadingActive = usePagesStore((state) => state.loadingActive);
  const error = usePagesStore((state) => state.error);
  const load = usePagesStore((state) => state.load);
  const create = usePagesStore((state) => state.create);
  const setAiOpen = usePagesStore((state) => state.setAiOpen);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.closest('input,textarea,[contenteditable="true"]');
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n' && !editing) {
        event.preventDefault();
        void create({ kind: event.shiftKey ? 'database' : 'page', title: event.shiftKey ? 'Untitled database' : 'Untitled' });
      }
      if (event.key === 'Escape') {
        setTrashOpen(false);
        setTemplatesOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [create]);

  const activePage = activeId ? pages[activeId] : null;
  const activeSummary = activeId ? summaries.find((summary) => summary.id === activeId) : null;

  const openAi = () => {
    if (activeId) {
      setAiOpen(true);
      return;
    }
    void create({ title: 'Untitled' }).then((page) => {
      if (page) setAiOpen(true);
    });
  };

  return (
    <div className="pages-shell">
      <PagesSidebar
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenTrash={() => setTrashOpen(true)}
        onOpenAI={openAi}
      />
      <main className="pages-main">
        {error ? (
          <div className="pages-error-banner">
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>Try again</button>
          </div>
        ) : null}
        {loadingActive ? <span className="pages-progress-bar" aria-hidden="true" /> : null}
        {loading && !summaries.length ? (
          <PagesLoading />
        ) : !activeId ? (
          <PagesLanding />
        ) : !activePage ? (
          <PagesLoading />
        ) : activeSummary?.trashedAt ? (
          <div className="pages-missing">
            <div className="pages-empty-glyph"><Trash2 size={24} /></div>
            <h2>This page is in the trash</h2>
            <p>Restore it to continue writing, or choose another page from the sidebar.</p>
            <button type="button" className="pages-primary-button" onClick={() => void usePagesStore.getState().restore(activePage.id)}>
              <Undo2 size={14} /> Restore page
            </button>
          </div>
        ) : (
          <PageEditor key={activePage.id} page={activePage} summaries={summaries} />
        )}
      </main>

      {templatesOpen ? (
        <PageTemplates
          parentId={activeSummary?.parentId ?? null}
          onClose={() => setTemplatesOpen(false)}
        />
      ) : null}
      {trashOpen ? <TrashDialog onClose={() => setTrashOpen(false)} /> : null}
    </div>
  );
}
