import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editor';
import { joinSystemPath, normalizeSystemPath, parentSystemPath, systemBaseName, type SystemRoots } from '../../lib/systemPaths';
import {
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  Terminal,
  PanelBottomOpen,
  PanelBottomClose,
  ChevronLeft,
  ListTree,
  Play,
  Save,
} from 'lucide-react';

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

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  loaded?: boolean;
}

interface OpenTab {
  name: string;
  path: string;
  language: string;
  content: string;
  originalContent: string;
  modified: boolean;
}

interface OutlineItem {
  label: string;
  line: number;
  kind: string;
  children?: OutlineItem[];
}

const FILE_COLORS: Record<string, string> = {
  ts: '#3b82f6',
  tsx: '#3b82f6',
  js: '#eab308',
  jsx: '#eab308',
  json: '#a78bfa',
  css: '#ec4899',
  html: '#f97316',
  md: '#6b7280',
  py: '#22c55e',
  rs: '#f97316',
  go: '#06b6d4',
  sql: '#a78bfa',
  yaml: '#a78bfa',
  yml: '#a78bfa',
  sh: '#84cc16',
  env: '#84cc16',
  gitignore: '#6b7280',
};

function inferLanguage(name: string): string {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
  if (name.endsWith('.js') || name.endsWith('.jsx')) return 'javascript';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.sql')) return 'sql';
  if (name.endsWith('.css')) return 'css';
  if (name.endsWith('.html')) return 'html';
  if (name.endsWith('.md')) return 'markdown';
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.rs')) return 'rust';
  if (name.endsWith('.go')) return 'go';
  if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'yaml';
  return 'plaintext';
}

function getFileColor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return FILE_COLORS[ext] ?? '#6b7280';
}

function extractOutline(content: string, language: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const lines = content.split('\n');
  const patterns: Record<string, RegExp[]> = {
    typescript: [/^\s*(export\s+)?(interface|type|enum|class|function|const|let|var)\s+(\w+)/, /^\s*(export\s+default\s+)?function\s+(\w+)/],
    javascript: [/^\s*(export\s+)?(function|class|const|let|var)\s+(\w+)/, /^\s*(export\s+default\s+)?function\s+(\w+)/],
    python: [/^\s*(class|def|async\s+def)\s+(\w+)/],
    rust: [/^\s*(pub\s+)?(fn|struct|enum|trait|impl|mod)\s+(\w+)/],
    go: [/^\s*(func|type|var|const)\s+(\w+)/],
  };
  const langPatterns = patterns[language] ?? patterns['typescript'];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of langPatterns) {
      const m = line.match(pat);
      if (m) {
        const label = m[m.length - 1];
        const kind = m[2] || 'symbol';
        items.push({ label, line: i + 1, kind });
        break;
      }
    }
  }
  return items.slice(0, 100);
}

