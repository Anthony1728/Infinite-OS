import { useCallback, useMemo, useState, useEffect } from 'react'

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

/** The real memory row stored by the main process (SQLite). */
interface StoredMemory {
  id: string
  type: 'preference' | 'project' | 'document' | 'chat' | 'note'
  title: string
  content: string
  tags: string[]
  tier: 'episodic' | 'semantic' | 'procedural'
  importance: number
  accessCount: number
  lastAccessed: number
  createdAt: number
  updatedAt: number
}

type Layer = 'all' | 'personal' | 'operating'
type MemoryCategory = MemoryEntry['category']

const CATEGORY_CONFIG: Record<MemoryCategory, { label: string; color: string; hex: string; bg: string; icon: string }> = {
  preference: {
    label: 'Preference',
    color: 'text-violet-300',
    hex: '#a78bfa',
    bg: 'bg-violet-500/10',
    icon: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'
  },
  context: {
    label: 'Context',
    color: 'text-sky-300',
    hex: '#7dd3fc',
    bg: 'bg-sky-500/10',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  fact: {
    label: 'Fact',
    color: 'text-emerald-300',
    hex: '#6ee7b7',
    bg: 'bg-emerald-500/10',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  pattern: {
    label: 'Pattern',
    color: 'text-amber-300',
    hex: '#fcd34d',
    bg: 'bg-amber-500/10',
    icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z'
  },
  workflow: {
    label: 'Workflow',
    color: 'text-cyan-300',
    hex: '#67e8f9',
    bg: 'bg-cyan-500/10',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z'
  }
}

const CATEGORIES = Object.keys(CATEGORY_CONFIG) as MemoryCategory[]

const LAYER_CATEGORIES: Record<Exclude<Layer, 'all'>, MemoryCategory[]> = {
  personal: ['preference', 'pattern'],
  operating: ['context', 'fact', 'workflow'],
}

function categoryFor(entry: StoredMemory): MemoryCategory {
  const tags = entry.tags.map((tag) => tag.toLowerCase())
  if (tags.includes('pattern')) return 'pattern'
  if (entry.tier === 'procedural' || tags.includes('workflow')) return 'workflow'
  if (entry.type === 'preference') return 'preference'
  if (entry.type === 'document' || entry.type === 'note') return 'fact'
  return 'context'
}

function iso(value: number): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function toDisplay(entry: StoredMemory): MemoryEntry {
  return {
    id: entry.id,
    category: categoryFor(entry),
    key: entry.title,
    value: entry.content,
    relevance: Math.max(0, Math.min(1, entry.importance)),
    lastAccessed: iso(entry.lastAccessed || entry.updatedAt || entry.createdAt),
    accessCount: entry.accessCount,
    createdAt: iso(entry.createdAt)
  }
}

const NEW_MEMORY_SHAPE: Record<MemoryCategory, { type: StoredMemory['type']; tier: StoredMemory['tier']; tags: string[] }> = {
  preference: { type: 'preference', tier: 'semantic', tags: [] },
  context: { type: 'project', tier: 'semantic', tags: [] },
  fact: { type: 'note', tier: 'semantic', tags: [] },
  pattern: { type: 'note', tier: 'semantic', tags: ['pattern'] },
  workflow: { type: 'note', tier: 'procedural', tags: ['workflow'] }
}

function tokensOf(entry: MemoryEntry): Set<string> {
  const words = `${entry.key} ${entry.value}`.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []
  return new Set(words)
}

function short(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export function ActiveMemoryView() {
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [filterCategory, setFilterCategory] = useState<'all' | MemoryCategory>('all')
  const [layer, setLayer] = useState<Layer>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newMemory, setNewMemory] = useState({ category: 'preference' as MemoryCategory, key: '', value: '' })
  const [mode, setMode] = useState<'list' | 'graph'>('graph')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [neighborhoodOnly, setNeighborhoodOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadMemories = useCallback(async () => {
    try {
      const rows = (await window.api.listMemories()) as StoredMemory[]
      setMemories(rows.map(toDisplay))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load memory.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadMemories() }, [loadMemories])

  const createMemory = async () => {
    if (!newMemory.key.trim() || !newMemory.value.trim()) return
    const shape = NEW_MEMORY_SHAPE[newMemory.category]
    try {
      await window.api.createMemory({
        type: shape.type,
        title: newMemory.key.trim(),
        content: newMemory.value.trim(),
        tags: shape.tags,
        tier: shape.tier,
        importance: 0.6
      })
      setNewMemory({ category: 'preference', key: '', value: '' })
      setShowCreate(false)
      await loadMemories()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this memory.')
    }
  }

  const deleteMemory = async (id: string) => {
    try {
      await window.api.deleteMemory({ id })
      setMemories((current) => current.filter((memory) => memory.id !== id))
      if (selectedId === id) setSelectedId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not forget this memory.')
    }
  }

  const stats = useMemo(() => {
    if (memories.length === 0) return { total: 0, accessed: 0, avgRelevance: 0 }
    const accessed = memories.filter((m) => m.accessCount > 0).length
    const avgRelevance = memories.reduce((sum, m) => sum + m.relevance, 0) / memories.length
    return { total: memories.length, accessed, avgRelevance: Math.round(avgRelevance * 100) / 100 }
  }, [memories])

  const visible = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return memories.filter((memory) => {
      if (layer !== 'all' && !LAYER_CATEGORIES[layer].includes(memory.category)) return false
      if (filterCategory !== 'all' && memory.category !== filterCategory) return false
      if (!query) return true
      return memory.key.toLowerCase().includes(query) || memory.value.toLowerCase().includes(query)
    })
  }, [memories, layer, filterCategory, searchQuery])

  /** Edges come from shared category or at least one meaningful shared word. */
  const edges = useMemo(() => {
    const list: Array<{ a: string; b: string; shared: string[] }> = []
    const tokenMap = new Map(memories.map((memory) => [memory.id, tokensOf(memory)]))
    for (let i = 0; i < memories.length; i += 1) {
      for (let j = i + 1; j < memories.length; j += 1) {
        const first = memories[i]
        const second = memories[j]
        const firstTokens = tokenMap.get(first.id) ?? new Set<string>()
        const secondTokens = tokenMap.get(second.id) ?? new Set<string>()
        const shared = [...firstTokens].filter((token) => secondTokens.has(token)).slice(0, 4)
        if (shared.length > 0 || first.category === second.category) {
          list.push({ a: first.id, b: second.id, shared })
        }
      }
    }
    return list
  }, [memories])

  const neighborIndex = useMemo(() => {
    const index = new Map<string, Set<string>>()
    for (const edge of edges) {
      if (!index.has(edge.a)) index.set(edge.a, new Set())
      if (!index.has(edge.b)) index.set(edge.b, new Set())
      index.get(edge.a)!.add(edge.b)
      index.get(edge.b)!.add(edge.a)
    }
    return index
  }, [edges])

  const graphNodes = useMemo(() => {
    if (!neighborhoodOnly || !selectedId) return visible
    const neighbors = neighborIndex.get(selectedId) ?? new Set<string>()
    return visible.filter((memory) => memory.id === selectedId || neighbors.has(memory.id))
  }, [visible, neighborhoodOnly, selectedId, neighborIndex])

  const graphEdges = useMemo(() => {
    const ids = new Set(graphNodes.map((memory) => memory.id))
    return edges.filter((edge) => ids.has(edge.a) && ids.has(edge.b))
  }, [edges, graphNodes])

  const positions = useMemo(() => {
    const ordered = [...graphNodes].sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key))
    const count = ordered.length
    const radius = count <= 2 ? 100 : 138
    const center = { x: 320, y: 190 }
    const map = new Map<string, { x: number; y: number }>()
    ordered.forEach((memory, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2
      map.set(memory.id, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius
      })
    })
    return map
  }, [graphNodes])

  const selected = memories.find((memory) => memory.id === selectedId) ?? null
  const connected = selectedId ? (neighborIndex.get(selectedId)?.size ?? 0) : 0

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
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <circle cx="6" cy="12" r="2.2" />
              <circle cx="17" cy="6" r="2.2" />
              <circle cx="18" cy="17" r="2.2" />
              <path strokeLinecap="round" d="M8 11 15 7M9 13.5l7 2.5M17 8.3l.7 6.4" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-textMain">Memory graph</h1>
            <p className="text-sm text-textMuted">What the OS remembers about you, your work, and the way you operate.</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border border-white/[0.07] bg-white/[0.02] p-0.5">
            <button
              onClick={() => setMode('graph')}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${mode === 'graph' ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Graph
            </button>
            <button
              onClick={() => setMode('list')}
              className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${mode === 'list' ? 'bg-white/[0.09] text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              List
            </button>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="rounded-lg border border-white/[0.08] bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
          >
            {showCreate ? 'Cancel' : '+ New memory'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.05] px-3 py-2 text-[11px] text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/[0.06] bg-bgCard p-3.5">
          <div className="text-xl font-semibold tabular-nums text-textMain">{loading ? '…' : stats.total}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-textMuted">Memories</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bgCard p-3.5">
          <div className="text-xl font-semibold tabular-nums text-textMain">{stats.accessed}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-textMuted">Recently used</div>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-bgCard p-3.5">
          <div className="text-xl font-semibold tabular-nums text-cyan-300">{Math.round(stats.avgRelevance * 100)}%</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wide text-textMuted">Avg relevance</div>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-white/[0.06] bg-bgCard p-4 space-y-3">
          <h3 className="text-sm font-medium text-textMain">Create a memory</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-textMuted">Category</label>
              <select
                value={newMemory.category}
                onChange={(e) => setNewMemory({ ...newMemory, category: e.target.value as MemoryCategory })}
                className="w-full rounded-lg border border-borderSubtle bg-bgInput px-3 py-2 text-sm text-textMain focus:border-cyan-400/40 focus:outline-none"
              >
                {CATEGORIES.map((key) => (
                  <option key={key} value={key}>{CATEGORY_CONFIG[key].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-textMuted">Key</label>
              <input
                value={newMemory.key}
                onChange={(e) => setNewMemory({ ...newMemory, key: e.target.value })}
                placeholder="memory-key"
                className="w-full rounded-lg border border-borderSubtle bg-bgInput px-3 py-2 text-sm text-textMain placeholder:text-textMuted/50 focus:border-cyan-400/40 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-textMuted">Value</label>
            <textarea
              value={newMemory.value}
              onChange={(e) => setNewMemory({ ...newMemory, value: e.target.value })}
              placeholder="What should the OS remember?"
              rows={2}
              className="w-full resize-none rounded-lg border border-borderSubtle bg-bgInput px-3 py-2 text-sm text-textMain placeholder:text-textMuted/50 focus:border-cyan-400/40 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-textMuted transition-colors hover:text-textMain">Cancel</button>
            <button
              onClick={createMemory}
              disabled={!newMemory.key.trim() || !newMemory.value.trim()}
              className="rounded-lg bg-white px-4 py-1.5 text-xs font-semibold text-zinc-900 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-textMuted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keys and values…"
            className="w-full rounded-xl border border-borderSubtle bg-bgInput py-2 pl-10 pr-4 text-sm text-textMain placeholder:text-textMuted/50 focus:border-cyan-400/40 focus:outline-none"
          />
        </div>
        <div className="flex rounded-xl border border-borderSubtle bg-bgInput p-0.5">
          {(['all', 'personal', 'operating'] as Layer[]).map((value) => (
            <button
              key={value}
              onClick={() => setLayer(value)}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] capitalize transition-colors ${layer === value ? 'bg-white/[0.09] text-white' : 'text-textMuted hover:text-textMain'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setFilterCategory('all')}
          className={`rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${filterCategory === 'all' ? 'border-white/[0.16] bg-white/[0.08] text-white' : 'border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:text-zinc-300'}`}
        >
          All relationships
        </button>
        {CATEGORIES.map((category) => {
          const config = CATEGORY_CONFIG[category]
          const active = filterCategory === category
          return (
            <button
              key={category}
              onClick={() => setFilterCategory(active ? 'all' : category)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${active ? 'border-white/[0.16] bg-white/[0.08] text-white' : 'border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:text-zinc-300'}`}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.hex }} />
              {config.label}
            </button>
          )
        })}
        {selectedId && (
          <button
            onClick={() => setNeighborhoodOnly((value) => !value)}
            className={`ml-auto rounded-full border px-2.5 py-1 text-[10.5px] transition-colors ${neighborhoodOnly ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200' : 'border-white/[0.06] bg-white/[0.02] text-zinc-500 hover:text-zinc-300'}`}
            title="Show only the selected memory and its direct connections"
          >
            Neighborhood only
          </button>
        )}
      </div>

      {mode === 'graph' ? (
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div className="relative min-h-[360px] overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0d1119]">
            {loading ? (
              <div className="flex h-full min-h-[360px] items-center justify-center gap-2 px-6 text-sm text-textMuted">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400/60 border-t-transparent" />
                Loading memory…
              </div>
            ) : memories.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="text-sm text-zinc-300">Nothing is remembered yet.</div>
                <p className="max-w-sm text-[11px] leading-relaxed text-zinc-500">
                  Memories are written as you work. Add one now, or ask Infinite to remember something in chat.
                </p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-1 rounded-lg bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-100"
                >
                  Add the first memory
                </button>
              </div>
            ) : graphNodes.length === 0 ? (
              <div className="flex h-full min-h-[360px] items-center justify-center px-6 text-center text-sm text-textMuted">
                No memories match this view.
              </div>
            ) : (
              <svg viewBox="0 0 640 380" className="h-full min-h-[360px] w-full" role="img" aria-label="Memory relationship graph">
                <defs>
                  <radialGradient id="memory-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.10" />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="320" cy="190" r="170" fill="url(#memory-glow)" />
                {graphEdges.map((edge) => {
                  const from = positions.get(edge.a)
                  const to = positions.get(edge.b)
                  if (!from || !to) return null
                  const touchesSelection = selectedId === edge.a || selectedId === edge.b
                  return (
                    <line
                      key={`${edge.a}:${edge.b}`}
                      x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                      stroke={touchesSelection ? 'rgba(34,211,238,0.38)' : 'rgba(255,255,255,0.075)'}
                      strokeWidth={touchesSelection ? 1.4 : 1}
                    />
                  )
                })}
                {graphNodes.map((memory) => {
                  const point = positions.get(memory.id)
                  if (!point) return null
                  const config = CATEGORY_CONFIG[memory.category]
                  const isSelected = selectedId === memory.id
                  return (
                    <g
                      key={memory.id}
                      transform={`translate(${point.x} ${point.y})`}
                      onClick={() => setSelectedId(memory.id)}
                      className="cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedId(memory.id) }}
                    >
                      <circle r={isSelected ? 12 : 8} fill={config.hex} fillOpacity={isSelected ? 0.28 : 0.14} stroke={config.hex} strokeOpacity={isSelected ? 0.9 : 0.5} strokeWidth={1.2} />
                      <circle r={isSelected ? 4 : 2.6} fill={config.hex} />
                      <text
                        y={isSelected ? 24 : 19}
                        textAnchor="middle"
                        fontSize="9"
                        fill={isSelected ? '#e4e4e7' : '#a1a1aa'}
                        style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                      >
                        {short(memory.key, 18)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/[0.05] bg-black/30 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
              {graphNodes.length} nodes · {graphEdges.length} edges
            </div>
          </div>

          <aside className="rounded-2xl border border-white/[0.06] bg-bgCard p-4">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-medium ${CATEGORY_CONFIG[selected.category].bg} ${CATEGORY_CONFIG[selected.category].color}`}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: CATEGORY_CONFIG[selected.category].hex }} />
                    {CATEGORY_CONFIG[selected.category].label}
                  </span>
                  <button onClick={() => setSelectedId(null)} className="text-[10px] text-zinc-600 hover:text-zinc-300">Clear</button>
                </div>
                <div>
                  <div className="font-mono text-[11px] text-zinc-500">{selected.key}</div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-200">{selected.value}</p>
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
                    <span>Relevance</span><span className="tabular-nums">{Math.round(selected.relevance * 100)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full" style={{ width: `${selected.relevance * 100}%`, background: CATEGORY_CONFIG[selected.category].hex }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10.5px] text-zinc-500">
                  <div className="rounded-lg border border-white/[0.05] bg-black/20 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-zinc-600">Connections</div>
                    <div className="mt-0.5 text-zinc-300">{connected}</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-black/20 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-zinc-600">Accessed</div>
                    <div className="mt-0.5 text-zinc-300">{selected.accessCount}×</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-black/20 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-zinc-600">Created</div>
                    <div className="mt-0.5 text-zinc-300">{formatDate(selected.createdAt)}</div>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] bg-black/20 px-2 py-1.5">
                    <div className="text-[9px] uppercase tracking-wide text-zinc-600">Last used</div>
                    <div className="mt-0.5 text-zinc-300">{formatDate(selected.lastAccessed)}</div>
                  </div>
                </div>
                <button
                  onClick={() => deleteMemory(selected.id)}
                  className="w-full rounded-lg border border-rose-400/15 bg-rose-500/[0.06] px-3 py-1.5 text-[11px] text-rose-300 transition-colors hover:bg-rose-500/10"
                >
                  Forget this memory
                </button>
              </div>
            ) : (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center text-center">
                <div className="text-[11px] text-zinc-500">Select a node to see what it holds and what it connects to.</div>
                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-700">shared words · shared layer</div>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visible.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-bgCard p-8 text-center">
              <p className="text-sm text-textMuted">{memories.length === 0 ? 'Nothing is remembered yet' : 'No memories match this view'}</p>
              <p className="mt-1 text-xs text-textMuted/50">
                {memories.length === 0
                  ? 'Add the first memory, or ask Infinite to remember something in chat.'
                  : 'Try a different search, layer, or relationship filter.'}
              </p>
            </div>
          ) : visible.map((memory) => {
            const config = CATEGORY_CONFIG[memory.category]
            return (
              <div
                key={memory.id}
                className={`rounded-xl border bg-bgCard p-4 transition-colors ${selectedId === memory.id ? 'border-cyan-400/30' : 'border-white/[0.06] hover:border-white/[0.1]'}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(memory.id)}>
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium ${config.bg} ${config.color}`}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: config.hex }} />
                        {config.label}
                      </span>
                      <span className="font-mono text-[11px] text-textMuted">{memory.key}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-textMain">{memory.value}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10.5px] text-textMuted">
                      <span className="tabular-nums">{Math.round(memory.relevance * 100)}% relevant</span>
                      <span>{memory.accessCount} views</span>
                      <span>{formatDate(memory.lastAccessed)}</span>
                      <span>{neighborIndex.get(memory.id)?.size ?? 0} connections</span>
                    </div>
                  </button>
                  <button
                    onClick={() => deleteMemory(memory.id)}
                    aria-label={`Forget ${memory.key}`}
                    className="rounded-lg p-1.5 text-textMuted/50 transition-all hover:bg-red-500/10 hover:text-red-400"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] px-4 py-3">
        <h3 className="text-[11px] font-medium text-zinc-300">How the graph reads</h3>
        <p className="mt-1 text-[10.5px] leading-relaxed text-zinc-600">
          Personal covers preferences and patterns. Operating covers context, facts, and workflows. Edges mean two memories share a
          relationship or a meaningful word — the graph never invents connections that are not in the text.
        </p>
      </div>
    </div>
  )
}
