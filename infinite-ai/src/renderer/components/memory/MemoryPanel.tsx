import { useState, useEffect, useCallback } from 'react';

interface MemoryEntry {
  id: string;
  type: 'preference' | 'project' | 'document' | 'chat' | 'note';
  title: string;
  content: string;
  tags: string[];
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}

interface MemoryStats {
  total: number;
  byType: Record<string, number>;
}

const TYPE_ICONS: Record<string, string> = {
  preference: 'M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75',
  project: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z',
  document: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  chat: 'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z',
  note: 'M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z',
};

const TYPE_COLORS: Record<string, string> = {
  preference: 'from-blue-500 to-indigo-500',
  project: 'from-green-500 to-emerald-500',
  document: 'from-orange-500 to-amber-500',
  chat: 'from-brandPurple to-brandPink',
  note: 'from-cyan-500 to-sky-500',
};

interface MemoryPanelProps {
  onClose: () => void;
}

export function MemoryPanel({ onClose }: MemoryPanelProps) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newMemory, setNewMemory] = useState({ type: 'note' as MemoryEntry['type'], title: '', content: '', tags: '' });
  const [loading, setLoading] = useState(true);

  const loadMemories = useCallback(async () => {
    try {
      const type = filterType === 'all' ? undefined : filterType;
      const result = await window.api.listMemories({ type, search: searchQuery || undefined }) as MemoryEntry[];
      setMemories(result);
    } catch (err) {
      console.error('Failed to load memories:', err);
    }
  }, [filterType, searchQuery]);

  const loadStats = useCallback(async () => {
    try {
      const result = await window.api.getMemoryStats() as MemoryStats;
      setStats(result);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadMemories(), loadStats()]).finally(() => setLoading(false));
  }, [loadMemories, loadStats]);

  useEffect(() => {
    const t = setTimeout(loadMemories, 300);
    return () => clearTimeout(t);
  }, [filterType, searchQuery, loadMemories]);

  const handleCreate = async () => {
    if (!newMemory.title.trim()) return;
    try {
      await window.api.createMemory({
        type: newMemory.type,
        title: newMemory.title.trim(),
        content: newMemory.content.trim(),
        tags: newMemory.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setNewMemory({ type: 'note', title: '', content: '', tags: '' });
      setIsCreating(false);
      await Promise.all([loadMemories(), loadStats()]);
    } catch (err) {
      console.error('Failed to create memory:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await window.api.deleteMemory({ id });
      await Promise.all([loadMemories(), loadStats()]);
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1 text-textMain">Memory</h1>
          <p className="text-textMuted text-sm">Manage your AI memory and context.</p>
        </div>
        <button onClick={onClose} className="text-textMuted hover:text-textMain p-2 rounded-lg hover:bg-bgCard transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          {Object.entries(TYPE_COLORS).map(([type, gradient]) => (
            <div key={type} className="bg-bgCard border border-borderSubtle rounded-xl p-3 text-center">
              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mx-auto mb-2 shadow-lg`}>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={TYPE_ICONS[type]} />
                </svg>
              </div>
              <div className="text-lg font-bold text-textMain">{stats.byType[type] || 0}</div>
              <div className="text-[10px] text-textMuted capitalize">{type}s</div>
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/></svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-bgInput border border-borderSubtle rounded-lg pl-9 pr-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-brandPurple/50"
          />
        </div>
        <div className="flex gap-1.5">
          {['all', 'preference', 'project', 'document', 'chat', 'note'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filterType === type
                  ? 'bg-brandPurple/15 text-brandPurple border border-brandPurple/30'
                  : 'bg-bgCard text-textMuted hover:text-textMain border border-borderSubtle'
              }`}
            >
              {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="px-4 py-1.5 bg-brandPurple text-white rounded-lg text-xs font-medium hover:bg-brandPurple/80 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          New
        </button>
      </div>

      {/* Create form */}
      {isCreating && (
        <div className="bg-bgCard border border-brandPurple/30 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-semibold text-textMain mb-3">New Memory</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-textMuted mb-1 block">Type</label>
              <select
                value={newMemory.type}
                onChange={(e) => setNewMemory((p) => ({ ...p, type: e.target.value as MemoryEntry['type'] }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain"
              >
                <option value="note">Note</option>
                <option value="preference">Preference</option>
                <option value="project">Project</option>
                <option value="document">Document</option>
                <option value="chat">Chat</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-textMuted mb-1 block">Title</label>
              <input
                type="text"
                value={newMemory.title}
                onChange={(e) => setNewMemory((p) => ({ ...p, title: e.target.value }))}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain"
                placeholder="Memory title..."
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="text-xs text-textMuted mb-1 block">Content</label>
            <textarea
              value={newMemory.content}
              onChange={(e) => setNewMemory((p) => ({ ...p, content: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain h-20 resize-none"
              placeholder="Memory content..."
            />
          </div>
          <div className="mb-3">
            <label className="text-xs text-textMuted mb-1 block">Tags (comma-separated)</label>
            <input
              type="text"
              value={newMemory.tags}
              onChange={(e) => setNewMemory((p) => ({ ...p, tags: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain"
              placeholder="tag1, tag2, tag3..."
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setIsCreating(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs rounded-lg">Cancel</button>
            <button onClick={handleCreate} className="px-4 py-1.5 bg-brandPurple text-white rounded-lg text-xs font-medium hover:bg-brandPurple/80">Create</button>
          </div>
        </div>
      )}

      {/* Memory list */}
      {loading ? (
        <div className="text-center py-12 text-textMuted">
          <div className="w-6 h-6 border-2 border-brandPurple border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading memories...</p>
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-12 text-textMuted">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brandPurple/20 to-brandPink/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-brandPurple" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <p className="text-lg font-medium mb-1 text-textMain">No memories yet</p>
          <p className="text-sm text-textMuted">Create your first memory to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {memories.map((memory) => (
            <div key={memory.id} className="bg-bgCard border border-borderSubtle rounded-xl p-4 hover:border-indigo-500/30 transition-colors group">
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${TYPE_COLORS[memory.type]} flex items-center justify-center shadow-lg flex-shrink-0`}>
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={TYPE_ICONS[memory.type]} />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-textMain text-sm truncate">{memory.title}</div>
                  <div className="text-xs text-textMuted mt-1 line-clamp-2">{memory.content || 'No content'}</div>
                  {memory.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {memory.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 bg-bgMain border border-borderSubtle rounded text-[10px] text-textMuted">
                          {tag}
                        </span>
                      ))}
                      {memory.tags.length > 3 && (
                        <span className="text-[10px] text-textMuted">+{memory.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(memory.id)}
                  className="text-textMuted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