function FileExplorer({
  cwd,
  onFileOpen,
  onContextMenu,
  refreshKey,
}: {
  cwd: string;
  onFileOpen: (path: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  refreshKey: number;
}) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    try {
      const result: DirData | { error: string } = await window.api.fileRead({ path: dirPath });
      if ('error' in result) return [];
      if (result.type === 'directory') {
        const sorted = result.entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        return sorted.map((e) => ({
          name: e.name,
          path: joinSystemPath(dirPath, e.name),
          isDirectory: e.isDirectory,
          children: e.isDirectory ? [] : undefined,
          loaded: false,
        }));
      }
    } catch { /* silent */ }
    return [];
  }, []);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    const children = await loadDir(cwd);
    setTree(children);
    setLoading(false);
  }, [cwd, loadDir]);

  useEffect(() => { void loadRoot(); }, [loadRoot, refreshKey]);

  const toggleNode = useCallback(
    async (node: TreeNode) => {
      if (!node.isDirectory) return;
      const newExpanded = new Set(expanded);
      if (expanded.has(node.path)) {
        newExpanded.delete(node.path);
      } else {
        newExpanded.add(node.path);
        if (!node.loaded) {
          const children = await loadDir(node.path);
          const updateChildren = (nodes: TreeNode[]): TreeNode[] =>
            nodes.map((n) => {
              if (n.path === node.path) {
                return { ...n, children, loaded: true };
              }
              if (n.children) {
                return { ...n, children: updateChildren(n.children) };
              }
              return n;
            });
          setTree(updateChildren);
        }
      }
      setExpanded(newExpanded);
    },
    [expanded, loadDir],
  );

  const [creating, setCreating] = useState<null | { type: 'file' | 'folder'; name: string }>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (creating) setTimeout(() => createInputRef.current?.focus(), 0); }, [creating]);

  const commitCreate = useCallback(async () => {
    if (!creating || !creating.name.trim()) return;
    const raw = creating.name.trim();
    // Windows forbids <>:"|?* and C0 controls in names.
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1F]/.test(raw) || raw === '.' || raw === '..') return;
    const fullPath = joinSystemPath(cwd, raw);
    try {
      if (creating.type === 'file') {
        const r: { ok?: boolean; error?: string } = await window.api.fileWrite({ path: fullPath, content: '' });
        if (r.error) throw new Error(r.error);
        await loadRoot();
        onFileOpen(fullPath, raw);
      } else {
        const r: { ok?: boolean; error?: string } = await window.api.fileMkdir({ path: fullPath });
        if ((r as { error?: string }).error) throw new Error((r as { error?: string }).error);
        await loadRoot();
      }
      setCreating(null);
    } catch {
      // keep open to let user correct name
    }
  }, [creating, cwd, loadRoot, onFileOpen]);

  const handleNewFile = useCallback(() => {
    setCreating({ type: 'file', name: '' });
  }, []);
  const handleNewFolder = useCallback(() => {
    setCreating({ type: 'folder', name: '' });
  }, []);

  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expanded.has(node.path);
    const color = node.isDirectory ? '#eab308' : getFileColor(node.name);

    return (
      <div key={node.path}>
        <div
          className="flex items-center gap-1 py-[3px] px-2 cursor-pointer hover:bg-white/5 text-[11px] text-gray-300 group"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => (node.isDirectory ? toggleNode(node) : onFileOpen(node.path, node.name))}
          onContextMenu={(e) => onContextMenu(e, node.path, node.isDirectory)}
        >
          {node.isDirectory ? (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 flex-shrink-0 text-textMuted" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0 text-textMuted" />
            )
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          {node.isDirectory ? (
            isExpanded ? (
              <FolderOpenIcon className="w-3.5 h-3.5 flex-shrink-0 text-yellow-500" />
            ) : (
              <FolderIcon className="w-3.5 h-3.5 flex-shrink-0 text-yellow-500" />
            )
          ) : (
            <FileIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color }} />
          )}
          <span className="truncate flex-1">{node.name}</span>
        </div>
        {node.isDirectory && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[var(--os-surface)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--os-line)] flex-shrink-0">
        <span className="text-[11px] font-medium text-textMuted uppercase tracking-wider">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewFile}
            className="p-1 rounded hover:bg-white/5 text-textMuted hover:text-white transition-colors"
            title="New File"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNewFolder}
            className="p-1 rounded hover:bg-white/5 text-textMuted hover:text-white transition-colors"
            title="New Folder"
          >
            <FolderIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        {creating && (
          <div className="flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md bg-[color-mix(in_srgb,var(--os-accent)_10%,transparent)] border border-[color-mix(in_srgb,var(--os-accent)_18%,transparent)]">
            {creating.type === 'folder' ? <FolderIcon className="w-3.5 h-3.5 text-amber-400" /> : <FileIcon className="w-3.5 h-3.5 text-sky-400" />}
            <input
              ref={createInputRef}
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitCreate();
                if (e.key === 'Escape') setCreating(null);
              }}
              placeholder={creating.type === 'folder' ? 'Folder name' : 'File name'}
              className="flex-1 min-w-0 bg-transparent text-xs text-textMain placeholder:text-textMuted/50 outline-none"
            />
            <button onClick={() => void commitCreate()} className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--os-accent)] text-white hover:opacity-90">Create</button>
            <button onClick={() => setCreating(null)} className="p-1 rounded hover:bg-white/10 text-textMuted"><X className="w-3 h-3" /></button>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8 text-textMuted text-xs">Loading...</div>
        ) : tree.length === 0 && !creating ? (
          <div className="flex items-center justify-center py-8 text-textMuted text-xs">Empty directory</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}

