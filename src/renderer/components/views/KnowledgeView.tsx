import { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  Plus,
  Search,
  Trash2,
  Edit3,
  Save,
  Tag,
  FolderOpen,
  FileText,
  ChevronRight,
  Hash,
} from 'lucide-react';

type Category = 'Code' | 'Design' | 'Business' | 'Research' | 'Personal' | 'General';

interface KnowledgeEntry {
  id: string;
  title: string;
  category: Category;
  tags: string[];
  content: string;
  fileName: string | null;
  createdAt: number;
  updatedAt: number;
}

const CATEGORIES: Category[] = ['Code', 'Design', 'Business', 'Research', 'Personal', 'General'];

const CATEGORY_COLORS: Record<Category, string> = {
  Code: 'from-emerald-500 to-teal-500',
  Design: 'from-pink-500 to-rose-500',
  Business: 'from-amber-500 to-orange-500',
  Research: 'from-cyan-500 to-blue-500',
  Personal: 'from-violet-500 to-purple-500',
  General: 'from-slate-500 to-gray-500',
};

const CATEGORY_TEXT: Record<Category, string> = {
  Code: 'text-emerald-400',
  Design: 'text-pink-400',
  Business: 'text-amber-400',
  Research: 'text-cyan-400',
  Personal: 'text-violet-400',
  General: 'text-slate-400',
};

