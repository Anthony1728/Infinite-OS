import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Command } from 'cmdk';

const COMMANDS = [
  { id: 'infinite', label: 'Infinite — explain everything', icon: 'IN', category: 'Platform', keywords: 'about overview what is' },
  { id: 'home', label: 'Power Center', icon: 'PC', category: 'Power', shortcut: 'Ctrl/⌘ K → power', keywords: 'home dashboard brief needs you' },
  { id: 'new-chat', label: 'New Chat', icon: 'AI', category: 'Chat', shortcut: 'Ctrl+N', keywords: 'conversation ask agent' },
  { id: 'open-canvas', label: 'Open Canvas', icon: 'CN', category: 'Workspace', keywords: 'board freeform diagram' },
  { id: 'open-code', label: 'Open Code Editor', icon: 'CD', category: 'Workspace', keywords: 'files code ide' },
  { id: 'standing-orders', label: 'Standing Orders', icon: 'SO', category: 'Automation', keywords: 'rules recurring' },
  { id: 'memory', label: 'Memory Graph', icon: 'AM', category: 'Knowledge', keywords: 'active memory graph nodes edges remember recall knowledge' },
  { id: 'capabilities', label: 'Tools & Skills', icon: 'TS', category: 'Platform', keywords: 'capabilities tools skills registry' },
  { id: 'guide', label: 'Guide', icon: 'GD', category: 'Platform', keywords: 'help learn how to' },
  { id: 'overview', label: 'Overview', icon: 'OV', category: 'Platform', keywords: 'about system' },
  { id: 'automations', label: 'Automation Studio', icon: 'AU', category: 'Automation', keywords: 'approvals reviews workflows runs schedule' },
  { id: 'activity', label: 'Activity Inbox', icon: 'AC', category: 'Automation', keywords: 'activity runs failures needs you inbox stream' },
  { id: 'workers', label: 'Workers', icon: 'WK', category: 'Automation', keywords: 'background jobs' },
  { id: 'workspace', label: 'Team Workspace', icon: 'TM', category: 'Workspace', keywords: 'team members projects' },
  { id: 'projects', label: 'Projects', icon: 'PR', category: 'Workspace', keywords: 'tasks kanban' },
  { id: 'planner', label: 'Planner', icon: 'PL', category: 'Life', keywords: 'calendar schedule tasks' },
  { id: 'studio', label: 'Studio', icon: 'SD', category: 'Create', keywords: 'create media' },
  { id: 'pages', label: 'Notes & Wikis', icon: 'PG', category: 'Create', keywords: 'docs notes wiki' },
  { id: 'documents', label: 'Knowledge Hub', icon: 'KH', category: 'Knowledge', keywords: 'documents files knowledge' },
  { id: 'terminal', label: 'Terminal', icon: 'TM', category: 'Tools', shortcut: 'Ctrl+`', keywords: 'shell command powershell' },
  { id: 'voice', label: 'Voice Assistant', icon: 'VA', category: 'Tools', keywords: 'speak listen microphone' },
  { id: 'bots', label: 'Bots', icon: 'BT', category: 'Workspace', keywords: 'assistants agents' },
  { id: 'artifacts', label: 'Artifacts', icon: 'AR', category: 'Workspace', keywords: 'outputs files results' },
  { id: 'messaging', label: 'Messaging', icon: 'MS', category: 'Actions', keywords: 'send message chat' },
  { id: 'website-builder', label: 'Website Builder', icon: 'WB', category: 'Creative', keywords: 'site web create' },
  { id: 'app-builder', label: 'App Builder', icon: 'AB', category: 'Creative', keywords: 'app build create' },
  { id: 'plugins', label: 'Plugin Marketplace', icon: 'PL', category: 'Platform', keywords: 'plugins marketplace install' },
  { id: 'deploy', label: 'Deploy Project', icon: 'DP', category: 'Actions', keywords: 'ship publish deploy' },
  { id: 'enterprise', label: 'Enterprise', icon: 'EN', category: 'Platform', keywords: 'company team org' },
  { id: 'settings', label: 'Settings', icon: 'ST', category: 'App', shortcut: 'Ctrl+,', keywords: 'preferences config providers models' },
  { id: 'quick-capture', label: 'Quick Capture (append note)', icon: 'QC', category: 'Actions', shortcut: 'Ctrl+Shift+Y', keywords: 'note capture idea' },
  { id: 'quick-capture-open', label: 'Open Quick Notes folder', icon: 'QN', category: 'Actions', keywords: 'notes folder files' },
];

const RECENT_KEY = 'infinite:palette-recent';
function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]'); } catch { return []; }
}
function pushRecent(id: string) {
  try {
    const cur = getRecent().filter((x) => x !== id);
    cur.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 5)));
  } catch { /* ignore */ }
}

interface CommandPaletteProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onCommand?: (cmd: string) => void;
}

