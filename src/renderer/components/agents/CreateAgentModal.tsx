import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const PRESET_ICONS = [
  { path: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z', label: 'AI' },
  { path: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z', label: 'Bolt' },
  { path: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25', label: 'Book' },
  { path: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z', label: 'Search' },
  { path: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z', label: 'Shield' },
  { path: 'M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21', label: 'Chart' },
  { path: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5', label: 'Calendar' },
  { path: 'M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375', label: 'Database' },
  { path: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5', label: 'Code' },
  { path: 'M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z', label: 'Settings' },
];

const PRESET_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444',
  '#f59e0b', '#10b981', '#14b8a6', '#06b6d4', '#3b82f6',
];

const ALL_TOOL_NAMES = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite', 'Computer', 'Agent'];

export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState(PRESET_ICONS[0].path);
  const [color, setColor] = useState('#6366f1');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>(['Read', 'Glob', 'Grep']);
  const [maxTurns, setMaxTurns] = useState(20);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const toggleTool = (tool: string) => {
    setAllowedTools((prev) => prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]);
  };

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await window.api.createCustomAgent({
        agent: {
          name: name.trim(),
          description: description.trim(),
          icon,
          color,
          systemPrompt: systemPrompt.trim(),
          allowedTools,
          maxTurns,
        },
      });
      setDone(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(msg);
      console.error('Failed to create agent:', err);
    }
    setCreating(false);
  };

  const IconSvg = ({ path, size = 20 }: { path: string; size?: number }) => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ width: size, height: size }}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-bgCard border border-borderSubtle rounded-2xl w-full max-w-md p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xl mx-auto mb-3 shadow-lg shadow-indigo-500/25">
              <IconSvg path={icon} size={24} />
            </div>
            <h2 className="text-lg font-semibold text-textMain mb-1">Agent Created</h2>
            <p className="text-sm text-textMuted mb-4">{name} is ready to use.</p>
            <button onClick={onClose} className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-purple-600 transition-all shadow-lg shadow-indigo-500/25">Done</button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="bg-bgCard border border-borderSubtle rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-borderSubtle">
          <h2 className="text-base font-semibold text-textMain">Create Custom Agent</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/[0.06] text-textMuted hover:text-textMain flex items-center justify-center text-sm">✕</button>
        </div>

        <div className="flex gap-1 px-6 pt-4">
          {[1, 2].map((s) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${step >= s ? 'bg-gradient-to-r from-indigo-500 to-purple-500' : 'bg-white/[0.06]'}`} />
          ))}
        </div>

        <div className="px-6 py-4 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="text-xs font-medium text-textMuted mb-1.5 block">Agent Name</label>
                <input
                  ref={inputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Security Auditor"
                  className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-textMuted mb-1.5 block">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this agent does best"
                  className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-indigo-500/50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-textMuted mb-1.5 block">Icon</label>
                  <div className="relative">
                    <button
                      onClick={() => setShowIconPicker((o) => !o)}
                      className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm flex items-center gap-2 hover:border-white/[0.12] transition-colors"
                    >
                      <span className="text-textMain"><IconSvg path={icon} /></span>
                      <span className="text-textMuted text-xs">Change</span>
                    </button>
                    {showIconPicker && (
                      <div className="absolute top-full left-0 mt-1 bg-bgCard border border-borderSubtle rounded-xl p-2 shadow-xl z-10 grid grid-cols-5 gap-1">
                        {PRESET_ICONS.map((ic) => (
                          <button
                            key={ic.label}
                            onClick={() => { setIcon(ic.path); setShowIconPicker(false); }}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${icon === ic.path ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40' : 'text-textMuted hover:bg-white/[0.06] hover:text-textMain'}`}
                          >
                            <IconSvg path={ic.path} size={18} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-textMuted mb-1.5 block">Color</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-7 h-7 rounded-lg border-2 transition-all ${color === c ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'}`}
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  disabled={!name.trim()}
                  onClick={() => { setStep(2); setTimeout(() => promptRef.current?.focus(), 100); }}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/25"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-xs font-medium text-textMuted mb-1.5 block">
                  System Prompt <span className="text-textMuted/60">(instructions for the agent)</span>
                </label>
                <textarea
                  ref={promptRef}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a..."
                  rows={6}
                  className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-indigo-500/50 resize-none font-mono text-xs leading-relaxed"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-textMuted mb-1.5 block">Allowed Tools</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_TOOL_NAMES.map((tool) => (
                    <button
                      key={tool}
                      onClick={() => toggleTool(tool)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        allowedTools.includes(tool)
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'border-borderSubtle text-textMuted hover:text-textMain hover:border-white/[0.12]'
                      }`}
                    >
                      {allowedTools.includes(tool) ? '✓ ' : ''}{tool}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-textMuted mb-1.5 block">Max Turns</label>
                  <input
                    type="number"
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-xs text-textMuted hover:text-textMain px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors">
                  ← Back
                </button>
                <button
                  onClick={create}
                  disabled={creating || !name.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-xl text-sm font-medium hover:from-indigo-600 hover:to-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-500/25"
                >
                  {creating ? 'Creating...' : 'Create Agent'}
                </button>
              </div>
              {error && (
                <div className="mt-3 px-3 py-2.5 bg-red-500/10 border border-red-500/25 rounded-lg text-xs text-red-400">
                  <strong>Failed to create agent:</strong> {error}
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
