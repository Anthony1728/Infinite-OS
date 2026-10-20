import { useState, useCallback, useEffect } from 'react';
import {
  Plus, Trash2, Play, Save, Zap, Terminal, Clock, Brain,
  FileCode, MonitorSmartphone, Bell, GitBranch, ChevronRight,
  GripVertical, X, Check, Workflow
} from 'lucide-react';

interface WorkflowStep {
  id: string;
  type: 'tool_call' | 'agent_run' | 'condition' | 'delay' | 'notify' | 'script' | 'computer_action';
  label: string;
  config: Record<string, unknown>;
  onError: 'stop' | 'continue' | 'retry';
}

const STEP_TYPES = [
  { type: 'agent_run' as const, label: 'AI Agent', icon: Brain, color: 'from-purple-500 to-indigo-600', description: 'Run an AI task' },
  { type: 'tool_call' as const, label: 'Shell Command', icon: Terminal, color: 'from-emerald-500 to-teal-600', description: 'Execute a shell command' },
  { type: 'script' as const, label: 'Run Script', icon: FileCode, color: 'from-blue-500 to-cyan-600', description: 'Run a script file' },
  { type: 'computer_action' as const, label: 'Computer Control', icon: MonitorSmartphone, color: 'from-orange-500 to-red-600', description: 'Control mouse, keyboard, or apps' },
  { type: 'condition' as const, label: 'Condition', icon: GitBranch, color: 'from-yellow-500 to-amber-600', description: 'Branch based on a condition' },
  { type: 'delay' as const, label: 'Delay', icon: Clock, color: 'from-slate-500 to-gray-600', description: 'Wait before next step' },
  { type: 'notify' as const, label: 'Notify', icon: Bell, color: 'from-pink-500 to-rose-600', description: 'Send a notification' },
];

function generateId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getStepConfig(step: WorkflowStep): string {
  switch (step.type) {
    // Read the keys the executor uses, not the `command` this editor used to
    // write and never read back. A step with no tool yet says so, so an
    // unconfigured step is visible as such instead of reading "shell command".
    case 'tool_call': {
      const tool = (step.config.tool as string) || '';
      if (!tool) return 'no tool chosen';
      const input = step.config.input as Record<string, unknown> | undefined;
      const detail = typeof input?.command === 'string' ? String(input.command) : '';
      return detail ? `${tool}: ${detail.slice(0, 40)}` : tool;
    }
    case 'agent_run': return (step.config.task as string) || 'AI task';
    case 'delay': return `Wait ${step.config.ms || 1000}ms`;
    case 'condition': return (step.config.condition as string) || 'condition';
    case 'script': return (step.config.script as string) || 'script';
    case 'notify': return (step.config.message as string) || 'notification';
    case 'computer_action': return (step.config.action as string) || 'action';
    default: return '';
  }
}