function SimpleMarkdown({ content }: { content: string }) {
  const blocks = useMemo(() => {
    const result: { type: 'heading' | 'list' | 'paragraph' | 'blank' | 'blockquote' | 'code'; level?: number; text: string; lang?: string }[] = [];
    const allLines = content.split('\n');
    let i = 0;
    while (i < allLines.length) {
      const line = allLines[i];
      const trimmed = line.trimStart();
      if (trimmed === '') { result.push({ type: 'blank', text: '' }); i++; continue; }
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < allLines.length && !allLines[i].trimStart().startsWith('```')) { codeLines.push(allLines[i]); i++; }
        result.push({ type: 'code', text: codeLines.join('\n'), lang: lang || undefined });
        i++;
        continue;
      }
      if (trimmed.startsWith('### ')) { result.push({ type: 'heading', level: 3, text: trimmed.slice(4) }); i++; continue; }
      if (trimmed.startsWith('## ')) { result.push({ type: 'heading', level: 2, text: trimmed.slice(3) }); i++; continue; }
      if (trimmed.startsWith('# ')) { result.push({ type: 'heading', level: 1, text: trimmed.slice(2) }); i++; continue; }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) { result.push({ type: 'list', text: trimmed.slice(2) }); i++; continue; }
      if (trimmed.startsWith('> ')) { result.push({ type: 'blockquote', text: trimmed.slice(2) }); i++; continue; }
      result.push({ type: 'paragraph', text: trimmed }); i++;
    }
    return result;
  }, [content]);

  return (
    <div className="text-sm text-textMain leading-relaxed space-y-1">
      {blocks.map((block, i) => {
        if (block.type === 'blank') return <div key={i} className="h-2" />;
        if (block.type === 'heading') {
          const cls = block.level === 1 ? 'text-xl font-bold mt-6 mb-2' : block.level === 2 ? 'text-lg font-bold mt-5 mb-1' : 'text-base font-bold mt-4 mb-1';
          return <div key={i} className={`${cls} text-textMain`}>{block.text}</div>;
        }
        if (block.type === 'list') {
          return <div key={i} className="flex items-start gap-2 ml-2"><ChevronRight size={14} className="text-textMuted mt-0.5 flex-shrink-0" /><span>{renderInline(block.text)}</span></div>;
        }
        if (block.type === 'code') {
          return <pre key={i} className="bg-bgInput border border-white/[0.04] rounded-lg p-3 text-xs font-mono text-textMain overflow-x-auto my-2">{block.text}</pre>;
        }
        if (block.type === 'blockquote') {
          return <blockquote key={i} className="border-l-2 border-indigo-500/40 pl-3 text-textMuted italic my-1">{block.text}</blockquote>;
        }
        return <p key={i}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-bold text-textMain">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-bgInput border border-white/[0.04] rounded px-1 py-0.5 text-xs font-mono text-indigo-300">{part.slice(1, -1)}</code>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function KnowledgeView() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [filterCategory, setFilterCategory] = useState<Category | 'All'>('All');

  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState<Category>('General');
  const [formTags, setFormTags] = useState('');
  const [formContent, setFormContent] = useState('');

  // Business knowledge base: company facts + uploaded files (PDF/Excel/CSV).
  // Separate from the Memory tab (the agent's own memory). The agent reads
  // this through the BusinessKnowledge tool; Brain recall includes top hits.
  const toEntry = (r: {
    id: unknown; title: unknown; tags: unknown; content: unknown; fileName: unknown; createdAt: unknown; updatedAt: unknown;
  }): KnowledgeEntry => {
    const tags = Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    const cat = tags.find((t) => t.startsWith('cat:'))?.slice(4);
    return {
      id: String(r.id),
      title: typeof r.title === 'string' && r.title ? r.title : 'Untitled',
      category: (CATEGORIES as string[]).includes(cat ?? '') ? (cat as Category) : 'General',
      tags: tags.filter((t) => !t.startsWith('cat:')),
      content: typeof r.content === 'string' ? r.content : '',
      fileName: typeof r.fileName === 'string' ? r.fileName : null,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
    };
  };

  const reload = async () => {
    try {
      const rows = (await window.api.kbList()) as Array<{
        id: unknown; title: unknown; tags: unknown; content: unknown; fileName: unknown; createdAt: unknown; updatedAt: unknown;
      }>;
      setEntries((Array.isArray(rows) ? rows : []).map(toEntry));
    } catch { /* store unavailable — view stays empty */ }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, []);

  const filteredEntries = useMemo(() => {
    let list = entries;
    if (filterCategory !== 'All') {
      list = list.filter((e) => e.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (e) => e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q)
      );
    }
    return list;
  }, [entries, filterCategory, searchQuery]);

  const selectedEntry = entries.find((e) => e.id === selectedId) || null;

  const openCreate = () => {
    setFormTitle('');
    setFormCategory('General');
    setFormTags('');
    setFormContent('');
    setShowCreate(true);
    setEditingId(null);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setFormTitle(entry.title);
    setFormCategory(entry.category);
    setFormTags(entry.tags.join(', '));
    setFormContent(entry.content);
    setEditingId(entry.id);
    setShowCreate(true);
  };

  const handleSave = async () => {
    if (!formTitle.trim()) return;

    const tags = formTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const mergedTags = [...tags.filter((t) => !t.startsWith('cat:')), `cat:${formCategory}`];

    try {
      if (editingId) {
        await window.api.kbSave({ id: editingId, title: formTitle.trim(), tags: mergedTags, content: formContent });
      } else {
        const saved = (await window.api.kbSave({ title: formTitle.trim(), tags: mergedTags, content: formContent })) as { id?: string } | null;
        if (saved && typeof saved.id === 'string') setSelectedId(saved.id);
      }
      await reload();
    } catch { /* keep the form open on failure */ return; }

    setShowCreate(false);
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    try {
      await window.api.kbDelete({ id });
    } catch { /* fall through to local removal */ }
    setEntries((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const handleAttach = async () => {
    try {
      const picked = (await window.api.pickFile()) as string | null;
      if (!picked) return;
      setLoading(true);
      const saved = (await window.api.kbAttach({ path: picked })) as { id?: string } | null;
      await reload();
      if (saved && typeof saved.id === 'string') setSelectedId(saved.id);
    } catch {
      setLoading(false);
    }
  };

  const categoryCount = useMemo(() => {
    const counts: Record<string, number> = { All: entries.length };
    CATEGORIES.forEach((c) => {
      counts[c] = entries.filter((e) => e.category === c).length;
    });
    return counts;
  }, [entries]);

  return (
    <div className="h-full flex bg-[#0a0a0f]">
      <div className="w-72 flex-shrink-0 border-r border-white/10 flex flex-col bg-[#0d0d11]">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen size={14} className="text-textMuted" />
              <span className="text-xs font-semibold text-textMuted uppercase tracking-wider">Knowledge</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleAttach}
                title="Attach PDF, Excel, CSV, or text file"
                className="h-7 px-2 rounded-lg bg-white/[0.04] border border-white/10 flex items-center gap-1 text-zinc-300 hover:bg-white/[0.08] transition-all text-[11px]"
              >
                <FolderOpen size={13} /> Attach file
              </button>
              <button
                onClick={openCreate}
                title="New knowledge entry"
                className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-300 hover:bg-indigo-500/30 transition-all"
              >
              <Plus size={14} />
              </button>
            </div>
          </div>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-textMuted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries..."
              className="w-full bg-bgInput border border-white/[0.06] rounded-lg pl-8 pr-3 py-1.5 text-xs text-textMain placeholder-textMuted focus:outline-none focus:border-indigo-500/40 transition-all"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setFilterCategory('All')}
              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                filterCategory === 'All'
                  ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                  : 'text-textMuted hover:text-textMain border border-transparent'
              }`}
            >
              All ({categoryCount.All})
            </button>
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-2 py-1 rounded-md text-[10px] font-medium transition-all ${
                  filterCategory === cat
                    ? `${CATEGORY_TEXT[cat]} bg-white/[0.06] border border-white/10`
                    : 'text-textMuted hover:text-textMain border border-transparent'
                }`}
              >
                {cat} ({categoryCount[cat] || 0})
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {filteredEntries.length === 0 ? (
            <div className="p-4 text-center">
              <FileText size={24} className="mx-auto mb-2 text-textMuted opacity-30" />
              <p className="text-xs text-textMuted">
                {loading ? 'Loading knowledge…' : searchQuery ? 'No matching entries' : 'No entries yet'}
              </p>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`w-full text-left px-4 py-3 border-b border-white/[0.04] transition-all ${
                  selectedId === entry.id
                    ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`w-5 h-5 rounded flex-shrink-0 bg-gradient-to-br ${CATEGORY_COLORS[entry.category]} flex items-center justify-center mt-0.5`}>
                    <FolderOpen size={10} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-textMain truncate font-medium">{entry.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] font-medium ${CATEGORY_TEXT[entry.category]}`}>
                        {entry.category}
                      </span>
                      {entry.tags.length > 0 && (
                        <span className="text-[10px] text-textMuted truncate">
                          {entry.tags.slice(0, 2).join(', ')}
                          {entry.tags.length > 2 && ` +${entry.tags.length - 2}`}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-textMuted mt-0.5 block">
                      {new Date(entry.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {showCreate ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-fade-in">
            <div className="max-w-2xl mx-auto">
              <h2 className="text-lg font-bold text-textMain mb-5 flex items-center gap-2">
                {editingId ? <Edit3 size={18} className="text-indigo-400" /> : <Plus size={18} className="text-indigo-400" />}
                {editingId ? 'Edit Entry' : 'New Entry'}
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-1.5 block">Title</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Entry title"
                    className="input-premium"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-1.5 block">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFormCategory(cat)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                          formCategory === cat
                            ? `bg-white/[0.06] ${CATEGORY_TEXT[cat]} border-white/10`
                            : 'text-textMuted hover:text-textMain border-white/[0.04]'
                        }`}
                      >
                        <div className={`w-2.5 h-2.5 rounded-sm bg-gradient-to-br ${CATEGORY_COLORS[cat]}`} />
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-1.5 block">Tags</label>
                  <div className="relative">
                    <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-textMuted" />
                    <input
                      type="text"
                      value={formTags}
                      onChange={(e) => setFormTags(e.target.value)}
                      placeholder="tag1, tag2, tag3"
                      className="input-premium pl-9"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted uppercase tracking-wider mb-1.5 block">Content (Markdown)</label>
                  <textarea
                    value={formContent}
                    onChange={(e) => setFormContent(e.target.value)}
                    placeholder="Write content in markdown..."
                    rows={12}
                    className="input-premium resize-none font-mono text-xs leading-relaxed"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={!formTitle.trim()}
                    className="btn-premium flex items-center gap-2 disabled:opacity-50"
                  >
                    <Save size={14} />
                    {editingId ? 'Update' : 'Create'}
                  </button>
                  <button
                    onClick={() => { setShowCreate(false); setEditingId(null); }}
                    className="px-4 py-2 text-textMuted hover:text-textMain text-sm transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : selectedEntry ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 animate-fade-in">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-6 h-6 rounded bg-gradient-to-br ${CATEGORY_COLORS[selectedEntry.category]} flex items-center justify-center`}>
                      <FolderOpen size={12} className="text-white" />
                    </div>
                    <span className={`text-xs font-medium ${CATEGORY_TEXT[selectedEntry.category]}`}>
                      {selectedEntry.category}
                    </span>
                  </div>
                  <h1 className="text-xl font-bold text-textMain">{selectedEntry.title}</h1>
                  {selectedEntry.fileName && (
                    <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-md px-2 py-0.5">
                      <FileText size={11} /> {selectedEntry.fileName}
                    </div>
                  )}
                  <div className="text-xs text-textMuted mt-1">
                    Created {new Date(selectedEntry.createdAt).toLocaleString()}
                    {selectedEntry.updatedAt !== selectedEntry.createdAt && (
                      <span> &middot; Updated {new Date(selectedEntry.updatedAt).toLocaleString()}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(selectedEntry)}
                    className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-textMuted hover:text-textMain hover:border-white/10 transition-all"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(selectedEntry.id)}
                    className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {selectedEntry.tags.length > 0 && (
                <div className="flex items-center gap-2 mb-5 flex-wrap">
                  <Tag size={12} className="text-textMuted" />
                  {selectedEntry.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-md bg-bgInput border border-white/[0.06] text-[10px] font-medium text-textMuted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-5">
                {selectedEntry.content ? (
                  <SimpleMarkdown content={selectedEntry.content} />
                ) : (
                  <p className="text-sm text-textMuted italic">No content yet.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center mb-4">
              <BookOpen size={32} className="text-indigo-400/60" />
            </div>
            <h3 className="text-lg font-semibold text-textMain mb-2">Knowledge Base</h3>
            <p className="text-sm text-textMuted max-w-md mb-4">
              Select an entry from the sidebar or create a new one to get started.
            </p>
            <button onClick={openCreate} className="btn-premium flex items-center gap-2">
              <Plus size={14} />
              New Entry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

