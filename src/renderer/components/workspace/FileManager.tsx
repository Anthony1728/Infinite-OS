import { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode2,
  FileJson2,
  FileText,
  FileImage,
  FileArchive,
  File,
  Braces,
  Palette,
  Globe,
  TerminalSquare,
  Settings2,
  BookOpen,
} from 'lucide-react';
import { joinSystemPath, normalizeSystemPath, parentSystemPath, type SystemRoots } from '../../lib/systemPaths';

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

const EXT_ICONS: Record<string, { Icon: typeof File; color: string }> = {
  ts: { Icon: FileCode2, color: 'text-sky-400' },
  tsx: { Icon: FileCode2, color: 'text-cyan-400' },
  js: { Icon: FileCode2, color: 'text-yellow-400' },
  jsx: { Icon: FileCode2, color: 'text-cyan-400' },
  json: { Icon: FileJson2, color: 'text-amber-400' },
  md: { Icon: BookOpen, color: 'text-slate-300' },
  css: { Icon: Palette, color: 'text-fuchsia-400' },
  html: { Icon: Globe, color: 'text-orange-400' },
  py: { Icon: FileCode2, color: 'text-emerald-400' },
  rs: { Icon: FileCode2, color: 'text-orange-400' },
  go: { Icon: FileCode2, color: 'text-cyan-400' },
  java: { Icon: FileCode2, color: 'text-red-400' },
  rb: { Icon: FileCode2, color: 'text-rose-400' },
  php: { Icon: FileCode2, color: 'text-indigo-400' },
  c: { Icon: FileCode2, color: 'text-sky-400' },
  cpp: { Icon: FileCode2, color: 'text-sky-400' },
  sh: { Icon: TerminalSquare, color: 'text-lime-400' },
  bat: { Icon: TerminalSquare, color: 'text-lime-400' },
  yml: { Icon: Settings2, color: 'text-zinc-400' },
  yaml: { Icon: Settings2, color: 'text-zinc-400' },
  toml: { Icon: Settings2, color: 'text-zinc-400' },
  xml: { Icon: Braces, color: 'text-zinc-400' },
  txt: { Icon: FileText, color: 'text-zinc-400' },
  png: { Icon: FileImage, color: 'text-violet-400' },
  jpg: { Icon: FileImage, color: 'text-violet-400' },
  jpeg: { Icon: FileImage, color: 'text-violet-400' },
  gif: { Icon: FileImage, color: 'text-violet-400' },
  svg: { Icon: FileImage, color: 'text-violet-400' },
  webp: { Icon: FileImage, color: 'text-violet-400' },
  ico: { Icon: FileImage, color: 'text-violet-400' },
  pdf: { Icon: FileText, color: 'text-red-400' },
  doc: { Icon: FileText, color: 'text-sky-400' },
  docx: { Icon: FileText, color: 'text-sky-400' },
  zip: { Icon: FileArchive, color: 'text-amber-400' },
  tar: { Icon: FileArchive, color: 'text-amber-400' },
  gz: { Icon: FileArchive, color: 'text-amber-400' },
};

function getFileIconMeta(name: string, isDir: boolean, open = false): { Icon: typeof File; color: string } {
  if (isDir) return { Icon: open ? FolderOpen : Folder, color: 'text-amber-300/80' };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? { Icon: File, color: 'text-zinc-500' };
}

