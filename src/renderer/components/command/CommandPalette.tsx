import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Command } from 'cmdk';

const COMMANDS = [
  { id: 'new-chat', label: 'New Chat', icon: '💬', category: 'Chat', shortcut: 'Ctrl+N' },
  { id: 'open-canvas', label: 'Open Canvas', icon: '⊞', category: 'Workspace' },
  { id: 'open-code', label: 'Open Code Editor', icon: '⟨/⟩', category: 'Workspace' },
  { id: 'create-agent', label: 'Create Agent', icon: '🤖', category: 'Agents' },
  { id: 'deploy', label: 'Deploy Project', icon: '🚀', category: 'Actions' },
  { id: 'settings', label: 'Settings', icon: '⚙️', category: 'App', shortcut: 'Ctrl+,' },
  { id: 'memory', label: 'Memory', icon: '🧠', category: 'App' },
  { id: 'projects', label: 'Projects', icon: '📁', category: 'App' },
  { id: 'documents', label: 'Documents', icon: '📄', category: 'App' },
  { id: 'automations', label: 'Automations', icon: '⚡', category: 'Features' },
  { id: 'browser', label: 'Browser Control', icon: '🌐', category: 'Features' },
  { id: 'computer', label: 'Computer Control', icon: '🖥️', category: 'Features' },
  { id: 'website-builder', label: 'Website Builder', icon: '🎨', category: 'Features' },
  { id: 'app-builder', label: 'App Builder', icon: '💻', category: 'Features' },
  { id: 'business', label: 'Business OS', icon: '💼', category: 'Features' },
  { id: 'plugins', label: 'Plugin Store', icon: '🧩', category: 'Features' },
  { id: 'cloud', label: 'Cloud Sync', icon: '☁️', category: 'Features' },
  { id: 'multi-agent', label: 'Multi-Agent System', icon: '🤝', category: 'Features' },
  { id: 'workspace', label: 'Team Workspace', icon: '🏢', category: 'Features' },
  { id: 'agents', label: 'All Agents', icon: '🤖', category: 'App' },
];

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
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, setOpen]);

  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(search.toLowerCase()) ||
    c.category.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce<Record<string, typeof COMMANDS>>((acc, cmd) => {
    (acc[cmd.category] ??= []).push(cmd);
    return acc;
  }, {});

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
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-white/[0.06]">
          <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.604 10.604z" /></svg>
          <Command.Input
            value={search}
            onValueChange={setSearch}
            placeholder="Search commands..."
            className="flex-1 h-12 bg-transparent text-sm text-white placeholder:text-gray-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5">ESC</kbd>
        </div>

        <Command.List className="max-h-[350px] overflow-y-auto p-2 custom-scrollbar">
          <Command.Empty className="text-center py-8 text-gray-500 text-sm">
            No results found.
          </Command.Empty>

          {Object.entries(grouped).map(([category, commands]) => (
            <Command.Group key={category} heading={category} className="mb-2">
              {commands.map((cmd) => (
                <Command.Item
                  key={cmd.id}
                  value={cmd.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm cursor-pointer transition-colors data-[selected=true]:bg-indigo-500/15 data-[selected=true]:text-white text-gray-400 hover:bg-white/[0.04] hover:text-white"
                  onSelect={() => { setOpen(false); onCommand?.(cmd.id); }}
                >
                  <span className="text-base">{cmd.icon}</span>
                  <span className="flex-1">{cmd.label}</span>
                  {cmd.shortcut && (
                    <kbd className="text-[10px] text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5">{cmd.shortcut}</kbd>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </motion.div>
  );
}