export function CommandPalette({ open: externalOpen, onOpenChange, onCommand }: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [search, setSearch] = useState('');

  const open = externalOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === 'Escape') setOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        setOpen(false);
        onCommand?.('quick-capture');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen, onCommand]);

  useEffect(() => {
    if (!open) setSearch('');
  }, [open]);

  const query = search.toLowerCase().trim();
  const tokens = query ? query.split(/\s+/).filter(Boolean) : [];

  /** 0 = exact label, 1 = label prefix, 2 = word start, 3 = substring, 4 = covered by keywords. */
  const score = (c: typeof COMMANDS[number]): number => {
    if (!query) return 0;
    const label = c.label.toLowerCase();
    if (label === query) return 0;
    if (label.startsWith(query)) return 1;
    if (tokens.length > 0 && tokens.every((t) => label.split(/\s+/).some((word) => word.startsWith(t)))) return 2;
    if (tokens.every((t) => label.includes(t))) return 3;
    const hay = `${c.category} ${c.id} ${c.keywords ?? ''}`.toLowerCase();
    if (tokens.every((t) => hay.includes(t))) return 4;
    return Number.POSITIVE_INFINITY;
  };

  const filtered = COMMANDS
    .map((command) => ({ command, rank: score(command) }))
    .filter((row) => Number.isFinite(row.rank))
    .sort((a, b) => a.rank - b.rank)
    .map((row) => row.command);
  const recentIds = !query ? getRecent() : [];
  const recentCommands = recentIds.map((id) => COMMANDS.find((c) => c.id === id)).filter(Boolean) as typeof COMMANDS;

  const grouped = filtered.reduce<Record<string, typeof COMMANDS>>((acc, cmd) => {
    (acc[cmd.category] ??= []).push(cmd);
    return acc;
  }, {});
  // While searching, keep one ranked list so the best match is always first.
  // With no query, group by category and put Power first — the Home surface
  // should be instantly discoverable.
  const orderedGroups: Array<[string, typeof COMMANDS]> = query
    ? (filtered.length > 0 ? [['Results', filtered]] : [])
    : Object.entries(grouped).sort(([a], [b]) => {
      if (a === 'Power') return -1;
      if (b === 'Power') return 1;
      return a.localeCompare(b);
    });

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <Command
        className="relative w-full max-w-lg bg-[#0d0d11]/95 backdrop-blur-xl border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden"
        shouldFilter={false}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-white/[0.06]">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search commands and modules..."
            className="flex-1 h-12 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <Command.List className="max-h-[350px] overflow-y-auto p-2 custom-scrollbar">
          <Command.Empty className="text-center py-8 text-gray-500 text-sm">No results found.</Command.Empty>

          {!query && recentCommands.length > 0 && (
            <Command.Group heading="Recent" className="mb-2">
              {recentCommands.map((cmd) => (
                <Command.Item
                  key={`recent-${cmd.id}`}
                  value={`recent-${cmd.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm cursor-pointer transition-colors data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white text-zinc-400 hover:bg-white/[0.04] hover:text-white"
                  onSelect={() => {
                    pushRecent(cmd.id);
                    setOpen(false);
                    onCommand?.(cmd.id);
                  }}
                >
                  <span className="w-7 h-7 rounded-lg bg-violet-500/15 border border-violet-500/20 flex items-center justify-center text-[10px] font-semibold text-violet-300">↻</span>
                  <span className="flex-1">{cmd.label}</span>
                  <span className="text-[10px] text-zinc-600">recent</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}

          {orderedGroups.map(([category, commands]) => (
            <Command.Group key={category} heading={category} className="mb-2">
              {commands.map((cmd) => (
                <Command.Item
                  key={cmd.id}
                  value={cmd.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm cursor-pointer transition-colors data-[selected=true]:bg-indigo-500/15 data-[selected=true]:text-white text-gray-400 hover:bg-white/[0.04] hover:text-white"
                  onSelect={() => {
                    pushRecent(cmd.id);
                    setOpen(false);
                    onCommand?.(cmd.id);
                  }}
                >
                  <span className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[10px] font-semibold text-indigo-300">
                    {cmd.icon}
                  </span>
                  <span className="flex-1">{cmd.label}</span>
                  {cmd.shortcut && <kbd className="text-[10px] text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5">{cmd.shortcut}</kbd>}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="border-t border-white/[0.06] px-3 py-2 flex items-center justify-between text-[10px] text-zinc-600">
          <span><span className="font-mono text-zinc-400">↑↓</span> navigate · <span className="font-mono text-zinc-400">↵</span> select · <span className="font-mono text-zinc-400">ESC</span> close</span>
          <span className="hidden sm:inline">Home is Ctrl/⌘ K → “home”</span>
        </div>
      </Command>
    </motion.div>
  );
}