function FileIcon({ name, isDir, open = false, className = 'w-4 h-4' }: { name: string; isDir: boolean; open?: boolean; className?: string }) {
  const { Icon, color } = getFileIconMeta(name, isDir, open);
  return <Icon className={`${className} ${color} flex-shrink-0`} strokeWidth={1.7} />;
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
  const [cwd, setCwd] = useState(() => {
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
  const [addressPath, setAddressPath] = useState(cwd);
  const [systemRoots, setSystemRoots] = useState<SystemRoots>({ home: '', common: [], drives: [] });

  const loadDir = useCallback(async (dirPath: string) => {
    const targetPath = normalizeSystemPath(dirPath);
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    setFileContent('');
    setDirty(false);
    try {
      const result: DirData | { error: string } = await window.api.fileRead({ path: targetPath });
      if ('error' in result) {
        setError(result.error);
        setEntries([]);
      } else if (result.type === 'directory') {
        const sorted = result.entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
        setPath(targetPath);
        setAddressPath(targetPath);
      }
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void window.api.fileSystemRoots().then((roots: SystemRoots) => setSystemRoots(roots));
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

  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && selectedFile) {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [saveFile, selectedFile]);

  const createFile = useCallback(async () => {
    const name = window.prompt('New file name');
    if (!name?.trim()) return;
    const filePath = joinSystemPath(path, name.trim());
    const result = await window.api.fileWrite({ path: filePath, content: '' }) as { error?: string };
    if (result?.error) { setError(result.error); return; }
    await loadDir(path);
    await loadFile(filePath);
  }, [loadDir, loadFile, path]);

  const createFolder = useCallback(async () => {
    const name = window.prompt('New folder name');
    if (!name?.trim()) return;
    const folderPath = joinSystemPath(path, name.trim());
    const result = await window.api.fileMkdir({ path: folderPath }) as { error?: string };
    if (result?.error) { setError(result.error); return; }
    await loadDir(path);
  }, [loadDir, path]);

  const chooseFolder = useCallback(async () => {
    const folder = await window.api.pickDirectory();
    if (!folder) return;
    setCwd(folder);
    setHistory([folder]);
    setHistoryIndex(0);
    await loadDir(folder);
  }, [loadDir]);

  const renameSelected = useCallback(async () => {
    if (!selectedFile) return;
    const oldName = selectedFile.split(/[\\/]/).pop() ?? selectedFile;
    const name = window.prompt('Rename file', oldName)?.trim();
    if (!name || name === oldName) return;
    const newPath = selectedFile.replace(/[^\\/]+$/, name);
    const result = await window.api.fileRename({ oldPath: selectedFile, newPath }) as { error?: string };
    if (result?.error) { setError(result.error); return; }
    setSelectedFile(newPath);
    await loadDir(path);
    await loadFile(newPath);
  }, [loadDir, loadFile, path, selectedFile]);

  const deleteSelected = useCallback(async () => {
    if (!selectedFile || !window.confirm(`Delete ${selectedFile.split(/[\\/]/).pop()}?`)) return;
    const result = await window.api.fileDelete({ path: selectedFile }) as { error?: string };
    if (result?.error) { setError(result.error); return; }
    setSelectedFile(null);
    setFileContent('');
    setDirty(false);
    await loadDir(path);
  }, [loadDir, path, selectedFile]);

  const pushHistory = useCallback((p: string) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(p);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [history, historyIndex]);

  const navigateUp = useCallback(() => {
    if (!path) return;
    const parent = parentSystemPath(path);
    if (parent === path) return;
    pushHistory(parent);
    void loadDir(parent);
  }, [loadDir, path, pushHistory]);

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
    const fullPath = joinSystemPath(path, entry.name);
    if (entry.isDirectory) {
      pushHistory(fullPath);
      loadDir(fullPath);
    } else {
      loadFile(fullPath);
    }
  };

  useEffect(() => {
    setHistory([cwd]);
    setHistoryIndex(0);
    void loadDir(cwd);
  }, [cwd, loadDir]);

  const navigateTo = useCallback((target: string) => {
    const normalized = normalizeSystemPath(target);
    if (!normalized) return;
    pushHistory(normalized);
    void loadDir(normalized);
  }, [loadDir, pushHistory]);

  const filteredEntries = search
    ? entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const relativePath = selectedFile
    ? selectedFile.split(/[\\/]/).pop() ?? selectedFile
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
          <button onClick={() => void chooseFolder()} className="h-7 rounded-lg border border-white/8 px-2.5 text-[10px] text-textMuted hover:bg-white/5 hover:text-textMain" title="Open another folder">Open Folder</button>
          <button onClick={() => void createFile()} className="h-7 rounded-lg border border-white/8 px-2.5 text-[10px] text-textMuted hover:bg-white/5 hover:text-textMain" title="Create a file in this folder">New File</button>
          <button onClick={() => void createFolder()} className="h-7 rounded-lg border border-white/8 px-2.5 text-[10px] text-textMuted hover:bg-white/5 hover:text-textMain" title="Create a folder here">New Folder</button>
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
          {selectedFile && <button onClick={() => void renameSelected()} className="h-7 rounded-lg border border-white/8 px-2 text-[10px] text-textMuted hover:text-textMain">Rename</button>}
          {selectedFile && <button onClick={() => void deleteSelected()} className="h-7 rounded-lg border border-red-500/15 px-2 text-[10px] text-red-400/80 hover:bg-red-500/10">Delete</button>}
        </div>
        <form
          className="mb-2 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigateTo(addressPath);
          }}
        >
          <span className="text-[10px] font-medium uppercase tracking-wider text-textMuted/60">Path</span>
          <input
            value={addressPath}
            onChange={(event) => setAddressPath(event.target.value)}
            className="h-7 flex-1 rounded-lg border border-white/8 bg-white/5 px-2.5 font-mono text-[11px] text-textMain outline-none focus:ring-1 focus:ring-indigo-500/40"
            aria-label="System file path"
            spellCheck={false}
          />
          <button type="submit" className="h-7 rounded-lg border border-white/8 px-3 text-[10px] text-textMuted hover:bg-white/5 hover:text-textMain">Go</button>
        </form>
        <div className="flex items-center gap-1 text-[10px] text-textMuted/70 truncate">
          <span className="font-mono" title={path}>{path}</span>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 flex">
        <aside className="w-44 flex-shrink-0 overflow-y-auto border-r border-borderSubtle bg-bgPanel/20 p-2 custom-scrollbar">
          <div className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-textMuted/50">Locations</div>
          {[...systemRoots.common, ...systemRoots.drives].map((location) => (
            <button
              key={`${location.kind}:${location.path}`}
              type="button"
              onClick={() => navigateTo(location.path)}
              title={location.path}
              className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
                normalizeSystemPath(path) === normalizeSystemPath(location.path)
                  ? 'bg-indigo-500/15 text-indigo-300'
                  : 'text-textMuted hover:bg-white/[0.04] hover:text-textMain'
              }`}
            >
              <span>{location.kind === 'drive' ? '▣' : location.name === 'Home' ? '⌂' : '◇'}</span>
              <span className="truncate">{location.name}</span>
            </button>
          ))}
        </aside>
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
            const fullPath = joinSystemPath(path, entry.name);
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
                <FileIcon name={entry.name} isDir={entry.isDirectory} open={isSelected} className="w-3.5 h-3.5" />
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
                <FileIcon name={selectedFile.split('/').pop() ?? ''} isDir={false} className="w-3.5 h-3.5" />
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
                  <div className="mb-3 flex justify-center"><FileIcon name={relativePath.split('/').pop() ?? ''} isDir={false} className="w-10 h-10" /></div>
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

