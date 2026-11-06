import { useState, useEffect, useCallback, useRef } from 'react';
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
  Film,
  Music,
  Copy,
  ExternalLink,
  Trash2,
  Edit3,
  Image as ImageIcon,
  Grid3X3,
  List,
} from 'lucide-react';
import { joinSystemPath, normalizeSystemPath, parentSystemPath } from '../../lib/systemPaths';

interface DirEntry {
  name: string;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
  ext?: string;
}

interface FileData {
  type: 'file';
  content: string;
  size: number;
  isBinary?: boolean;
  mimeType?: string;
  encoding?: string;
  tooLarge?: boolean;
  mtime?: number;
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
function formatDate(ms?: number): string {
  if (!ms) return '';
  try { return new Date(ms).toLocaleString(); } catch { return ''; }
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
  bmp: { Icon: FileImage, color: 'text-violet-400' },
  mp4: { Icon: Film, color: 'text-pink-400' },
  webm: { Icon: Film, color: 'text-pink-400' },
  mov: { Icon: Film, color: 'text-pink-400' },
  avi: { Icon: Film, color: 'text-pink-400' },
  mkv: { Icon: Film, color: 'text-pink-400' },
  mp3: { Icon: Music, color: 'text-emerald-400' },
  wav: { Icon: Music, color: 'text-emerald-400' },
  ogg: { Icon: Music, color: 'text-emerald-400' },
  flac: { Icon: Music, color: 'text-emerald-400' },
  m4a: { Icon: Music, color: 'text-emerald-400' },
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

const IMAGE_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','svg']);
const VIDEO_EXTS = new Set(['mp4','webm','mov','avi','mkv','m4v']);
const AUDIO_EXTS = new Set(['mp3','wav','ogg','flac','m4a','aac','wma']);

function isImageExt(name: string): boolean {
  return IMAGE_EXTS.has((name.split('.').pop() ?? '').toLowerCase());
}
function isVideoExt(name: string): boolean {
  return VIDEO_EXTS.has((name.split('.').pop() ?? '').toLowerCase());
}
function isAudioExt(name: string): boolean {
  return AUDIO_EXTS.has((name.split('.').pop() ?? '').toLowerCase());
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
  const [fileMeta, setFileMeta] = useState<Pick<FileData,'isBinary'|'mimeType'|'size'|'tooLarge'|'encoding'|'mtime'> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [addressPath, setAddressPath] = useState(cwd);
  const [fmCreate, setFmCreate] = useState<null | { type: 'file' | 'folder'; name: string }>(null);
  const [fmRename, setFmRename] = useState<null | { oldPath: string; name: string }>(null);
  const [fmDelete, setFmDelete] = useState<null | { path: string }>(null);
  const [viewMode, setViewMode] = useState<'list'|'grid'>(() => {
    try { return (localStorage.getItem('infinite:fm-view') as 'list'|'grid') ?? 'list'; } catch { return 'list'; }
  });
  const [contextMenu, setContextMenu] = useState<null | { x:number; y:number; entry: DirEntry; fullPath: string }>(null);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const contextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = () => setContextMenu(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

  const loadDir = useCallback(async (dirPath: string) => {
    const targetPath = normalizeSystemPath(dirPath);
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    setFileContent('');
    setFileMeta(null);
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
        setFileMeta({ isBinary: result.isBinary, mimeType: result.mimeType, size: result.size, tooLarge: result.tooLarge, encoding: result.encoding });
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && selectedFile && !fileMeta?.isBinary) {
        event.preventDefault();
        void saveFile();
      }
    };
    window.addEventListener('keydown', handleSaveShortcut);
    return () => window.removeEventListener('keydown', handleSaveShortcut);
  }, [saveFile, selectedFile, fileMeta]);

  const createFile = useCallback(() => {
    setFmCreate({ type: 'file', name: '' });
  }, []);
  const commitFmCreate = useCallback(async () => {
    if (!fmCreate || !fmCreate.name.trim()) return;
    const raw = fmCreate.name.trim();
    // Windows forbids <>:"|?* and C0 controls in names.
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1F]/.test(raw) || raw === '.' || raw === '..') { setError('Invalid name'); return; }
    const filePath = joinSystemPath(path, raw);
    let result: { error?: string } | undefined;
    if (fmCreate.type === 'folder') {
      result = await (window.api as unknown as { fileMkdir: (a:{path:string})=>Promise<{error?:string}> }).fileMkdir({ path: filePath });
    } else {
      result = await window.api.fileWrite({ path: filePath, content: '' }) as { error?: string };
    }
    if (result?.error) { setError(result.error); return; }
    setFmCreate(null);
    await loadDir(path);
    if (fmCreate.type === 'file') await loadFile(filePath);
  }, [fmCreate, loadDir, loadFile, path]);

  const createFolder = useCallback(() => {
    setFmCreate({ type: 'folder', name: '' });
  }, []);

  const chooseFolder = useCallback(async () => {
    const folder = await window.api.pickDirectory();
    if (!folder) return;
    setCwd(folder);
    setHistory([folder]);
    setHistoryIndex(0);
    await loadDir(folder);
  }, [loadDir]);

  const renameSelected = useCallback(() => {
    if (!selectedFile) return;
    const oldName = selectedFile.split(/[\\/]/).pop() ?? selectedFile;
    setFmRename({ oldPath: selectedFile, name: oldName });
  }, [selectedFile]);
  const commitFmRename = useCallback(async () => {
    if (!fmRename) return;
    const raw = fmRename.name.trim();
    if (!raw || raw === fmRename.oldPath.split(/[\\/]/).pop()) { setFmRename(null); return; }
    // Windows forbids <>:"|?* and C0 controls in names.
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1F]/.test(raw)) { setError('Invalid name'); return; }
    const parent = fmRename.oldPath.substring(0, Math.max(fmRename.oldPath.lastIndexOf('/'), fmRename.oldPath.lastIndexOf('\\')));
    const newPath = joinSystemPath(parent || path, raw);
    const result = await window.api.fileRename({ oldPath: fmRename.oldPath, newPath }) as { error?: string };
    if (result?.error) { setError(result.error); return; }
    setFmRename(null);
    setSelectedFile(newPath);
    await loadDir(path);
    await loadFile(newPath);
  }, [fmRename, loadDir, loadFile, path]);

  const deleteSelected = useCallback(() => {
    if (!selectedFile) return;
    setFmDelete({ path: selectedFile });
  }, [selectedFile]);
  const confirmFmDelete = useCallback(async () => {
    if (!fmDelete) return;
    const result = await window.api.fileDelete({ path: fmDelete.path }) as { error?: string };
    if (result?.error) { setError(result.error); return; }
    setFmDelete(null);
    setSelectedFile(null);
    setFileContent('');
    setFileMeta(null);
    setDirty(false);
    await loadDir(path);
  }, [fmDelete, loadDir, path]);

  const pushHistory = useCallback((p: string) => {
    setHistory(prev => {
      // Use functional update to avoid stale closure
      const idx = historyIndex;
      const newHistory = prev.slice(0, idx + 1);
      newHistory.push(p);
      return newHistory;
    });
    setHistoryIndex(i => i + 1);
  }, [historyIndex]);

  const navigateUp = useCallback(() => {
    if (!path) return;
    const parent = parentSystemPath(path);
    if (parent === path) return;
    pushHistory(parent);
    void loadDir(parent);
  }, [loadDir, path, pushHistory]);

  const goBack = () => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      loadDir(history[nextIdx]);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      loadDir(history[nextIdx]);
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

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => {
      const next = prev === 'list' ? 'grid' : 'list';
      try { localStorage.setItem('infinite:fm-view', next); } catch { /* private mode, ignore */ }
      return next;
    });
  }, []);

  const handleContextMenu = (e: React.MouseEvent, entry: DirEntry) => {
    e.preventDefault();
    const fullPath = joinSystemPath(path, entry.name);
    setContextMenu({ x: e.clientX, y: e.clientY, entry, fullPath });
  };

  const openExternally = async (filePath: string) => {
    const res = await window.api.fileOpen({ path: filePath }) as { error?: string };
    if (res?.error) setError(res.error);
  };

  const duplicateEntry = async (fullPath: string) => {
    const dir = fullPath.substring(0, Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\')));
    const base = fullPath.split(/[\\/]/).pop() ?? 'copy';
    const extIdx = base.lastIndexOf('.');
    const nameNoExt = extIdx > 0 ? base.slice(0, extIdx) : base;
    const ext = extIdx > 0 ? base.slice(extIdx) : '';
    const dest = joinSystemPath(dir, `${nameNoExt} - Copy${ext}`);
    const api = window.api as unknown as { fileCopy:(a:{src:string;dest:string})=>Promise<{error?:string}> };
    const res = await api.fileCopy({ src: fullPath, dest });
    if (res?.error) setError(res.error);
    else await loadDir(path);
  };

  const copyPath = async (fullPath: string) => {
    try { await navigator.clipboard.writeText(fullPath); } catch { setError('Clipboard unavailable'); }
  };

  const filteredEntries = search
    ? entries.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
    : entries;

  const relativePath = selectedFile
    ? selectedFile.split(/[\\/]/).pop() ?? selectedFile
    : '';

  const isPreviewImage = !!selectedFile && !!fileMeta?.isBinary && fileMeta?.mimeType?.startsWith('image/');
  const isPreviewVideo = !!selectedFile && !!fileMeta?.isBinary && fileMeta?.mimeType?.startsWith('video/');
  const isPreviewAudio = !!selectedFile && !!fileMeta?.isBinary && fileMeta?.mimeType?.startsWith('audio/');
  const isPreviewPdf = !!selectedFile && fileMeta?.mimeType === 'application/pdf';
  const canEdit = !!selectedFile && !fileMeta?.isBinary && isEditable(relativePath);

  const renderPreview = () => {
    if (!selectedFile || !fileMeta) return null;
    if (fileMeta.tooLarge) {
      return (
        <div className="flex-1 flex items-center justify-center text-textMuted text-xs p-6">
          <div className="text-center max-w-sm">
            <div className="mb-3 flex justify-center"><FileIcon name={relativePath} isDir={false} className="w-10 h-10" /></div>
            <div className="font-medium text-textMain mb-1">{relativePath}</div>
            <div className="mb-3">{formatSize(fileMeta.size ?? 0)} — too large for inline preview.</div>
            <button onClick={() => void openExternally(selectedFile)} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-textMain flex items-center gap-1.5 mx-auto">
              <ExternalLink className="w-3 h-3" /> Open externally
            </button>
          </div>
        </div>
      );
    }
    if (isPreviewImage) {
      const src = `data:${fileMeta.mimeType};base64,${fileContent}`;
      return (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-[#0a0a0f] flex items-center justify-center p-4">
          <img src={src} alt={relativePath} className="max-w-full max-h-full object-contain rounded-lg shadow-xl border border-white/10" />
        </div>
      );
    }
    if (isPreviewVideo) {
      const src = `data:${fileMeta.mimeType};base64,${fileContent}`;
      return (
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar bg-black flex flex-col items-center justify-center p-4 gap-3">
          <video src={src} controls className="max-w-full max-h-[70vh] rounded-lg shadow-xl border border-white/10" />
          <div className="text-[10px] text-zinc-500">{relativePath} · {formatSize(fileMeta.size ?? 0)}</div>
        </div>
      );
    }
    if (isPreviewAudio) {
      const src = `data:${fileMeta.mimeType};base64,${fileContent}`;
      return (
        <div className="flex-1 flex items-center justify-center p-6 bg-[#0a0a0f]">
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <Music className="w-10 h-10 mx-auto mb-3 text-emerald-400" />
            <div className="text-sm text-textMain font-medium mb-1 truncate">{relativePath}</div>
            <div className="text-[10px] text-zinc-500 mb-4">{formatSize(fileMeta.size ?? 0)} · {fileMeta.mimeType}</div>
            <audio src={src} controls className="w-full" />
          </div>
        </div>
      );
    }
    if (isPreviewPdf) {
      const src = `data:application/pdf;base64,${fileContent}`;
      return (
        <div className="flex-1 min-h-0 bg-white">
          <iframe src={src} title={relativePath} className="w-full h-full border-0" />
        </div>
      );
    }
    if (canEdit) {
      return (
        <textarea
          value={fileContent}
          onChange={(e) => { setFileContent(e.target.value); setDirty(true); }}
          className="flex-1 w-full bg-bgMain text-zinc-300 font-mono text-xs leading-relaxed p-4 outline-none resize-none custom-scrollbar"
          spellCheck={false}
        />
      );
    }
    // Fallback binary / non-editable
    return (
      <div className="flex-1 flex items-center justify-center text-textMuted text-xs p-6">
        <div className="text-center max-w-sm">
          <div className="mb-3 flex justify-center"><FileIcon name={relativePath} isDir={false} className="w-10 h-10" /></div>
          <div className="font-medium text-textMain mb-1">{relativePath}</div>
          <div className="mb-1">{formatSize(fileMeta.size ?? fileContent.length)} · {fileMeta.mimeType ?? 'binary'}</div>
          {fileMeta?.mtime ? <div className="text-[10px] text-zinc-500 mb-3">{formatDate(fileMeta.mtime)}</div> : null}
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => void openExternally(selectedFile!)} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-textMain flex items-center gap-1.5">
              <ExternalLink className="w-3 h-3" /> Open externally
            </button>
            <button onClick={() => void copyPath(selectedFile!)} className="px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-xs text-textMuted flex items-center gap-1.5">
              <Copy className="w-3 h-3" /> Copy path
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar - Clean and minimal */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--os-line)] bg-[var(--os-surface-2)]/90 backdrop-blur-[12px]">
        <div className="flex items-center gap-2 mb-2.5">
          <button onClick={goBack} disabled={historyIndex <= 0}
            className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain disabled:opacity-30 transition-all"
            title="Back">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
          </button>
          <button onClick={goForward} disabled={historyIndex >= history.length - 1}
            className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain disabled:opacity-30 transition-all"
            title="Forward">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
          </button>
          <button onClick={navigateUp}
            className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
            title="Up one folder">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          </button>
          <button onClick={() => loadDir(path)}
            className="w-8 h-8 rounded-lg hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
            title="Refresh">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
          </button>
          <button onClick={() => void chooseFolder()} className="h-8 rounded-lg border border-white/8 px-3 text-xs text-textMuted hover:bg-white/5 hover:text-textMain" title="Open another folder">Open Folder</button>
          <button onClick={() => void createFile()} className="h-8 rounded-lg border border-white/8 px-3 text-xs text-textMuted hover:bg-white/5 hover:text-textMain" title="Create a file in this folder">New File</button>
          <button onClick={() => void createFolder()} className="h-8 rounded-lg border border-white/8 px-3 text-xs text-textMuted hover:bg-white/5 hover:text-textMain" title="Create a folder here">New Folder</button>
          <button onClick={toggleViewMode} className="w-8 h-8 rounded-lg border border-white/8 flex items-center justify-center text-textMuted hover:text-textMain hover:bg-white/5" title={viewMode === 'list' ? 'Grid view' : 'List view'}>
            {viewMode === 'list' ? <Grid3X3 className="w-4 h-4" /> : <List className="w-4 h-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter files..."
              className="w-full h-8 rounded-lg bg-white/5 border border-white/8 px-3 text-sm placeholder:text-textMuted/50 focus:outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--os-accent)_40%,transparent)]"
            />
          </div>
          {selectedFile && !fileMeta?.isBinary && dirty && (
            <button onClick={saveFile}
              className="h-8 px-3.5 rounded-lg bg-[color-mix(in_srgb,var(--os-accent)_84%,#4338ca)] hover:bg-[color-mix(in_srgb,var(--os-accent)_92%,#4338ca)] shadow-[0_0_14px_color-mix(in_srgb,var(--os-accent)_18%,transparent)] text-white text-xs font-medium flex items-center gap-1.5 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              Save
            </button>
          )}
          {selectedFile && <button onClick={() => void openExternally(selectedFile)} className="h-8 rounded-lg border border-white/8 px-2.5 text-xs text-textMuted hover:text-textMain flex items-center gap-1.5" title="Open with system default app"><ExternalLink className="w-3.5 h-3.5" /> Open</button>}
          {selectedFile && <button onClick={() => void renameSelected()} className="h-8 rounded-lg border border-white/8 px-2.5 text-xs text-textMuted hover:text-textMain">Rename</button>}
          {selectedFile && <button onClick={() => void deleteSelected()} className="h-8 rounded-lg border border-red-500/15 px-2.5 text-xs text-red-400/80 hover:bg-red-500/10">Delete</button>}
        </div>
        <form
          className="mb-2.5 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigateTo(addressPath);
          }}
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-textMuted/60">Path</span>
          <input
            value={addressPath}
            onChange={(event) => setAddressPath(event.target.value)}
            className="h-8 flex-1 rounded-lg border border-white/8 bg-white/5 px-3 font-mono text-xs text-textMain outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--os-accent)_40%,transparent)]"
            aria-label="System file path"
            spellCheck={false}
          />
          <button type="submit" className="h-8 rounded-lg border border-white/8 px-3.5 text-xs text-textMuted hover:bg-[color-mix(in_srgb,var(--os-accent)_10%,rgba(255,255,255,.05))] hover:text-[color-mix(in_srgb,var(--os-accent)_70%,white)] hover:border-[color-mix(in_srgb,var(--os-accent)_20%,transparent)]">Go</button>
        </form>
        <div className="flex items-center gap-1 text-xs text-textMuted/70 truncate flex-wrap">
          {path.split(/[\\/]/).filter(Boolean).map((seg: string, i: number, arr: string[]) => {
            const isLast = i === arr.length - 1;
            const built = (path.startsWith('\\\\') ? '\\\\' : path.startsWith('/') ? '/' : '') + arr.slice(0, i + 1).join(path.includes('\\') ? '\\' : '/') + (path.includes('\\') && !path.endsWith('\\') && i < arr.length - 1 ? '' : '');
            const display = seg;
            return (
              <span key={i} className="flex items-center gap-1">
                <button
                  onClick={() => navigateTo(arr.slice(0, i + 1).join(path.includes('\\') ? '\\' : '/') + (path.match(/^[A-Za-z]:/) && i === 0 ? '\\' : ''))}
                  className={`px-1.5 py-1 rounded ${isLast ? 'text-[color-mix(in_srgb,var(--os-accent)_72%,white)] bg-[color-mix(in_srgb,var(--os-accent)_10%,transparent)]' : 'hover:text-textMain hover:bg-white/[0.06]'}`}
                  title={built}
                >
                  {display}
                </button>
                {!isLast && <span className="text-textMuted/40">/</span>}
              </span>
            );
          })}
          {path.split(/[\\/]/).filter(Boolean).length === 0 && <span className="font-mono" title={path}>{path}</span>}
        </div>
      </div>

      {/* Content area - Full width file list */}
      <div className="flex-1 min-h-0 flex">
        {/* File tree / grid - Full width */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
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
          {viewMode === 'list' ? (
            <>
              {/* Header */}
              {filteredEntries.length > 0 && (
                <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-textMuted/50 bg-bgPanel/80 backdrop-blur border-b border-white/[0.04]">
                  <span className="flex-1">Name</span>
                  <span className="w-20 text-right">Size</span>
                  <span className="w-28 text-right hidden sm:block">Modified</span>
                </div>
              )}
              {filteredEntries.map((entry: DirEntry) => {
                const fullPath = joinSystemPath(path, entry.name);
                const isSelected = selectedFile === fullPath;
                const checked = selectedEntries.has(fullPath);
                return (
                  <div
                    key={entry.name}
                    onClick={() => openEntry(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    className={`w-full flex items-center gap-3 py-2.5 px-3 text-sm transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[color-mix(in_srgb,var(--os-accent)_13%,transparent)] text-[color-mix(in_srgb,var(--os-accent)_76%,white)] border-l-2 border-[var(--os-accent)]'
                        : 'text-textMain/90 hover:text-textMain hover:bg-[color-mix(in_srgb,var(--os-accent)_7%,rgba(255,255,255,.03))] hover:border-l-2 hover:border-[color-mix(in_srgb,var(--os-accent)_22%,transparent)]'
                    }`}
                  >
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      e.stopPropagation();
                      setSelectedEntries(prev => {
                        const next = new Set(prev);
                        if (next.has(fullPath)) next.delete(fullPath); else next.add(fullPath);
                        return next;
                      });
                    }} onClick={(e) => e.stopPropagation()} className="w-3.5 h-3.5 rounded accent-[var(--os-accent)]" />
                    <FileIcon name={entry.name} isDir={entry.isDirectory} open={isSelected} className="w-5 h-5" />
                    <span className="flex-1 truncate text-left">{entry.name}</span>
                    <span className="w-20 text-right text-xs text-textMuted/70">{entry.isDirectory ? '—' : formatSize(entry.size ?? 0)}</span>
                    <span className="w-28 text-right text-xs text-textMuted/50 hidden sm:block">{entry.mtime ? formatDate(entry.mtime).split(',')[0] : ''}</span>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-3">
              {filteredEntries.map((entry: DirEntry) => {
                const fullPath = joinSystemPath(path, entry.name);
                const isSelected = selectedFile === fullPath;
                return (
                  <button
                    key={entry.name}
                    onClick={() => openEntry(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    onDoubleClick={() => {
                      const fp = joinSystemPath(path, entry.name);
                      if (!entry.isDirectory) void openExternally(fp);
                    }}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                      isSelected ? 'bg-[color-mix(in_srgb,var(--os-accent)_13%,transparent)] border-[var(--os-accent)] text-white' : 'border-white/5 hover:border-white/10 hover:bg-white/[0.03] text-textMuted'
                    }`}
                  >
                    {entry.isDirectory ? <Folder className="w-10 h-10 text-amber-300/70" strokeWidth={1.7} /> : isImageExt(entry.name) ? <ImageIcon className="w-10 h-10 text-violet-400" /> : isVideoExt(entry.name) ? <Film className="w-10 h-10 text-pink-400" /> : isAudioExt(entry.name) ? <Music className="w-10 h-10 text-emerald-400" /> : <FileIcon name={entry.name} isDir={false} className="w-10 h-10" />}
                    <span className="text-xs leading-tight line-clamp-2 break-all w-full">{entry.name}</span>
                    <span className="text-[11px] text-textMuted/50">{entry.isDirectory ? '' : formatSize(entry.size ?? 0)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Preview / Editor pane */}
        {selectedFile && (
          <div className="flex-1 min-w-0 flex flex-col border-l border-[var(--os-line)]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-borderSubtle bg-bgPanel/30">
              <div className="flex items-center gap-2 min-w-0">
                <FileIcon name={selectedFile.split(/[\\/]/).pop() ?? ''} isDir={false} className="w-4 h-4" />
                <span className="text-sm text-textMain truncate font-medium">{relativePath}</span>
                {dirty && <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" title="Unsaved changes" />}
                {fileMeta?.isBinary && fileMeta?.mimeType ? <span className="text-[11px] text-zinc-500 hidden sm:inline">{fileMeta.mimeType} · {formatSize(fileMeta.size ?? 0)}</span> : null}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => void openExternally(selectedFile)} className="w-7 h-7 rounded hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain" title="Open externally"><ExternalLink className="w-3.5 h-3.5" /></button>
                <button onClick={() => { setSelectedFile(null); setFileContent(''); setFileMeta(null); setDirty(false); }}
                  className="w-6 h-6 rounded hover:bg-white/5 flex items-center justify-center text-textMuted hover:text-textMain transition-all"
                  title="Close">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
            {renderPreview()}
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-white/10 bg-[#1a1d27] shadow-2xl py-1"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 190), top: Math.min(contextMenu.y, window.innerHeight - 200) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { openEntry(contextMenu.entry); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"><FolderOpen className="w-3.5 h-3.5" /> Open</button>
          <button onClick={() => { void openExternally(contextMenu.fullPath); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"><ExternalLink className="w-3.5 h-3.5" /> Open externally</button>
          <button onClick={() => { void copyPath(contextMenu.fullPath); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> Copy path</button>
          <button onClick={() => { void duplicateEntry(contextMenu.fullPath); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Copy className="w-3.5 h-3.5" /> Duplicate</button>
          <div className="my-1 border-t border-white/5" />
          <button onClick={() => { setFmRename({ oldPath: contextMenu.fullPath, name: contextMenu.entry.name }); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-white/5 flex items-center gap-2"><Edit3 className="w-3.5 h-3.5" /> Rename</button>
          <button onClick={() => { setFmDelete({ path: contextMenu.fullPath }); setContextMenu(null); }} className="w-full px-3 py-2 text-left text-[13px] text-red-400 hover:bg-red-500/10 flex items-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
        </div>
      )}

      {/* Status bar */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-borderSubtle bg-bgPanel/30 flex items-center justify-between text-xs text-textMuted/70">
        <span>{filteredEntries.length} items {search ? `(filtered from ${entries.length})` : ''}{selectedEntries.size > 0 ? ` · ${selectedEntries.size} selected` : ''}</span>
        <span className="hidden sm:inline truncate ml-2">{path}</span>
      </div>
      {fmCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setFmCreate(null)}>
          <div className="bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-300 mb-2">{fmCreate.type === 'folder' ? 'New Folder' : 'New File'}</div>
            <div className="text-[11px] text-textMuted mb-2 truncate">In: {path}</div>
            <input
              value={fmCreate.name}
              onChange={(e) => setFmCreate({ ...fmCreate, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitFmCreate(); if (e.key === 'Escape') setFmCreate(null); }}
              placeholder={fmCreate.type === 'folder' ? 'Folder name' : 'File name e.g. notes.txt'}
              className="w-full h-8 rounded bg-white/5 border border-[var(--os-line)] px-3 text-xs text-white placeholder:text-textMuted/50 outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--os-accent)_40%,transparent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setFmCreate(null)} className="px-3 py-1.5 text-[11px] text-textMuted hover:text-white">Cancel</button>
              <button onClick={() => void commitFmCreate()} className="px-3 py-1.5 text-[11px] bg-[var(--os-accent)] hover:opacity-90 text-white rounded">Create</button>
            </div>
          </div>
        </div>
      )}
      {fmRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setFmRename(null)}>
          <div className="bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-300 mb-2">Rename</div>
            <input
              value={fmRename.name}
              onChange={(e) => setFmRename({ ...fmRename, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') void commitFmRename(); if (e.key === 'Escape') setFmRename(null); }}
              className="w-full h-8 rounded bg-white/5 border border-[var(--os-line)] px-3 text-xs text-white outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--os-accent)_40%,transparent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setFmRename(null)} className="px-3 py-1.5 text-[11px] text-textMuted hover:text-white">Cancel</button>
              <button onClick={() => void commitFmRename()} className="px-3 py-1.5 text-[11px] bg-[var(--os-accent)] hover:opacity-90 text-white rounded">Rename</button>
            </div>
          </div>
        </div>
      )}
      {fmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setFmDelete(null)}>
          <div className="bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-medium text-white mb-1">Delete?</div>
            <div className="text-[11px] text-textMuted mb-3 break-all">{fmDelete.path}</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setFmDelete(null)} className="px-3 py-1.5 text-[11px] text-textMuted hover:text-white">Cancel</button>
              <button onClick={() => void confirmFmDelete()} className="px-3 py-1.5 text-[11px] bg-red-600 hover:bg-red-500 text-white rounded">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