function OutlinePanel({ outline }: { outline: OutlineItem[] }) {
  return (
    <div className="h-full flex flex-col bg-[var(--os-surface)]">
      <div className="flex items-center px-3 py-2 border-b border-[var(--os-line)] flex-shrink-0">
        <span className="text-[11px] font-medium text-textMuted uppercase tracking-wider">Outline</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        {outline.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-textMuted text-xs">No symbols</div>
        ) : (
          outline.map((item, i) => (
            <div
              key={`${item.label}-${item.line}-${i}`}
              className="flex items-center gap-2 py-[3px] px-3 cursor-pointer hover:bg-white/5 text-[11px] text-gray-300"
            >
              <span className="text-[9px] text-gray-600 font-mono w-6 text-right flex-shrink-0">
                {item.line}
              </span>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: item.kind === 'class' ? '#3b82f6' : item.kind === 'function' ? '#eab308' : item.kind === 'interface' ? '#22c55e' : '#a78bfa' }} />
              <span className="truncate">{item.label}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function WorkspaceView() {
  const [cwd, setCwd] = useState(() => {
    try {
      const cur = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
      return cur.cwd ?? '.';
    } catch {
      return '.';
    }
  });

  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState(-1);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [terminalInput, setTerminalInput] = useState('');
  const [outlineData, setOutlineData] = useState<OutlineItem[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [ctxCreate, setCtxCreate] = useState<null | { type: 'file' | 'folder'; parentPath: string; name: string }>(null);
  const [deleteTarget, setDeleteTarget] = useState<null | { path: string }>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [explorerVersion, setExplorerVersion] = useState(0);
  const [workspacePath, setWorkspacePath] = useState(cwd);
  const [systemRoots, setSystemRoots] = useState<SystemRoots>({ home: '', common: [], drives: [] });

  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<unknown>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef<() => void>(() => undefined);

  const openFileStore = useEditorStore((s) => s.openFile);
  const openFileContentStore = useEditorStore((s) => s.openFileContent);
  const openFileLanguageStore = useEditorStore((s) => s.openFileLanguage);
  const launchFileStore = useEditorStore((s) => s.launchFile);
  const clearLaunch = useEditorStore((s) => s.clearLaunch);
  const showAnimation = useEditorStore((s) => s.showAnimation);

  useEffect(() => {
    void window.api.fileSystemRoots().then((roots: SystemRoots) => setSystemRoots(roots));
  }, []);

  const openWorkspacePath = useCallback((target: string) => {
    const normalized = normalizeSystemPath(target);
    if (!normalized) return;
    setCwd(normalized);
    setWorkspacePath(normalized);
  }, []);

  const chooseWorkspaceFolder = useCallback(async () => {
    const folder = await window.api.pickDirectory();
    if (folder) openWorkspacePath(folder);
  }, [openWorkspacePath]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalOutput]);

  useEffect(() => {
    if (!launchFileStore) return;
    void window.api.fileOpen({ path: launchFileStore }).then((result: { ok?: boolean; error?: string }) => {
      setTerminalOutput((prev) => [
        ...prev,
        result.error ? `Error launching ${launchFileStore}: ${result.error}` : `$ Launched ${launchFileStore}`,
      ]);
      clearLaunch();
    });
  }, [launchFileStore, clearLaunch]);

  const handleFileOpenFromStore = useCallback(
    (path: string, name: string, content: string, language: string) => {
      setTabs((prev) => {
        const existing = prev.findIndex((t) => t.path === path);
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = { ...updated[existing], content, originalContent: content, modified: false };
          setActiveTabIndex(existing);
          return updated;
        }
        const newTab: OpenTab = { name, path, language, content, originalContent: content, modified: false };
        setActiveTabIndex(prev.length);
        return [...prev, newTab];
      });
      setOutlineData(extractOutline(content, language));
    },
    [],
  );

  useEffect(() => {
    if (openFileStore && openFileContentStore) {
      const name = systemBaseName(openFileStore);
      handleFileOpenFromStore(openFileStore, name, openFileContentStore, openFileLanguageStore ?? 'plaintext');
      setLeftPanelOpen(false);
      setRightPanelOpen(false);
      setTerminalOpen(false);
    }
  }, [handleFileOpenFromStore, openFileContentStore, openFileLanguageStore, openFileStore]);

  const handleFileOpen = useCallback(async (path: string, name: string) => {
    const existing = tabs.findIndex((t) => t.path === path);
    if (existing >= 0) {
      setActiveTabIndex(existing);
      return;
    }
    try {
      const result: FileData | { error: string } = await window.api.fileRead({ path });
      if ('error' in result) return;
      if (result.type === 'file') {
        const language = inferLanguage(name);
        const newTab: OpenTab = {
          name,
          path,
          language,
          content: result.content,
          originalContent: result.content,
          modified: false,
        };
        setTabs((prev) => [...prev, newTab]);
        setActiveTabIndex(tabs.length);
        setOutlineData(extractOutline(result.content, language));
      }
    } catch { /* silent */ }
  }, [tabs]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current();
    });
  };

  const handleContentChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined || activeTabIndex < 0) return;
      setTabs((prev) => {
        const updated = [...prev];
        if (updated[activeTabIndex]) {
          updated[activeTabIndex] = {
            ...updated[activeTabIndex],
            content: value,
            modified: value !== updated[activeTabIndex].originalContent,
          };
          setOutlineData(extractOutline(value, updated[activeTabIndex].language));
        }
        return updated;
      });
    },
    [activeTabIndex],
  );

  const handleSave = useCallback(async () => {
    const tab = tabs[activeTabIndex];
    if (!tab) return;
    try {
      const result: { ok?: boolean; error?: string } = await window.api.fileWrite({ path: tab.path, content: tab.content });
      if (result.error) {
        setTerminalOutput((prev) => [...prev, `Error saving ${tab.name}: ${result.error}`]);
        return;
      }
      setTabs((prev) => {
        const updated = [...prev];
        if (updated[activeTabIndex]) {
          updated[activeTabIndex] = { ...updated[activeTabIndex], originalContent: tab.content, modified: false };
        }
        return updated;
      });
      setTerminalOutput((prev) => [...prev, `$ Saved ${tab.name}`]);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
  }, [tabs, activeTabIndex]);

  useEffect(() => { saveRef.current = () => { void handleSave(); }; }, [handleSave]);

  const handleCloseTab = useCallback(
    (index: number) => {
      if (tabs[index]?.modified && !window.confirm(`Close ${tabs[index].name} without saving?`)) return;
      setTabs((prev) => prev.filter((_, i) => i !== index));
      setActiveTabIndex((prev) => {
        if (index < prev) return prev - 1;
        if (index >= prev) return Math.min(prev, tabs.length - 2);
        return prev;
      });
    },
    [tabs],
  );

  const handleTerminalSubmit = useCallback(async () => {
    if (!terminalInput.trim()) return;
    const cmd = terminalInput.trim();
    setTerminalOutput((prev) => [...prev, `$ ${cmd}`]);
    setTerminalInput('');
    try {
      const result = await window.api.terminalExecute({ command: cmd, cwd });
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      setTerminalOutput((prev) => [...prev, output]);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
  }, [terminalInput, cwd]);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleCtxNewFile = useCallback(() => {
    if (!contextMenu) return;
    const parentDir = contextMenu.isDir ? contextMenu.path : parentSystemPath(contextMenu.path);
    setCtxCreate({ type: 'file', parentPath: parentDir, name: '' });
    setContextMenu(null);
  }, [contextMenu]);
  const handleCtxNewFolder = useCallback(() => {
    if (!contextMenu) return;
    const parentDir = contextMenu.isDir ? contextMenu.path : parentSystemPath(contextMenu.path);
    setCtxCreate({ type: 'folder', parentPath: parentDir, name: '' });
    setContextMenu(null);
  }, [contextMenu]);
  const commitCtxCreate = useCallback(async () => {
    if (!ctxCreate || !ctxCreate.name.trim()) return;
    const raw = ctxCreate.name.trim();
    // Windows forbids <>:"|?* and C0 controls in names.
    // eslint-disable-next-line no-control-regex
    if (/[<>:"|?*\x00-\x1F]/.test(raw) || raw === '.' || raw === '..') return;
    const fullPath = joinSystemPath(ctxCreate.parentPath, raw);
    try {
      if (ctxCreate.type === 'file') {
        const r: { ok?: boolean; error?: string } = await window.api.fileWrite({ path: fullPath, content: '' });
        if (r.error) throw new Error(r.error);
        setTerminalOutput((prev) => [...prev, `$ Created file ${fullPath}`]);
      } else {
        const r: { ok?: boolean; error?: string } = await window.api.fileMkdir({ path: fullPath });
        if ((r as { error?: string }).error) throw new Error((r as { error?: string }).error);
        setTerminalOutput((prev) => [...prev, `$ Created folder ${fullPath}`]);
      }
      setExplorerVersion((v) => v + 1);
      setCtxCreate(null);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
  }, [ctxCreate]);

  const handleCtxRename = useCallback(() => {
    if (!contextMenu) return;
    setRenamePath(contextMenu.path);
    setRenameValue(systemBaseName(contextMenu.path));
    setContextMenu(null);
  }, [contextMenu]);

  const handleCtxDelete = useCallback(() => {
    if (!contextMenu) return;
    setDeleteTarget({ path: contextMenu.path });
    setContextMenu(null);
  }, [contextMenu]);
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const r: { ok?: boolean; error?: string } = await window.api.fileDelete({ path: deleteTarget.path });
      if (r && (r as { error?: string }).error) throw new Error((r as { error?: string }).error);
      setTerminalOutput((prev) => [...prev, `$ Deleted ${deleteTarget.path}`]);
      setExplorerVersion((v) => v + 1);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget]);

  const submitRename = useCallback(async () => {
    if (!renamePath || !renameValue) return;
    const newPath = joinSystemPath(parentSystemPath(renamePath), renameValue);
    try {
      await window.api.fileRename({ oldPath: renamePath, newPath });
      setTerminalOutput((prev) => [...prev, `$ Renamed to ${newPath}`]);
      setExplorerVersion((value) => value + 1);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
    setRenamePath(null);
    setRenameValue(null);
  }, [renamePath, renameValue]);

  const activeTab = activeTabIndex >= 0 && activeTabIndex < tabs.length ? tabs[activeTabIndex] : null;
  const modifiedCount = tabs.filter((t) => t.modified).length;

  const editorOptions = useMemo(
    () => ({
      minimap: { enabled: true, scale: 1 },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', Menlo, monospace",
      lineNumbers: 'on' as const,
      scrollBeyondLastLine: false,
      wordWrap: 'on' as const,
      padding: { top: 12, bottom: 12 },
      bracketPairColorization: { enabled: true },
      automaticLayout: true,
      formatOnPaste: true,
      formatOnType: true,
      tabSize: 2,
      renderWhitespace: 'selection' as const,
      smoothScrolling: true,
      cursorBlinking: 'smooth' as const,
      cursorSmoothCaretAnimation: 'on' as const,
    }),
    [],
  );

  return (
    <div className="w-full h-full flex flex-col bg-[var(--os-surface)]">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-[var(--os-line)] bg-[var(--os-surface-2)] px-3 py-2">
        <button
          type="button"
          onClick={() => openWorkspacePath(parentSystemPath(cwd))}
          disabled={parentSystemPath(cwd) === normalizeSystemPath(cwd)}
          className="rounded border border-[var(--os-line)] px-2 py-1 text-[10px] text-textMuted hover:bg-white/5 hover:text-white disabled:opacity-30"
          title="Parent folder"
        >
          Up
        </button>
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            openWorkspacePath(workspacePath);
          }}
        >
          <input
            value={workspacePath}
            onChange={(event) => setWorkspacePath(event.target.value)}
            aria-label="Workspace system path"
            className="h-7 min-w-0 flex-1 rounded border border-[var(--os-line)] bg-white/5 px-2 font-mono text-[11px] text-gray-300 outline-none focus:border-[var(--os-accent)]/50"
            spellCheck={false}
          />
          <button type="submit" className="h-7 rounded border border-[var(--os-line)] px-3 text-[10px] text-textMuted hover:bg-white/5 hover:text-white">Go</button>
        </form>
        <button type="button" onClick={() => void chooseWorkspaceFolder()} className="h-7 rounded border border-[var(--os-line)] px-3 text-[10px] text-textMuted hover:bg-white/5 hover:text-white">Open Folder</button>
        <select
          aria-label="System locations"
          value=""
          onChange={(event) => {
            if (event.target.value) openWorkspacePath(event.target.value);
          }}
          className="h-7 max-w-44 rounded border border-[var(--os-line)] bg-[#15151d] px-2 text-[10px] text-gray-300 outline-none"
        >
          <option value="">System locations</option>
          {[...systemRoots.common, ...systemRoots.drives].map((location) => (
            <option key={`${location.kind}:${location.path}`} value={location.path}>{location.name}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-h-0 flex">
        {leftPanelOpen && (
          <div className="w-52 flex-shrink-0 border-r border-[var(--os-line)] overflow-hidden">
            <FileExplorer cwd={cwd} onFileOpen={handleFileOpen} onContextMenu={handleContextMenu} refreshKey={explorerVersion} />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center border-b border-[var(--os-line)] bg-[var(--os-surface)] flex-shrink-0">
            <button
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              className="p-1.5 hover:bg-white/5 text-textMuted hover:text-white transition-colors flex-shrink-0"
              title="Toggle Explorer"
            >
              <ListTree className="w-3.5 h-3.5" />
            </button>
            <div className="flex-1 overflow-x-auto custom-scrollbar flex items-center">
              {tabs.map((tab, i) => (
                <div
                  key={tab.path}
                  className={`group flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 cursor-pointer transition-colors flex-shrink-0 ${
                    activeTabIndex === i
                      ? 'border-[var(--os-accent)] text-white bg-white/[0.03]'
                      : 'border-transparent text-textMuted hover:text-white hover:bg-white/[0.02]'
                  }`}
                  onClick={() => setActiveTabIndex(i)}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: getFileColor(tab.name) }} />
                  <span className="truncate max-w-[100px]">{tab.name}</span>
                  {tab.modified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(i);
                    }}
                    className="opacity-0 group-hover:opacity-100 ml-1 text-textMuted hover:text-red-400 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1 px-2 flex-shrink-0">
              {activeTab && (
                <button
                  onClick={() => void handleSave()}
                  disabled={!activeTab.modified}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-[color-mix(in_srgb,var(--os-accent)_72%,white)] hover:bg-[color-mix(in_srgb,var(--os-accent)_10%,transparent)] disabled:opacity-35"
                  title="Save file (Ctrl+S)"
                >
                  <Save className="w-3 h-3" /> Save
                </button>
              )}
              {activeTab?.name.toLowerCase().endsWith('.html') && (
                <button
                  onClick={() => void window.api.fileOpen({ path: activeTab.path })}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                  title="Launch HTML in your default browser"
                >
                  <Play className="w-3 h-3" />
                  Run
                </button>
              )}
              {modifiedCount > 0 && <span className="text-[10px] text-amber-400">{modifiedCount} unsaved</span>}
              {rightPanelOpen ? (
                <button
                  onClick={() => setRightPanelOpen(false)}
                  className="p-1.5 hover:bg-white/5 text-textMuted hover:text-white transition-colors"
                  title="Hide Outline"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => setRightPanelOpen(true)}
                  className="p-1.5 hover:bg-white/5 text-textMuted hover:text-white transition-colors"
                  title="Show Outline"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div
            className={`flex-1 min-h-0 ${showAnimation ? 'ring-2 ring-indigo-500/50 shadow-lg shadow-indigo-500/20' : ''}`}
          >
            {activeTab ? (
              <Editor
                language={activeTab.language}
                theme="vs-dark"
                value={activeTab.content}
                onChange={handleContentChange}
                onMount={handleEditorMount}
                options={editorOptions}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-textMuted text-sm">
                Open a file from the explorer
              </div>
            )}
          </div>
        </div>

        {rightPanelOpen && (
          <div className="w-48 flex-shrink-0 border-l border-[var(--os-line)] overflow-hidden">
            <OutlinePanel outline={outlineData} />
          </div>
        )}
      </div>

      {terminalOpen && (
        <div className="h-44 flex-shrink-0 border-t border-[var(--os-line)] flex flex-col bg-[var(--os-surface)]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--os-line)] flex-shrink-0">
            <div className="flex items-center gap-1.5 text-textMuted">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Terminal</span>
            </div>
            <button
              onClick={() => setTerminalOpen(false)}
              className="p-1 rounded hover:bg-white/5 text-textMuted hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 font-mono text-[11px] text-gray-300">
            {terminalOutput.map((line, i) => (
              <div key={i} className={line.startsWith('$') ? 'text-textMuted' : line.startsWith('Error') ? 'text-red-400' : 'text-gray-300'}>
                {line}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--os-line)] flex-shrink-0">
            <span className="text-textMuted text-[11px]">$</span>
            <input
              value={terminalInput}
              onChange={(e) => setTerminalInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleTerminalSubmit();
              }}
              className="flex-1 bg-transparent text-[11px] text-gray-300 outline-none font-mono placeholder:text-gray-600"
              placeholder="Enter command..."
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-1 border-t border-[var(--os-line)] bg-[var(--os-surface)] flex-shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-gray-600">
          <span>{activeTab?.language ?? '--'}</span>
          <span>UTF-8</span>
          <span>{cwd}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            className={`p-1 rounded hover:bg-white/5 transition-colors ${terminalOpen ? 'text-gray-300' : 'text-textMuted hover:text-white'}`}
            title="Toggle Terminal"
          >
            {terminalOpen ? <PanelBottomClose className="w-3.5 h-3.5" /> : <PanelBottomOpen className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={handleCtxNewFile} className="w-full px-3 py-1.5 text-left text-[11px] text-gray-300 hover:bg-white/5 hover:text-white">
            New File
          </button>
          <button onClick={handleCtxNewFolder} className="w-full px-3 py-1.5 text-left text-[11px] text-gray-300 hover:bg-white/5 hover:text-white">
            New Folder
          </button>
          <button onClick={handleCtxRename} className="w-full px-3 py-1.5 text-left text-[11px] text-gray-300 hover:bg-white/5 hover:text-white">
            Rename
          </button>
          <div className="mx-2 my-1 border-t border-[var(--os-line)]" />
          <button onClick={handleCtxDelete} className="w-full px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-white/5 hover:text-red-300">
            Delete
          </button>
        </div>
      )}

      {renamePath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setRenamePath(null); setRenameValue(null); }}>
          <div className="bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-300 mb-2">Rename</div>
            <input
              value={renameValue ?? ''}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') { setRenamePath(null); setRenameValue(null); }
              }}
              className="w-full h-8 rounded bg-white/5 border border-[var(--os-line)] px-3 text-xs text-white outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--os-accent)_40%,transparent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => { setRenamePath(null); setRenameValue(null); }} className="px-3 py-1.5 text-[11px] text-textMuted hover:text-white">
                Cancel
              </button>
              <button onClick={submitRename} className="px-3 py-1.5 text-[11px] bg-[var(--os-accent)] hover:opacity-90 text-white rounded">
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
      {ctxCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCtxCreate(null)}>
          <div className="bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-300 mb-2">{ctxCreate.type === 'folder' ? 'New Folder' : 'New File'}</div>
            <div className="text-[11px] text-textMuted mb-2 truncate">In: {ctxCreate.parentPath}</div>
            <input
              value={ctxCreate.name}
              onChange={(e) => setCtxCreate({ ...ctxCreate, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitCtxCreate();
                if (e.key === 'Escape') setCtxCreate(null);
              }}
              placeholder={ctxCreate.type === 'folder' ? 'Folder name' : 'File name e.g. app.ts'}
              className="w-full h-8 rounded bg-white/5 border border-[var(--os-line)] px-3 text-xs text-white placeholder:text-textMuted/50 outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--os-accent)_40%,transparent)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setCtxCreate(null)} className="px-3 py-1.5 text-[11px] text-textMuted hover:text-white">Cancel</button>
              <button onClick={() => void commitCtxCreate()} className="px-3 py-1.5 text-[11px] bg-[var(--os-accent)] hover:opacity-90 text-white rounded">Create</button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeleteTarget(null)}>
          <div className="bg-[var(--os-surface-2)] border border-[var(--os-line)] rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs font-medium text-white mb-1">Delete?</div>
            <div className="text-[11px] text-textMuted mb-3 break-all">{deleteTarget.path}</div>
            <div className="text-[11px] text-amber-300/80 mb-3">This cannot be undone.</div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteTarget(null)} className="px-3 py-1.5 text-[11px] text-textMuted hover:text-white">Cancel</button>
              <button onClick={() => void confirmDelete()} className="px-3 py-1.5 text-[11px] bg-red-600 hover:bg-red-500 text-white rounded">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

