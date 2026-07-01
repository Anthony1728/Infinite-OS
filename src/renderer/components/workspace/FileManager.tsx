import { useState, useEffect, useCallback } from 'react';

interface DirEntry {
  name: string;
  isDirectory: boolean;
}

interface FileData {
  type: 'file';
  content: string;
  size: number;
}

interface DirData {
  type: 'directory';
  entries: DirEntry[];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const EXT_ICONS: Record<string, string> = {
  ts: '📘', tsx: '⚛', js: '📒', jsx: '⚛', json: '📋', md: '📝', css: '🎨', html: '🌐',
  py: '🐍', rs: '🦀', go: '🔷', java: '☕', rb: '💎', php: '🐘', c: '🔧', cpp: '⚙',
  sh: '🖥', bat: '🖥', yml: '⚙', yaml: '⚙', toml: '⚙', xml: '📋', txt: '📄',
  png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: '🖼', webp: '🖼', ico: '🖼',
  pdf: '📕', doc: '📘', docx: '📘', zip: '📦', tar: '📦', gz: '📦',
};

function getFileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? '📄';
}

function isEditable(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const editable = new Set([
    'ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'html', 'py', 'rs', 'go',
    'java', 'rb', 'php', 'c', 'cpp', 'h', 'hpp', 'sh', 'bat', 'yml', 'yaml',
    'toml', 'xml', 'txt', 'env', 'gitignore', 'dockerfile', 'makefile', 'csv',
    'sql', 'prisma', 'graphql', 'vue', 'svelte', 'astro', 'config', 'ini', 'cfg',
  ]);
  return editable.has(ext) || name.toLowerCase() === 'dockerfile' || name.toLowerCase() === 'makefile';
}

