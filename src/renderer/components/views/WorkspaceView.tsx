import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editor';
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
}: {
  cwd: string;
  onFileOpen: (path: string, name: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
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
          path: dirPath.replace(/\\/g, '/').replace(/\/?$/, '/') + e.name,
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

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

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

  const insertNode = useCallback((parentPath: string, newNode: TreeNode) => {
    const insert = (nodes: TreeNode[]): TreeNode[] =>
      nodes.map((n) => {
        if (n.path === parentPath && n.children) {
          const exists = n.children.some((c) => c.name === newNode.name);
          if (exists) return n;
          const updated = [...n.children, newNode].sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          return { ...n, children: updated };
        }
        if (n.children) return { ...n, children: insert(n.children) };
        return n;
      });
    setTree(insert);
  }, []);

  const handleNewFile = useCallback(async () => {
    const name = prompt('File name:');
    if (!name) return;
    const parentDir = cwd;
    const fullPath = parentDir.replace(/\\/g, '/').replace(/\/?$/, '/') + name;
    await window.api.fileWrite({ path: fullPath, content: '' });
    insertNode(parentDir, { name, path: fullPath, isDirectory: false });
  }, [cwd, insertNode]);

  const handleNewFolder = useCallback(async () => {
    const name = prompt('Folder name:');
    if (!name) return;
    const parentDir = cwd;
    const fullPath = parentDir.replace(/\\/g, '/').replace(/\/?$/, '/') + name;
    await window.api.fileMkdir({ path: fullPath });
    insertNode(parentDir, { name, path: fullPath, isDirectory: true, children: [], loaded: false });
  }, [cwd, insertNode]);

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
              <ChevronDown className="w-3 h-3 flex-shrink-0 text-gray-500" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0 text-gray-500" />
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
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 flex-shrink-0">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleNewFile}
            className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
            title="New File"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNewFolder}
            className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
            title="New Folder"
          >
            <FolderIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500 text-xs">Loading...</div>
        ) : tree.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-gray-500 text-xs">Empty directory</div>
        ) : (
          tree.map((node) => renderNode(node, 0))
        )}
      </div>
    </div>
  );
}

