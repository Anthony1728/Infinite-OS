import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const PRESET_ICONS = ['M13 10V3L4 14h7v7l9-11h-7z', 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z', 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4', 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z', 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z', 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z', 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z', 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z', 'M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4', 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z', 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9', 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z', 'M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01', 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z', 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z'];
const PRESET_COLORS = ['#8b5cf6', '#10b981', '#a855f7', '#ec4899', '#3b82f6', '#f59e0b', '#ef4444', '#14b8a6', '#f97316', '#6366f1'];

const ALL_TOOL_NAMES = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('M13 10V3L4 14h7v7l9-11h-7z');
  const [color, setColor] = useState('#8b5cf6');
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
          className="bg-bg-card border border-border rounded-2xl w-full max-w-md p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-xl bg-gradient-brand flex items-center justify-center text-white text-xl mx-auto mb-3 shadow-glow-sm">
              ✓
            </div>
            <h2 className="text-lg font-semibold mb-1">Agent Created</h2>
            <p className="text-sm text-fg-muted mb-4">{name} is ready to use.</p>
            <button onClick={onClose} className="btn-primary text-sm">Done</button>
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
        className="bg-bg-card border border-border rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Create Custom Agent</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-bg-elevated text-fg-muted hover:text-fg flex items-center justify-center text-sm">✕</button>
        </div>

        {/* Progress steps */}
        <div className="flex gap-1 px-6 pt-4">
          {[1, 2].map((s) => (
            <div key={s} className={`flex-1 h-1 rounded-full ${step >= s ? 'bg-gradient-brand' : 'bg-border'}`} />
          ))}
        </div>

        <div className="px-6 py-4 space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="text-xs font-medium text-fg-muted mb-1.5 block">Agent Name</label>
                <input
                  ref={inputRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Security Auditor"
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 placeholder:text-fg-subtle"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-fg-muted mb-1.5 block">Description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this agent does best"
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 placeholder:text-fg-subtle"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-fg-muted mb-1.5 block">Icon</label>
                  <div className="relative">
                    <button
                      onClick={() => setShowIconPicker((o) => !o)}
                      className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 hover:border-border-strong transition-colors"
                    >
                      <span className="text-lg">{icon}</span>
                      <span className="text-fg-muted text-xs">Change</span>
                    </button>
                    {showIconPicker && (
                      <div className="absolute top-full left-0 mt-1 bg-bg-card border border-border rounded-xl p-2 shadow-xl z-10 grid grid-cols-5 gap-1">
                        {PRESET_ICONS.map((ic) => (
                          <button
                            key={ic}
                            onClick={() => { setIcon(ic); setShowIconPicker(false); }}
                            className={`w-8 h-8 rounded-lg flex items-center justify-center text-base hover:bg-bg-elevated transition-colors ${icon === ic ? 'bg-bg-elevated border border-border' : ''}`}
                          >
                            {ic}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-fg-muted mb-1.5 block">Color</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setColor(c)}
                        className={`w-7 h-7 rounded-lg border-2 transition-all ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
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
                  className="btn-primary text-sm disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-xs font-medium text-fg-muted mb-1.5 block">
                  System Prompt <span className="text-fg-subtle">(instructions for the agent)</span>
                </label>
                <textarea
                  ref={promptRef}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder="You are a..."
                  rows={6}
                  className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 placeholder:text-fg-subtle resize-none font-mono text-xs leading-relaxed"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-fg-muted mb-1.5 block">Allowed Tools</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_TOOL_NAMES.map((tool) => (
                    <button
                      key={tool}
                      onClick={() => toggleTool(tool)}
                      className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                        allowedTools.includes(tool)
                          ? 'bg-violet-500/20 border-violet-500/40 text-fg'
                          : 'border-border text-fg-muted hover:text-fg hover:border-border-strong'
                      }`}
                    >
                      {allowedTools.includes(tool) ? '✓ ' : ''}{tool}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-fg-muted mb-1.5 block">Max Turns</label>
                  <input
                    type="number"
                    value={maxTurns}
                    onChange={(e) => setMaxTurns(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                    className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-xs text-fg-muted hover:text-fg px-3 py-1.5 rounded-lg hover:bg-bg-elevated transition-colors">
                  ← Back
                </button>
                <button
                  onClick={create}
                  disabled={creating || !name.trim()}
                  className="btn-primary text-sm disabled:opacity-40"
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