export function FileManager() {
  const [cwd] = useState(() => {
    try {
      const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      return cur.cwd ?? '.';
    } catch { return '.'; }
  });
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [path, setPath] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const loadDir = useCallback(async (dirPath: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    setFileContent('');
    setDirty(false);
    try {
      const result: DirData | { error: string } = await window.api.fileRead({ path: dirPath });
      if ('error' in result) {
        setError(result.error);
        setEntries([]);
      } else if (result.type === 'directory') {
        const sorted = result.entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
        setPath(dirPath);
      }
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    }
    setLoading(false);
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    setLoading(true);
    setError(null);
    try {
      const result: FileData | { error: string } = await window.api.fileRead({ path: filePath });
      if ('error' in result) {
        setError(result.error);
      } else if (result.type === 'file') {
        setSelectedFile(filePath);
        setFileContent(result.content);
        setDirty(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, []);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    setLoading(true);
    try {
      const result: { ok?: boolean; error?: string } = await window.api.fileWrite({ path: selectedFile, content: fileContent });
      if (result.error) {
        setError(result.error);
      } else {
        setDirty(false);
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [selectedFile, fileContent]);

  const navigateUp = useCallback(() => {
    if (!path) return;
    const parts = path.replace(/\\/g, '/').split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    pushHistory(parent);
    loadDir(parent);
  }, [path, loadDir]);

  const pushHistory = (p: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(p);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      loadDir(history[historyIndex - 1]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      loadDir(history[historyIndex + 1]);
    }
  };

  const openEntry = (entry: DirEntry) => {
    const fullPath = path.replace(/\\/g, '/').replace(/\/?$/, '/') + entry.name;
    if (entry.isDirectory) {
      pushHistory(fullPath);
      loadDir(fullPath);
    } else {
      loadFile(fullPath);
    }
  };

  useEffect(() => {
    pushHistory(cwd);
    loadDir(cwd);
  }, []);

  const filteredEntries = search
    ? entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const relativePath = selectedFile
    ? selectedFile.replace(path.replace(/\\/g, '/').replace(/\/?$/, '/'), '')
    : '';

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-borderSubtle bg-bgPanel/50">
        <div className="flex items-center gap-2 mb-2">
          <button onClick={goBack} disabled={historyIndex <= 0}
            className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain disabled:opacity-30 transition-all"
            title="Back">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <button onClick={goForward} disabled={historyIndex >= history.length - 1}
            className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain disabled:opacity-30 transition-all"
            title="Forward">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
          <button onClick={navigateUp}
            className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
            title="Up one folder">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </button>
          <button onClick={() => loadDir(path)}
            className="w-7 h-7 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
            title="Refresh">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter files..."
              className="w-full h-7 rounded-lg bg-white/5 border border-white/8 px-2.5 text-xs placeholder:text-textMuted/50 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
            />
          </div>
          {selectedFile && dirty && (
            <button onClick={saveFile}
              className="h-7 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              Save
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-textMuted/70 truncate">
          {path.split(/[/\\]/).filter(Boolean).map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-textMuted/30">/</span>}
              <button
                onClick={() => {
                  const root = path.startsWith('/') ? '' : arr[0];
                  const target = i === 0 ? (root || '/') : arr.slice(0, i + 1).join('/');
                  pushHistory(target);
                  loadDir(target);
                }}
                className="hover:text-indigo-400 transition-colors cursor-pointer"
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex">
        {/* File tree */}
        <div className={`${selectedFile ? 'w-56 border-r border-borderSubtle' : 'flex-1'} overflow-y-auto custom-scrollbar transition-all`}>
          {loading && entries.length === 0 && (
            <div className="flex items-center justify-center h-32 text-textMuted text-xs">Loading...</div>
          )}
          {error && (
            <div className="p-3 text-xs text-red-400 bg-red-400/5 rounded-lg m-2">{error}</div>
          )}
          {!loading && !error && filteredEntries.length === 0 && (
            <div className="flex items-center justify-center h-32 text-textMuted text-xs">
              {search ? 'No matching files' : 'Empty directory'}
            </div>
          )}
          {filteredEntries.map((entry) => {
            const fullPath = path.replace(/\\/g, '/').replace(/\/?$/, '/') + entry.name;
            const isSelected = selectedFile === fullPath;
            return (
              <button
                key={entry.name}
                onClick={() => openEntry(entry)}
                className={`w-full flex items-center gap-2 py-1.5 px-3 text-xs transition-all ${
                  isSelected
                    ? 'bg-indigo-500/15 text-indigo-300'
                    : 'text-textMuted hover:text-textMain hover:bg-white/[0.03]'
                }`}
              >
                <span className="text-sm flex-shrink-0">{getFileIcon(entry.name, entry.isDirectory)}</span>
                <span className="flex-1 truncate text-left">{entry.name}</span>
              </button>
            );
          })}
        </div>

        {/* Editor pane */}
        {selectedFile && (
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-borderSubtle bg-bgPanel/30">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm">{getFileIcon(selectedFile.split('/').pop() ?? '', false)}</span>
                <span className="text-xs text-textMain truncate font-medium">{relativePath}</span>
                {dirty && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved changes" />}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setSelectedFile(null); setFileContent(''); setDirty(false); }}
                  className="w-6 h-6 rounded hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
                  title="Close">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            {isEditable(relativePath.split('/').pop() ?? '') ? (
              <textarea
                value={fileContent}
                onChange={(e) => { setFileContent(e.target.value); setDirty(true); }}
                className="flex-1 w-full bg-bgMain text-zinc-300 font-mono text-xs leading-relaxed p-4 outline-none resize-none custom-scrollbar"
                spellCheck={false}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-textMuted text-xs">
                <div className="text-center">
                  <div className="text-4xl mb-3">{getFileIcon(relativePath.split('/').pop() ?? '', false)}</div>
                  <div className="font-medium text-textMain mb-1">{relativePath.split('/').pop()}</div>
                  <div>Binary or non-editable file ({formatSize(fileContent.length)} chars)</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex-shrink-0 px-3 py-1.5 border-t border-borderSubtle bg-bgPanel/30 flex items-center justify-between text-[10px] text-textMuted/70">
        <span>{filteredEntries.length} items {search ? `(filtered from ${entries.length})` : ''}</span>
        <span>{path}</span>
      </div>
    </div>
  );
}

