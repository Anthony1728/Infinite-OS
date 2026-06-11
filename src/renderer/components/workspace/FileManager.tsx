import { useState } from 'react';

interface FileNode {
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  size?: string;
  modified?: string;
}

const DEMO_TREE: FileNode[] = [
  {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'components',
        type: 'folder',
        children: [
          { name: 'Dashboard.tsx', type: 'file', size: '2.4 KB', modified: '2h ago' },
          { name: 'Sidebar.tsx', type: 'file', size: '1.8 KB', modified: '3h ago' },
          { name: 'TopBar.tsx', type: 'file', size: '1.2 KB', modified: '5h ago' },
          { name: 'ChatView.tsx', type: 'file', size: '3.1 KB', modified: '1d ago' },
        ],
      },
      {
        name: 'hooks',
        type: 'folder',
        children: [
          { name: 'useAgents.ts', type: 'file', size: '0.8 KB', modified: '1d ago' },
          { name: 'useMemory.ts', type: 'file', size: '0.6 KB', modified: '2d ago' },
        ],
      },
      {
        name: 'stores',
        type: 'folder',
        children: [
          { name: 'chat.ts', type: 'file', size: '2.1 KB', modified: '4h ago' },
          { name: 'agents.ts', type: 'file', size: '1.5 KB', modified: '6h ago' },
          { name: 'ui.ts', type: 'file', size: '0.4 KB', modified: '1d ago' },
        ],
      },
      { name: 'App.tsx', type: 'file', size: '1.1 KB', modified: '30m ago' },
      { name: 'main.tsx', type: 'file', size: '0.3 KB', modified: '1d ago' },
    ],
  },
  {
    name: 'main',
    type: 'folder',
    children: [
      {
        name: 'agents',
        type: 'folder',
        children: [
          { name: 'registry.ts', type: 'file', size: '3.2 KB', modified: '2h ago' },
          { name: 'runtime.ts', type: 'file', size: '4.1 KB', modified: '3h ago' },
          { name: 'custom-store.ts', type: 'file', size: '2.8 KB', modified: '5h ago' },
        ],
      },
      {
        name: 'providers',
        type: 'folder',
        children: [
          { name: 'openrouter.ts', type: 'file', size: '2.5 KB', modified: '1d ago' },
          { name: 'anthropic.ts', type: 'file', size: '3.0 KB', modified: '1d ago' },
          { name: 'ollama.ts', type: 'file', size: '1.8 KB', modified: '2d ago' },
        ],
      },
      { name: 'index.ts', type: 'file', size: '2.0 KB', modified: '4h ago' },
    ],
  },
  {
    name: 'shared',
    type: 'folder',
    children: [
      { name: 'types.ts', type: 'file', size: '1.5 KB', modified: '1d ago' },
      { name: 'ipc.ts', type: 'file', size: '1.2 KB', modified: '6h ago' },
    ],
  },
  { name: 'package.json', type: 'file', size: '2.1 KB', modified: '1d ago' },
  { name: 'tsconfig.json', type: 'file', size: '0.5 KB', modified: '3d ago' },
  { name: 'tailwind.config.ts', type: 'file', size: '1.8 KB', modified: '2h ago' },
  { name: 'electron.vite.config.ts', type: 'file', size: '0.9 KB', modified: '1d ago' },
];

const FILE_ICONS: Record<string, string> = {
  tsx: '⚛', ts: '📘', js: '📒', json: '📋', sql: '🗄️', md: '📝', css: '🎨', html: '🌐',
};

function getFileIcon(name: string): string {
  const ext = name.split('.').pop() ?? '';
  return FILE_ICONS[ext] ?? '📄';
}

function TreeItem({ node, depth = 0 }: { node: FileNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 text-sm transition-colors"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-xs text-fg-subtle w-4 text-center">{open ? '▾' : '▸'}</span>
          <span className="text-sm">{open ? '📂' : '📁'}</span>
          <span className="flex-1 text-left truncate text-fg">{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <TreeItem key={child.name} node={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <button
      className="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-white/5 text-sm transition-colors"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className="w-4" />
      <span className="text-sm">{getFileIcon(node.name)}</span>
      <span className="flex-1 text-left truncate text-fg-muted">{node.name}</span>
      {node.size && <span className="text-[10px] text-fg-subtle">{node.size}</span>}
    </button>
  );
}

export function FileManager() {
  const [search, setSearch] = useState('');

  const filterTree = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query) return nodes;
    return nodes.reduce<FileNode[]>((acc, node) => {
      if (node.type === 'folder' && node.children) {
        const filtered = filterTree(node.children, query);
        if (filtered.length > 0 || node.name.toLowerCase().includes(query.toLowerCase())) {
          acc.push({ ...node, children: filtered });
        }
      } else if (node.name.toLowerCase().includes(query.toLowerCase())) {
        acc.push(node);
      }
      return acc;
    }, []);
  };

  const tree = filterTree(DEMO_TREE, search);

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm">📁</span>
          <span className="text-sm font-semibold">Files</span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
          className="w-full h-8 rounded-lg bg-white/5 border border-white/8 px-3 text-xs placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-violet-500/40"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {tree.map((node) => (
          <TreeItem key={node.name} node={node} />
        ))}
      </div>
      <div className="px-4 py-2 border-t border-white/5 text-[10px] text-fg-subtle">
        {DEMO_TREE.length} items • infinity-ai
      </div>
    </div>
  );
}
