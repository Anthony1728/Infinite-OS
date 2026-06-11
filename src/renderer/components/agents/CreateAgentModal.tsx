import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const PRESET_ICONS = ['✦', '🔍', '⟨/⟩', '◆', '⊟', '⚡', '🧠', '📁', '📄', '🖼', '🎯', '🛠', '🔧', '📊', '🌐', '🔬', '🎨', '📝', '⚙', '💡'];
const PRESET_COLORS = ['#8b5cf6', '#10b981', '#a855f7', '#ec4899', '#3b82f6', '#f59e0b', '#ef4444', '#14b8a6', '#f97316', '#6366f1'];

const ALL_TOOL_NAMES = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];

export function CreateAgentModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('✦');
  const [color, setColor] = useState('#8b5cf6');
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>(['Read', 'Glob', 'Grep']);
  const [maxTurns, setMaxTurns] = useState(20);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);

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
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
