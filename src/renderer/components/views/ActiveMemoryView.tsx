import { useState, useEffect } from 'react'

interface MemoryEntry {
  id: string
  category: 'preference' | 'context' | 'fact' | 'pattern' | 'workflow'
  key: string
  value: string
  relevance: number
  lastAccessed: string
  accessCount: number
  createdAt: string
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  preference: {
    label: 'Preference',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'
  },
  context: {
    label: 'Context',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  fact: {
    label: 'Fact',
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  pattern: {
    label: 'Pattern',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z'
  },
  workflow: {
    label: 'Workflow',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z'
  }
}

const SEED_MEMORIES: MemoryEntry[] = [
  {
    id: '1',
    category: 'preference',
    key: 'preferred-theme',
    value: 'Dark mode with purple accents',
    relevance: 0.9,
    lastAccessed: new Date().toISOString(),
    accessCount: 12,
    createdAt: new Date(Date.now() - 86400000 * 7).toISOString()
  },
  {
    id: '2',
    category: 'context',
    key: 'current-project',
    value: 'Working on Infinite UI - a multi-view React dashboard',
    relevance: 0.95,
    lastAccessed: new Date().toISOString(),
    accessCount: 24,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString()
  },
  {
    id: '3',
    category: 'fact',
    key: 'react-version',
    value: 'Using React 18 with TypeScript strict mode',
    relevance: 0.7,
    lastAccessed: new Date(Date.now() - 86400000).toISOString(),
    accessCount: 5,
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString()
  },
  {
    id: '4',
    category: 'pattern',
    key: 'component-structure',
    value: 'Views follow: useState hooks, useEffect data loading, filter/search UI, card-based rendering',
    relevance: 0.85,
    lastAccessed: new Date().toISOString(),
    accessCount: 18,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString()
  },
  {
    id: '5',
    category: 'workflow',
    key: 'git-workflow',
    value: 'Feature branches from main, squash merge, conventional commits',
    relevance: 0.75,
    lastAccessed: new Date(Date.now() - 86400000 * 2).toISOString(),
    accessCount: 8,
    createdAt: new Date(Date.now() - 86400000 * 14).toISOString()
  }
]

const STORAGE_KEY = 'infinite-active-memory'

export function ActiveMemoryView() {
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newMemory, setNewMemory] = useState({ category: 'preference' as MemoryEntry['category'], key: '', value: '' })
  const [stats, setStats] = useState({ total: 0, accessed: 0, avgRelevance: 0 })

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        setMemories(JSON.parse(stored))
      } catch {
        setMemories(SEED_MEMORIES)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_MEMORIES))
      }
    } else {
      setMemories(SEED_MEMORIES)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_MEMORIES))
    }
  }, [])

  useEffect(() => {
    if (memories.length === 0) {
      setStats({ total: 0, accessed: 0, avgRelevance: 0 })
      return
    }
    const total = memories.length
    const accessed = memories.filter(m => m.accessCount > 0).length
    const avgRelevance = memories.reduce((sum, m) => sum + m.relevance, 0) / total
    setStats({ total, accessed, avgRelevance: Math.round(avgRelevance * 100) / 100 })
  }, [memories])

  const saveMemories = (updated: MemoryEntry[]) => {
    setMemories(updated)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  }

  const createMemory = () => {
    if (!newMemory.key.trim() || !newMemory.value.trim()) return
    const entry: MemoryEntry = {
      id: Date.now().toString(),
      category: newMemory.category,
      key: newMemory.key.trim(),
      value: newMemory.value.trim(),
      relevance: 0.5,
      lastAccessed: new Date().toISOString(),
      accessCount: 0,
      createdAt: new Date().toISOString()
    }
    saveMemories([entry, ...memories])
    setNewMemory({ category: 'preference', key: '', value: '' })
    setShowCreate(false)
  }

  const deleteMemory = (id: string) => {
    saveMemories(memories.filter(m => m.id !== id))
  }

  const filtered = memories.filter(m => {
    const matchCategory = filterCategory === 'all' || m.category === filterCategory
    const matchSearch = searchQuery === '' ||
      m.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.value.toLowerCase().includes(searchQuery.toLowerCase())
    return matchCategory && matchSearch
  })

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-semibold text-textMain">Active Memory</h1>
          <p className="text-sm text-textMuted">Context-aware memory system that learns and adapts</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-bgCard border border-white/[0.06] rounded-xl p-4">
          <div className="text-2xl font-bold text-textMain">{stats.total}</div>
          <div className="text-xs text-textMuted mt-1">Total Memories</div>
        </div>
        <div className="bg-bgCard border border-white/[0.06] rounded-xl p-4">
          <div className="text-2xl font-bold text-textMain">{stats.accessed}</div>
          <div className="text-xs text-textMuted mt-1">Recently Accessed</div>
        </div>
        <div className="bg-bgCard border border-white/[0.06] rounded-xl p-4">
          <div className="text-2xl font-bold text-violet-400">{Math.round(stats.avgRelevance * 100)}%</div>
          <div className="text-xs text-textMuted mt-1">Avg Relevance</div>
        </div>
      </div>

      <div className="bg-bgCard border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-medium text-textMain">How Active Memory Works</h3>
            <p className="text-xs text-textMuted mt-1 leading-relaxed">
              Active Memory stores contextual information that persists across sessions. It tracks your preferences,
              project context, learned facts, detected patterns, and common workflows. Memories with higher relevance
              scores are surfaced more frequently, and access counts help identify your most-used information.
            </p>
          </div>
        </div>
      </div>

      {showCreate && (
        <div className="bg-bgCard border border-white/[0.06] rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-textMain">Create New Memory</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-textMuted mb-1">Category</label>
              <select
                value={newMemory.category}
                onChange={(e) => setNewMemory({ ...newMemory, category: e.target.value as MemoryEntry['category'] })}
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-violet-500/50"
              >
                {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-textMuted mb-1">Key</label>
              <input
                type="text"
                value={newMemory.key}
                onChange={(e) => setNewMemory({ ...newMemory, key: e.target.value })}
                placeholder="memory-key"
                className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder:text-textMuted/50 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-textMuted mb-1">Value</label>
            <textarea
              value={newMemory.value}
              onChange={(e) => setNewMemory({ ...newMemory, value: e.target.value })}
              placeholder="Memory content..."
              rows={2}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder:text-textMuted/50 focus:outline-none focus:border-violet-500/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-xs text-textMuted hover:text-textMain transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={createMemory}
              disabled={!newMemory.key.trim() || !newMemory.value.trim()}
              className="px-4 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-violet-500 to-indigo-500 rounded-lg shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-bgInput border border-borderSubtle rounded-xl pl-10 pr-4 py-2 text-sm text-textMain placeholder:text-textMuted/50 focus:outline-none focus:border-violet-500/50"
          />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-bgInput border border-borderSubtle rounded-xl px-3 py-2 text-sm text-textMain focus:outline-none focus:border-violet-500/50"
        >
          <option value="all">All Categories</option>
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => (
            <option key={key} value={key}>{config.label}</option>
          ))}
        </select>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 text-xs font-medium text-white bg-gradient-to-r from-violet-500 to-indigo-500 rounded-xl shadow-lg shadow-violet-500/20 hover:shadow-violet-500/30 transition-all"
        >
          {showCreate ? 'Cancel' : '+ New Memory'}
        </button>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-bgCard border border-white/[0.06] rounded-xl p-8 text-center">
            <svg className="w-12 h-12 text-textMuted/30 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
            </svg>
            <p className="text-sm text-textMuted">No memories found</p>
            <p className="text-xs text-textMuted/50 mt-1">Try a different search or category filter</p>
          </div>
        ) : (
          filtered.map((memory) => {
            const config = CATEGORY_CONFIG[memory.category]
            return (
              <div
                key={memory.id}
                className="bg-bgCard border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.1] transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${config.bg} ${config.color}`}>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={config.icon} />
                        </svg>
                        {config.label}
                      </span>
                      <span className="text-xs text-textMuted font-mono">{memory.key}</span>
                    </div>
                    <p className="text-sm text-textMain leading-relaxed">{memory.value}</p>
                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-textMuted">Relevance</span>
                        <div className="w-24 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                            style={{ width: `${memory.relevance * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-textMuted">{Math.round(memory.relevance * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-textMuted">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                        {memory.accessCount}
                      </div>
                      <span className="text-xs text-textMuted/60">{formatDate(memory.lastAccessed)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMemory(memory.id)}
                    className="p-1.5 text-textMuted/50 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