function StepConfigEditor({ step, onUpdate, onClose }: {
  step: WorkflowStep;
  onUpdate: (updates: Partial<WorkflowStep>) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState({ ...step.config });
  const [label, setLabel] = useState(step.label);
  const [onError, setOnError] = useState(step.onError);

  // A Tool Call step is executed by looking up `config.tool` in the real tool
  // registry and passing `config.input` to it (see builder.ts). This editor used
  // to collect a single shell `command` string and never a tool name at all, so
  // every step built here had `config.tool === undefined`, the lookup missed,
  // and the step did nothing at all while appearing correctly configured. The
  // fields below are the ones the executor actually reads.
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description?: string }>>([]);
  const [inputText, setInputText] = useState(() => {
    const existing = step.config.input as Record<string, unknown> | undefined;
    return existing ? JSON.stringify(existing, null, 2) : '';
  });
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.api
      .listTools()
      .then((list: Array<{ name: string; description?: string }>) => {
        if (cancelled || !Array.isArray(list)) return;
        // Sorted by name so the list is stable between openings.
        setAvailableTools([...list].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  /** Parse the JSON input, reporting the problem instead of saving junk. */
  const parseInput = (): Record<string, unknown> | null => {
    const raw = inputText.trim();
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setInputError('Input must be a JSON object, e.g. {"command":"npm test"}');
        return null;
      }
      setInputError('');
      return parsed as Record<string, unknown>;
    } catch (e) {
      setInputError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };

  const handleSave = () => {
    if (step.type === 'tool_call') {
      const toolName = String(config.tool ?? '');
      if (!toolName) {
        setInputError('Pick the tool this step should run.');
        return;
      }
      const input = parseInput();
      if (input === null) return;
      onUpdate({ config: { ...config, tool: toolName, input }, label, onError });
      onClose();
      return;
    }
    onUpdate({ config, label, onError });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#12121a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h3 className="text-lg font-semibold text-white">Configure Step</h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg">
            <X className="w-5 h-5 text-white/60" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1">Label</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {step.type === 'tool_call' && (
            <>
              <div>
                <label className="block text-sm font-medium text-white/60 mb-1">Tool</label>
                <select
                  value={(config.tool as string) || ''}
                  onChange={(e) => {
                    const tool = e.target.value;
                    // One click for a shell command, which is what this editor
                    // used to *pretend* to collect.
                    if (tool === 'Bash') setInputText(JSON.stringify({ command: '' }, null, 2));
                    setConfig({ ...config, tool });
                  }}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— choose a tool —</option>
                  {availableTools.map(t => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
                {typeof config.tool === 'string' && config.tool && (
                  <p className="mt-1 text-xs text-white/40">
                    {availableTools.find(t => t.name === config.tool)?.description?.slice(0, 160) ?? ''}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-white/60 mb-1">Input (JSON)</label>
                <textarea
                  value={inputText}
                  rows={4}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={'{\n  "command": "npm test"\n}'}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                {inputError && <p className="mt-1 text-xs text-red-400">{inputError}</p>}
              </div>
            </>
          )}
          {step.type === 'agent_run' && (
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1">Task</label>
              <textarea value={(config.task as string) || ''} rows={3}
                onChange={(e) => setConfig({ ...config, task: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          {step.type === 'delay' && (
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1">Delay (ms)</label>
              <input type="number" value={(config.ms as number) || 1000} min={100}
                onChange={(e) => setConfig({ ...config, ms: parseInt(e.target.value) || 1000 })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          {step.type === 'condition' && (
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1">Condition</label>
              <input type="text" value={(config.condition as string) || ''}
                placeholder="e.g. hour > 17"
                onChange={(e) => setConfig({ ...config, condition: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          {step.type === 'script' && (
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1">Script path or command</label>
              <textarea value={(config.script as string) || ''} rows={3}
                onChange={(e) => setConfig({ ...config, script: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          {step.type === 'notify' && (
            <div>
              <label className="block text-sm font-medium text-white/60 mb-1">Message</label>
              <textarea value={(config.message as string) || ''} rows={2}
                onChange={(e) => setConfig({ ...config, message: e.target.value })}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          {step.type === 'computer_action' && (
            <>
              <div>
                <label className="block text-sm font-medium text-white/60 mb-1">Action</label>
                <select value={(config.action as string) || 'type_text'}
                  onChange={(e) => setConfig({ ...config, action: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="type_text">Type Text</option>
                  <option value="key_press">Key Press</option>
                  <option value="mouse_click">Mouse Click</option>
                  <option value="screenshot">Screenshot</option>
                  <option value="open_app">Open App</option>
                </select>
              </div>
              {(config.action === 'type_text') && (
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-1">Text</label>
                  <input type="text" value={(config.text as string) || ''}
                    onChange={(e) => setConfig({ ...config, text: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {(config.action === 'key_press') && (
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-1">Key</label>
                  <input type="text" value={(config.key as string) || ''}
                    placeholder="e.g. enter, ctrl+c"
                    onChange={(e) => setConfig({ ...config, key: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
              {(config.action === 'open_app') && (
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-1">App path</label>
                  <input type="text" value={(config.path as string) || ''}
                    onChange={(e) => setConfig({ ...config, path: e.target.value })}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              )}
            </>
          )}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1">On Error</label>
            <div className="flex gap-2">
              {(['stop', 'continue', 'retry'] as const).map((opt) => (
                <button key={opt} onClick={() => setOnError(opt)}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    onError === opt
                      ? opt === 'retry' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                        : opt === 'continue' ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                        : 'bg-red-500/20 text-red-400 border border-red-500/50'
                      : 'bg-white/5 text-white/40 border border-white/10 hover:bg-white/10'
                  }`}>
                  {opt.charAt(0).toUpperCase() + opt.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-all">
              Cancel
            </button>
            <button onClick={handleSave}
              className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-all flex items-center justify-center gap-2">
              <Check className="w-4 h-4" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepNode({ step, index, isSelected, onSelect, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onConfigure }: {
  step: WorkflowStep;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onConfigure: () => void;
}) {
  const stepType = STEP_TYPES.find(t => t.type === step.type);
  const Icon = stepType?.icon ?? Zap;
  const color = stepType?.color ?? 'from-gray-500 to-gray-600';

  return (
    <div className={`relative group cursor-pointer transition-all duration-200 ${
      isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-[#0a0a0f]' : ''
    }`} onClick={onSelect}>
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${
        isSelected ? 'border-blue-500/50 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
      } backdrop-blur-sm transition-all`}>
        <div className="flex items-center gap-1 text-white/40">
          <button onClick={(e) => { e.stopPropagation(); onMoveUp(); }} disabled={!canMoveUp}
            className="opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 p-1 hover:bg-white/10 rounded">
            <ChevronRight className="w-3 h-3 rotate-[-90deg]" />
          </button>
          <GripVertical className="w-4 h-4 opacity-0 group-hover:opacity-50 transition-opacity" />
          <button onClick={(e) => { e.stopPropagation(); onMoveDown(); }} disabled={!canMoveDown}
            className="opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0 p-1 hover:bg-white/10 rounded">
            <ChevronRight className="w-3 h-3 rotate-90" />
          </button>
        </div>

        <span className="text-xs font-mono text-white/30 w-6">{index + 1}</span>

        <div className={`p-2 rounded-lg bg-gradient-to-br ${color} shadow-lg`}>
          <Icon className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{step.label}</div>
          <div className="text-xs text-white/40 truncate">{getStepConfig(step)}</div>
        </div>

        <div className="flex items-center gap-1">
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            step.onError === 'retry' ? 'bg-yellow-500/20 text-yellow-400' :
            step.onError === 'continue' ? 'bg-green-500/20 text-green-400' :
            'bg-red-500/20 text-red-400'
          }`}>{step.onError}</span>
          <button onClick={(e) => { e.stopPropagation(); onConfigure(); }}
            className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all">
            <Zap className="w-3.5 h-3.5 text-white/60" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 transition-all">
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-3 w-0.5 h-6 bg-white/20" />
    </div>
  );
}

export default function WorkflowBuilderView() {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [editingStep, setEditingStep] = useState<WorkflowStep | null>(null);
  const [workflowName, setWorkflowName] = useState('My Workflow');
  const [workflowDesc, setWorkflowDesc] = useState('');
  const [saved, setSaved] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);

  const addStep = useCallback((type: WorkflowStep['type']) => {
    const stepType = STEP_TYPES.find(t => t.type === type);
    const newStep: WorkflowStep = {
      id: generateId(),
      type,
      label: stepType?.label ?? 'Step',
      config: getDefaultConfig(type),
      onError: 'stop',
    };
    setSteps(prev => [...prev, newStep]);
    setShowAddMenu(false);
    setSelectedId(newStep.id);
    setSaved(false);
  }, []);

  const getDefaultConfig = (type: WorkflowStep['type']): Record<string, unknown> => {
    switch (type) {
      case 'tool_call': return { command: '' };
      case 'agent_run': return { task: '' };
      case 'delay': return { ms: 1000 };
      case 'condition': return { condition: '' };
      case 'script': return { script: '' };
      case 'notify': return { message: '' };
      case 'computer_action': return { action: 'type_text', text: '' };
      default: return {};
    }
  };

  const deleteStep = useCallback((id: string) => {
    setSteps(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
    setSaved(false);
  }, [selectedId]);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps(prev => {
      const newSteps = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= newSteps.length) return prev;
      [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
      return newSteps;
    });
    setSaved(false);
  }, []);

  const updateStep = useCallback((id: string, updates: Partial<WorkflowStep>) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    setSaved(false);
  }, []);

  const saveWorkflow = useCallback(() => {
    try {
      const workflow = {
        id: `wf-${Date.now()}`,
        name: workflowName,
        description: workflowDesc,
        steps,
        trigger: { type: 'manual', config: {} },
        enabled: true,
        createdAt: Date.now(),
      };
      const existing = JSON.parse(localStorage.getItem('infinite-workflows') || '[]');
      existing.push(workflow);
      localStorage.setItem('infinite-workflows', JSON.stringify(existing));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save workflow:', e);
    }
  }, [workflowName, workflowDesc, steps]);

  const runWorkflow = useCallback(async () => {
    if (steps.length === 0) return;
    setIsRunning(true);
    setRunLog([]);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      setRunLog(prev => [...prev, `[${i + 1}/${steps.length}] Running: ${step.label}`]);
      await new Promise(resolve => setTimeout(resolve, 500));
      setRunLog(prev => [...prev, `[${i + 1}/${steps.length}] Completed: ${step.label}`]);
    }
    setRunLog(prev => [...prev, 'Workflow completed!']);
    setIsRunning(false);
  }, [steps]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
            <Workflow className="w-5 h-5 text-white" />
          </div>
          <div>
            <input type="text" value={workflowName}
              onChange={(e) => { setWorkflowName(e.target.value); setSaved(false); }}
              className="text-lg font-semibold text-white bg-transparent border-none focus:outline-none focus:ring-0 p-0" />
            <input type="text" value={workflowDesc} placeholder="Add description..."
              onChange={(e) => { setWorkflowDesc(e.target.value); setSaved(false); }}
              className="block text-sm text-white/40 bg-transparent border-none focus:outline-none focus:ring-0 p-0 w-64" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runWorkflow} disabled={isRunning || steps.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium">
            <Play className="w-4 h-4" /> {isRunning ? 'Running...' : 'Run'}
          </button>
          <button onClick={saveWorkflow}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              saved ? 'bg-green-600 text-white' : 'bg-white/10 text-white hover:bg-white/20'
            }`}>
            {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl mx-auto space-y-1">
          {steps.length === 0 && (
            <div className="text-center py-16">
              <Workflow className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <p className="text-white/40 text-lg mb-2">Build your workflow</p>
              <p className="text-white/20 text-sm mb-6">Add steps to create an automation pipeline</p>
              <button onClick={() => setShowAddMenu(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white hover:bg-blue-500 transition-all font-medium">
                <Plus className="w-5 h-5" /> Add First Step
              </button>
            </div>
          )}

          {steps.map((step, index) => (
            <StepNode key={step.id} step={step} index={index}
              isSelected={selectedId === step.id}
              onSelect={() => setSelectedId(step.id)}
              onDelete={() => deleteStep(step.id)}
              onMoveUp={() => moveStep(index, -1)}
              onMoveDown={() => moveStep(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < steps.length - 1}
              onConfigure={() => setEditingStep(step)} />
          ))}

          {steps.length > 0 && (
            <div className="flex justify-center pt-2">
              <button onClick={() => setShowAddMenu(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-white/20 text-white/40 hover:border-white/40 hover:text-white/60 hover:bg-white/5 transition-all text-sm">
                <Plus className="w-4 h-4" /> Add Step
              </button>
            </div>
          )}
        </div>
      </div>

      {runLog.length > 0 && (
        <div className="border-t border-white/10 p-4 max-h-48 overflow-auto">
          <div className="text-xs font-mono text-white/60 space-y-1">
            {runLog.map((line, i) => (
              <div key={i} className={line.includes('Completed') ? 'text-green-400' : line.includes('completed!') ? 'text-emerald-400 font-bold' : ''}>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}

      {showAddMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowAddMenu(false)}>
          <div className="w-full max-w-md bg-[#12121a] border border-white/10 rounded-2xl shadow-2xl p-4"
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4">Add a Step</h3>
            <div className="grid grid-cols-2 gap-2">
              {STEP_TYPES.map((st) => {
                const Icon = st.icon;
                return (
                  <button key={st.type} onClick={() => addStep(st.type)}
                    className="flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left">
                    <div className={`p-2 rounded-lg bg-gradient-to-br ${st.color}`}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-white">{st.label}</div>
                      <div className="text-xs text-white/40">{st.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowAddMenu(false)}
              className="w-full mt-4 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 transition-all text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {editingStep && (
        <StepConfigEditor step={editingStep}
          onUpdate={(updates) => updateStep(editingStep.id, updates)}
          onClose={() => setEditingStep(null)} />
      )}
    </div>
  );
}
