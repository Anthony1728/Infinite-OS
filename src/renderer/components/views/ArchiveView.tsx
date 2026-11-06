/**
 * Archive — conversations the user has filed away.
 *
 * What "archive" means here, precisely: a flag on the session. The transcript is
 * never moved, rewritten or summarised, so restoring a conversation gives back
 * the exact thread that was there. That is the whole point — an archive you
 * cannot resume from is just a bin.
 *
 * Search looks only inside the archive. `searchSessions` matches titles and
 * previews of live chats too, so reusing it here would quietly return
 * conversations the user deliberately filed away — the one thing an archive must
 * never do.
 *
 * Nothing on this screen is estimated: the counts are the stored
 * `message_count`, and an entry with no preview says so rather than inventing
 * a summary.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, Search, RotateCcw, Trash2, X, MessageSquare, Folder,
} from 'lucide-react';
import { AppIcon, BRAND_GRADIENT } from '../brand/AppIcon';
import { useChatStore } from '../../stores/chat';
import { useSessionStore } from '../../stores/session';
import type { Session } from '../../../shared/types';

export function ArchiveView() {
  const selectSession = useChatStore((s) => s.selectSession);
  const archiveSession = useChatStore((s) => s.archiveSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  // View navigation lives in the session store, not the chat store.
  const setCurrentView = useSessionStore((s) => s.setCurrentView);

  const [items, setItems] = useState<Session[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const list = search.trim()
        ? await window.api.archiveSearch({ query: search })
        : await window.api.archiveList();
      setItems(Array.isArray(list) ? list : []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced so typing does not re-read every transcript on each keystroke.
  useEffect(() => {
    const handle = setTimeout(() => void load(query), query.trim() ? 250 : 0);
    return () => clearTimeout(handle);
  }, [query, load]);

  const totals = useMemo(() => {
    let messages = 0;
    for (const session of items) messages += session.message_count ?? 0;
    return { conversations: items.length, messages };
  }, [items]);

  const restore = async (session: Session) => {
    try {
      await archiveSession(session.id, false);
      await load(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSession(id);
      setConfirmDelete(null);
      await load(query);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setConfirmDelete(null);
    }
  };

  const open = async (session: Session) => {
    // Restoring first means the conversation goes back where it belongs, so it
    // is not still filed away after the user has reopened it.
    try {
      await archiveSession(session.id, false);
    } catch {
      /* opening still works even if the un-file fails */
    }
    await selectSession(session.id);
    setCurrentView('chats');
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] text-white">
      <div className="flex-shrink-0 flex items-center justify-between gap-4 p-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center flex-shrink-0">
            <AppIcon name="inf.archive" className="w-[18px] h-[18px]" gradient={BRAND_GRADIENT} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Archive</h1>
            <p className="text-[11px] text-white/40 truncate">
              {loading
                ? 'Loading…'
                : totals.conversations === 0
                  ? 'Nothing filed away yet'
                  : `${totals.conversations} conversation${totals.conversations === 1 ? '' : 's'} · ${totals.messages} message${totals.messages === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        <div className="relative flex-shrink-0">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search inside the archive"
            className="w-64 bg-[#14141a] border border-white/10 rounded-lg pl-8 pr-8 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-white/25"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-300">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!loading && items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Archive size={26} className="text-white/15" />
            <p className="text-sm text-white/50">
              {query.trim() ? `Nothing in the archive matches “${query.trim()}”.` : 'The archive is empty.'}
            </p>
            <p className="text-xs text-white/30 max-w-sm">
              {query.trim()
                ? 'Search looks only inside the archive, so it will not turn up conversations you have not filed.'
                : 'Archive a conversation from the chat list to keep it out of the way. It stays fully readable and you can carry on from it at any time.'}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-1.5">
            {items.map((session) => (
              <div
                key={session.id}
                className="group flex items-start gap-3 p-3 rounded-xl bg-[#14141a] border border-white/5 hover:border-white/15 transition-colors"
              >
                <button onClick={() => void open(session)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={12} className="text-white/30 flex-shrink-0" />
                    <span className="text-xs font-medium text-white/90 truncate">{session.title || 'Untitled'}</span>
                    {session.pinned && <span className="text-[10px] text-amber-300/80 flex-shrink-0">pinned</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/35">
                    <span>{new Date(session.updated_at).toLocaleString()}</span>
                    <span>{session.message_count ?? 0} messages</span>
                    {session.model && <span className="font-mono truncate max-w-[220px]">{session.model}</span>}
                    {session.folder && (
                      <span className="flex items-center gap-0.5"><Folder size={9} />{session.folder}</span>
                    )}
                  </div>
                  {session.preview ? (
                    <p className="mt-1 text-[11px] text-white/40 truncate">{session.preview}</p>
                  ) : (
                    // No stored preview, so say nothing rather than inventing one.
                    <p className="mt-1 text-[11px] text-white/20 italic">No preview stored</p>
                  )}
                </button>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => void open(session)}
                    title="Restore and open"
                    className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    onClick={() => void restore(session)}
                    title="Restore to the chat list"
                    className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10"
                  >
                    <Archive size={13} />
                  </button>
                  {confirmDelete === session.id ? (
                    <span className="flex items-center gap-1">
                      <button
                        onClick={() => void remove(session.id)}
                        className="px-2 py-1 rounded-md bg-red-500/20 text-[10px] text-red-200 hover:bg-red-500/30"
                      >
                        Delete for good
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-1.5 py-1 rounded-md text-[10px] text-white/40 hover:text-white/70"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(session.id)}
                      title="Delete this conversation permanently"
                      className="p-1.5 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ArchiveView;