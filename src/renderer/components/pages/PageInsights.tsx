import { useEffect, useMemo, useState } from 'react';
import { Link2, MessageSquare, Send, Sparkles, Trash2 } from 'lucide-react';
import type { PageRecord, PageSummary } from '../../../shared/pages';
import { usePagesStore } from '../../stores/pages';
import { formatDateTime, formatRelative, htmlToPlainText } from './pageUtils';

export type PageInsightTab = 'comments' | 'backlinks' | 'info' | null;

export function PageInsights({
  page,
  tab,
  onClose,
  onNavigate,
}: {
  page: PageRecord;
  tab: PageInsightTab;
  onClose: () => void;
  onNavigate: (id: string) => void;
}) {
  const addComment = usePagesStore((state) => state.addComment);
  const deleteComment = usePagesStore((state) => state.deleteComment);
  const resolveComment = usePagesStore((state) => state.resolveComment);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [backlinks, setBacklinks] = useState<PageSummary[]>([]);
  const [loadingBacklinks, setLoadingBacklinks] = useState(false);

  useEffect(() => {
    if (tab !== 'backlinks') return;
    let cancelled = false;
    setLoadingBacklinks(true);
    void (window.api.pagesBacklinks({ id: page.id }) as Promise<PageSummary[]>)
      .then((links) => { if (!cancelled) setBacklinks(links); })
      .catch(() => { if (!cancelled) setBacklinks([]); })
      .finally(() => { if (!cancelled) setLoadingBacklinks(false); });
    return () => { cancelled = true; };
  }, [page.id, tab, page.updatedAt]);

  const openComments = page.comments.filter((comment) => !comment.resolved);
  const resolvedComments = page.comments.filter((comment) => comment.resolved);
  const words = useMemo(() => {
    const plain = [page.title, ...page.blocks.map((block) => htmlToPlainText(block.html))].join(' ');
    return plain.trim() ? plain.trim().split(/\s+/).filter(Boolean).length : 0;
  }, [page.blocks, page.title]);

  if (!tab) return null;

  return (
    <aside className="pages-insights">
      <div className="pages-insights-head">
        <div className="flex items-center gap-2">
          {tab === 'comments' ? <MessageSquare size={15} /> : tab === 'backlinks' ? <Link2 size={15} /> : <Sparkles size={15} />}
          <span>{tab === 'comments' ? 'Comments' : tab === 'backlinks' ? 'Backlinks' : 'Page details'}</span>
        </div>
        <button type="button" className="pages-icon-button small" onClick={onClose}>×</button>
      </div>
      <div className="pages-insights-body custom-scrollbar">
        {tab === 'comments' ? (
          <>
            <div className="pages-comment-compose">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Add a comment or leave a note for your team…"
                rows={3}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && text.trim() && !busy) {
                    setBusy(true);
                    void addComment(page.id, text.trim()).then(() => { setText(''); setBusy(false); });
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-600">⌘ Enter to post</span>
                <button
                  type="button"
                  className="pages-primary-button"
                  disabled={!text.trim() || busy}
                  onClick={() => {
                    setBusy(true);
                    void addComment(page.id, text.trim()).then(() => { setText(''); setBusy(false); });
                  }}
                >
                  <Send size={13} /> Comment
                </button>
              </div>
            </div>
            <div className="pages-comment-list">
              {openComments.length === 0 ? (
                <div className="pages-insights-empty">No open comments. Start a conversation right here.</div>
              ) : openComments.map((comment) => (
                <article key={comment.id} className="pages-comment">
                  <div className="pages-comment-meta">
                    <span className="pages-avatar">{comment.author.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <div className="pages-comment-author">{comment.author}</div>
                      <div className="pages-comment-time">{formatRelative(comment.createdAt)}{comment.blockId ? ' · on a block' : ''}</div>
                    </div>
                    <button type="button" title="Resolve" className="pages-comment-action" onClick={() => void resolveComment(page.id, comment.id, true)}>✓</button>
                    <button type="button" title="Delete" className="pages-comment-action" onClick={() => void deleteComment(page.id, comment.id)}><Trash2 size={12} /></button>
                  </div>
                  <p>{comment.text}</p>
                </article>
              ))}
            </div>
            {resolvedComments.length ? (
              <div className="pages-resolved-comments">
                <button type="button" onClick={() => setShowResolved((open) => !open)}>
                  {showResolved ? 'Hide' : 'Show'} {resolvedComments.length} resolved
                </button>
                {showResolved ? resolvedComments.map((comment) => (
                  <article key={comment.id} className="pages-comment is-resolved">
                    <div className="pages-comment-meta">
                      <span className="pages-avatar">{comment.author.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="pages-comment-author">{comment.author}</div>
                        <div className="pages-comment-time">{formatRelative(comment.createdAt)} · resolved</div>
                      </div>
                      <button type="button" className="pages-comment-action" title="Reopen" onClick={() => void resolveComment(page.id, comment.id, false)}>↺</button>
                      <button type="button" className="pages-comment-action" title="Delete" onClick={() => void deleteComment(page.id, comment.id)}><Trash2 size={12} /></button>
                    </div>
                    <p>{comment.text}</p>
                  </article>
                )) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {tab === 'backlinks' ? (
          <div className="pages-backlinks">
            <div className="pages-insights-intro">Pages that mention <strong>{page.title}</strong> with <code>[[{page.title}]]</code>.</div>
            {loadingBacklinks ? <div className="pages-insights-empty">Finding links…</div> : null}
            {!loadingBacklinks && backlinks.length === 0 ? (
              <div className="pages-insights-empty">No backlinks yet. Type <code>[[{page.title}]]</code> in another page to connect it here.</div>
            ) : null}
            {backlinks.map((link) => (
              <button key={link.id} type="button" className="pages-backlink" onClick={() => onNavigate(link.id)}>
                <span className="text-base">{link.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="pages-backlink-title">{link.title}</span>
                  <span className="pages-backlink-time">{formatRelative(link.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {tab === 'info' ? (
          <div className="pages-info">
            <div className="pages-info-icon">{page.icon}</div>
            <h3>{page.title}</h3>
            <div className="pages-info-grid">
              <span>Created</span><span>{formatDateTime(page.createdAt)}</span>
              <span>Updated</span><span>{formatDateTime(page.updatedAt)}</span>
              <span>Words</span><span>{words.toLocaleString()}</span>
              <span>Blocks</span><span>{page.blocks.length.toLocaleString()}</span>
              <span>Comments</span><span>{page.comments.length.toLocaleString()}</span>
              <span>Versions</span><span>{page.versions.length.toLocaleString()}</span>
              <span>Links</span><span>{page.blocks.reduce((count, block) => count + (block.html.match(/\[\[[^\]]+\]\]/g)?.length ?? 0), 0)}</span>
              <span>Page ID</span><span className="pages-info-id">{page.id}</span>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