function OutlinePanel({ outline }: { outline: OutlineItem[] }) {
  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex items-center px-3 py-2 border-b border-white/10 flex-shrink-0">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Outline</span>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        {outline.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-gray-500 text-xs">No symbols</div>
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
  const [cwd] = useState(() => {
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
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  const editorRef = useRef<unknown>(null);
  const monacoRef = useRef<unknown>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  const openFileStore = useEditorStore((s) => s.openFile);
  const openFileContentStore = useEditorStore((s) => s.openFileContent);
  const openFileLanguageStore = useEditorStore((s) => s.openFileLanguage);
  const showAnimation = useEditorStore((s) => s.showAnimation);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalOutput]);

  useEffect(() => {
    if (openFileStore && openFileContentStore) {
      const name = openFileStore.split('/').pop() ?? openFileStore;
      handleFileOpenFromStore(openFileStore, name, openFileContentStore, openFileLanguageStore ?? 'plaintext');
    }
  }, [openFileStore, openFileContentStore, openFileLanguageStore]);

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
      handleSave();
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

  const handleCloseTab = useCallback(
    (index: number) => {
      setTabs((prev) => prev.filter((_, i) => i !== index));
      setActiveTabIndex((prev) => {
        if (index < prev) return prev - 1;
        if (index >= prev) return Math.min(prev, tabs.length - 2);
        return prev;
      });
    },
    [tabs.length],
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

  const handleCtxNewFile = useCallback(async () => {
    if (!contextMenu) return;
    const name = prompt('File name:');
    if (!name) return;
    const parentDir = contextMenu.isDir ? contextMenu.path : contextMenu.path.split('/').slice(0, -1).join('/');
    const fullPath = parentDir.replace(/\/?$/, '/') + name;
    try {
      await window.api.fileWrite({ path: fullPath, content: '' });
      setTerminalOutput((prev) => [...prev, `$ Created file ${fullPath}`]);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCtxNewFolder = useCallback(async () => {
    if (!contextMenu) return;
    const name = prompt('Folder name:');
    if (!name) return;
    const parentDir = contextMenu.isDir ? contextMenu.path : contextMenu.path.split('/').slice(0, -1).join('/');
    const fullPath = parentDir.replace(/\/?$/, '/') + name;
    try {
      await window.api.fileMkdir({ path: fullPath });
      setTerminalOutput((prev) => [...prev, `$ Created folder ${fullPath}`]);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleCtxRename = useCallback(() => {
    if (!contextMenu) return;
    setRenamePath(contextMenu.path);
    setRenameValue(contextMenu.path.split('/').pop() ?? '');
    setContextMenu(null);
  }, [contextMenu]);

  const handleCtxDelete = useCallback(async () => {
    if (!contextMenu) return;
    if (!confirm(`Delete ${contextMenu.path.split('/').pop()}?`)) return;
    try {
      await window.api.fileDelete({ path: contextMenu.path });
      setTerminalOutput((prev) => [...prev, `$ Deleted ${contextMenu.path}`]);
    } catch (e) {
      setTerminalOutput((prev) => [...prev, `Error: ${(e as Error).message}`]);
    }
    setContextMenu(null);
  }, [contextMenu]);

  const submitRename = useCallback(async () => {
    if (!renamePath || !renameValue) return;
    const parts = renamePath.split('/');
    parts[parts.length - 1] = renameValue;
    const newPath = parts.join('/');
    try {
      await window.api.fileRename({ oldPath: renamePath, newPath });
      setTerminalOutput((prev) => [...prev, `$ Renamed to ${newPath}`]);
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
    <div className="w-full h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex-1 min-h-0 flex">
        {leftPanelOpen && (
          <div className="w-52 flex-shrink-0 border-r border-white/10 overflow-hidden">
            <FileExplorer cwd={cwd} onFileOpen={handleFileOpen} onContextMenu={handleContextMenu} />
          </div>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center border-b border-white/10 bg-[#0a0a0f] flex-shrink-0">
            <button
              onClick={() => setLeftPanelOpen(!leftPanelOpen)}
              className="p-1.5 hover:bg-white/5 text-gray-500 hover:text-white transition-colors flex-shrink-0"
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
                      ? 'border-blue-500 text-white bg-white/[0.03]'
                      : 'border-transparent text-gray-500 hover:text-white hover:bg-white/[0.02]'
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
                    className="opacity-0 group-hover:opacity-100 ml-1 text-gray-500 hover:text-red-400 transition-all"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1 px-2 flex-shrink-0">
              {modifiedCount > 0 && <span className="text-[10px] text-amber-400">{modifiedCount} unsaved</span>}
              {rightPanelOpen ? (
                <button
                  onClick={() => setRightPanelOpen(false)}
                  className="p-1.5 hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
                  title="Hide Outline"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => setRightPanelOpen(true)}
                  className="p-1.5 hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
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
              <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                Open a file from the explorer
              </div>
            )}
          </div>
        </div>

        {rightPanelOpen && (
          <div className="w-48 flex-shrink-0 border-l border-white/10 overflow-hidden">
            <OutlinePanel outline={outlineData} />
          </div>
        )}
      </div>

      {terminalOpen && (
        <div className="h-44 flex-shrink-0 border-t border-white/10 flex flex-col bg-[#0a0a0f]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-1.5 text-gray-400">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-[11px] font-medium uppercase tracking-wider">Terminal</span>
            </div>
            <button
              onClick={() => setTerminalOpen(false)}
              className="p-1 rounded hover:bg-white/5 text-gray-500 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 font-mono text-[11px] text-gray-300">
            {terminalOutput.map((line, i) => (
              <div key={i} className={line.startsWith('$') ? 'text-gray-400' : line.startsWith('Error') ? 'text-red-400' : 'text-gray-300'}>
                {line}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/10 flex-shrink-0">
            <span className="text-gray-500 text-[11px]">$</span>
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

      <div className="flex items-center justify-between px-3 py-1 border-t border-white/10 bg-[#0a0a0f] flex-shrink-0">
        <div className="flex items-center gap-3 text-[10px] text-gray-600">
          <span>{activeTab?.language ?? '--'}</span>
          <span>UTF-8</span>
          <span>{cwd}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTerminalOpen(!terminalOpen)}
            className={`p-1 rounded hover:bg-white/5 transition-colors ${terminalOpen ? 'text-gray-300' : 'text-gray-500 hover:text-white'}`}
            title="Toggle Terminal"
          >
            {terminalOpen ? <PanelBottomClose className="w-3.5 h-3.5" /> : <PanelBottomOpen className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed bg-[#1a1a24] border border-white/10 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
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
          <div className="mx-2 my-1 border-t border-white/10" />
          <button onClick={handleCtxDelete} className="w-full px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-white/5 hover:text-red-300">
            Delete
          </button>
        </div>
      )}

      {renamePath && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setRenamePath(null); setRenameValue(null); }}>
          <div className="bg-[#1a1a24] border border-white/10 rounded-lg shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-xs text-gray-300 mb-2">Rename</div>
            <input
              value={renameValue ?? ''}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename();
                if (e.key === 'Escape') { setRenamePath(null); setRenameValue(null); }
              }}
              className="w-full h-8 rounded bg-white/5 border border-white/10 px-3 text-xs text-white outline-none focus:ring-1 focus:ring-blue-500/40"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => { setRenamePath(null); setRenameValue(null); }} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-white">
                Cancel
              </button>
              <button onClick={submitRename} className="px-3 py-1.5 text-[11px] bg-blue-600 hover:bg-blue-500 text-white rounded">
                Rename
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

