import { useState, useEffect } from 'react';

interface LearnedTask {
  id: string;
  name: string;
  description: string;
  sourceUrl?: string;
  sourceVideo?: string;
  steps: { action: string; target?: string; value?: string; url?: string; keys?: string; waitBefore?: number; description?: string }[];
  variables: Record<string, string>;
  tags: string[];
  timesExecuted: number;
  successRate: number;
  lastExecuted?: string;
  createdAt: string;
}

interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  steps: { action: string; target?: string; value?: string; url?: string; keys?: string; waitBefore?: number; description?: string }[];
  variables: { name: string; label: string; defaultValue?: string }[];
  tags: string[];
}

interface VideoAnalysis {
  id: string;
  url: string;
  title: string;
  channel: string;
  extractedSteps: { action: string; target?: string; value?: string; url?: string; keys?: string; waitBefore?: number; description?: string }[];
  suggestedVariables: string[];
  tags: string[];
  analyzedAt: string;
}

interface Step {
  action: string;
  target?: string;
  value?: string;
  url?: string;
  keys?: string;
  waitBefore?: number;
  description?: string;
}

const STEPS_EDITOR = ({ steps, onChange }: { steps: Step[]; onChange: (s: Step[]) => void }) => (
  <div className="space-y-2">
    {steps.map((step, i) => (
      <div key={i} className="flex items-center gap-2 bg-white/[0.02] rounded-lg p-2 border border-white/[0.06]">
        <span className="text-[10px] text-gray-500 w-4 text-center">{i + 1}</span>
        <select
          value={step.action}
          onChange={(e) => {
            const next = [...steps];
            next[i] = { ...next[i], action: e.target.value };
            onChange(next);
          }}
          className="bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-white w-28"
        >
          <option value="open_url">Open URL</option>
          <option value="click">Click</option>
          <option value="type">Type</option>
          <option value="press_key">Press Key</option>
          <option value="wait">Wait</option>
          <option value="screenshot">Screenshot</option>
          <option value="scroll">Scroll</option>
          <option value="select">Select</option>
          <option value="hover">Hover</option>
          <option value="extract">Extract</option>
          <option value="navigate_back">Back</option>
        </select>
        {step.action === 'open_url' && (
          <input
            value={step.url || ''}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...next[i], url: e.target.value };
              onChange(next);
            }}
            placeholder="https://..."
            className="flex-1 bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-white"
          />
        )}
        {['click', 'type', 'select', 'hover', 'extract'].includes(step.action) && (
          <input
            value={step.target || ''}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...next[i], target: e.target.value };
              onChange(next);
            }}
            placeholder="selector"
            className="flex-1 bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-white"
          />
        )}
        {['type'].includes(step.action) && (
          <input
            value={step.value || ''}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...next[i], value: e.target.value };
              onChange(next);
            }}
            placeholder="text"
            className="flex-1 bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-white"
          />
        )}
        {step.action === 'press_key' && (
          <input
            value={step.keys || ''}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...next[i], keys: e.target.value };
              onChange(next);
            }}
            placeholder="Enter / Ctrl+C"
            className="flex-1 bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-white"
          />
        )}
        {step.action === 'wait' && (
          <input
            type="number"
            value={step.waitBefore || 0}
            onChange={(e) => {
              const next = [...steps];
              next[i] = { ...next[i], waitBefore: parseInt(e.target.value) || 0 };
              onChange(next);
            }}
            placeholder="ms"
            className="w-20 bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-white"
          />
        )}
        <input
          value={step.description || ''}
          onChange={(e) => {
            const next = [...steps];
            next[i] = { ...next[i], description: e.target.value };
            onChange(next);
          }}
          placeholder="description"
          className="flex-1 bg-white/5 border border-white/[0.08] rounded px-2 py-1 text-xs text-gray-400"
        />
        <button
          onClick={() => {
            const next = steps.filter((_, j) => j !== i);
            onChange(next);
          }}
          className="text-red-400 hover:text-red-300 text-xs"
        >
          ×
        </button>
      </div>
    ))}
    <button
      onClick={() => onChange([...steps, { action: 'click', target: '', value: '', description: '' }])}
      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      Add Step
    </button>
  </div>
);

export function YouTubeLearningView() {
  const [tasks, setTasks] = useState<LearnedTask[]>([]);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [analyses, setAnalyses] = useState<VideoAnalysis[]>([]);
  const [tab, setTab] = useState<'tasks' | 'templates' | 'analyze'>('tasks');
  const [loading, setLoading] = useState(true);
  const [analyzeUrl, setAnalyzeUrl] = useState('');
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [selectedAnalysis, setSelectedAnalysis] = useState<VideoAnalysis | null>(null);

  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [newTemplateSteps, setNewTemplateSteps] = useState<Step[]>([]);
  const [showCreateTemplate, setShowCreateTemplate] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [t, te, a] = await Promise.all([
        window.api.ytListTasks(),
        window.api.ytListTemplates(),
        window.api.ytListAnalyses(),
      ]);
      setTasks(t as LearnedTask[]);
      setTemplates(te as TaskTemplate[]);
      setAnalyses(a as VideoAnalysis[]);
    } catch (err) {
      console.error('Failed to load YouTube learning data:', err);
    }
    setLoading(false);
  };

  const handleAnalyze = async () => {
    if (!analyzeUrl.trim()) return;
    setAnalyzeLoading(true);
    try {
      await window.api.ytAnalyze({
        url: analyzeUrl,
        transcript: '',
        title: analyzeUrl,
      });
      await loadData();
      setAnalyzeUrl('');
    } catch (err) {
      console.error('Analyze failed:', err);
    }
    setAnalyzeLoading(false);
  };

  const handleDeleteTask = async (id: string) => {
    await window.api.ytDeleteTask({ id });
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim()) return;
    await window.api.ytCreateTemplate({
      name: newTemplateName,
      steps: newTemplateSteps,
      description: newTemplateDesc,
    });
    await loadData();
    setShowCreateTemplate(false);
    setNewTemplateName('');
    setNewTemplateDesc('');
    setNewTemplateSteps([]);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">YouTube Learning</h1>
          <p className="text-gray-500 text-sm">Analyze videos, extract instructions, and create reusable task templates.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCreateTemplate(true)}
            className="px-3 py-1.5 rounded-lg border border-white/[0.08] hover:border-indigo-500/40 bg-white/[0.02] hover:bg-white/[0.04] text-white text-xs flex items-center gap-1.5 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Template
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/[0.02] border border-white/[0.06] rounded-lg p-1 w-fit">
        {(['tasks', 'templates', 'analyze'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === t ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-gray-500 hover:text-white'
            }`}
          >
            {t === 'tasks' ? 'Learned Tasks' : t === 'templates' ? 'Templates' : 'Analyze Video'}
          </button>
        ))}
      </div>

      {/* Tasks Tab */}
      {tab === 'tasks' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tasks.map((task) => (
            <div key={task.id} className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.1] transition-all">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/20 to-pink-500/20 border border-red-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm truncate">{task.name}</div>
                  <div className="text-[10px] text-gray-500">{task.steps.length} steps</div>
                </div>
                <button onClick={() => handleDeleteTask(task.id)} className="text-gray-500 hover:text-red-400 text-xs transition-all">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {task.description && <p className="text-gray-400 text-xs mb-3 line-clamp-2">{task.description}</p>}
              <div className="flex items-center gap-3 text-[10px] text-gray-500">
                <span>{task.timesExecuted} executed</span>
                <span>{Math.round(task.successRate * 100)}% success</span>
                {task.sourceVideo && <span className="text-blue-400 truncate">{task.sourceVideo}</span>}
              </div>
              {task.tags.length > 0 && (
                <div className="flex gap-1 mt-2 flex-wrap">
                  {task.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 rounded bg-white/5 text-[9px] text-gray-500">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {tasks.length === 0 && !loading && (
            <div className="col-span-full text-center py-12 text-gray-500 text-sm">
              No learned tasks yet. Analyze a YouTube video to get started.
            </div>
          )}
        </div>
      )}

      {/* Templates Tab */}
      {tab === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((tpl) => (
            <div key={tpl.id} className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-4 hover:border-white/[0.1] transition-all">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm truncate">{tpl.name}</div>
                  <div className="text-[10px] text-gray-500">{tpl.steps.length} steps, {tpl.variables.length} variables</div>
                </div>
              </div>
              {tpl.description && <p className="text-gray-400 text-xs mb-3 line-clamp-2">{tpl.description}</p>}
              {tpl.variables.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tpl.variables.map((v) => (
                    <span key={v.name} className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-[9px] text-indigo-300">{`{{${v.name}}}`}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {templates.length === 0 && !loading && (
            <div className="col-span-full text-center py-12 text-gray-500 text-sm">
              No templates yet. Create one from a learned task or start from scratch.
            </div>
          )}
        </div>
      )}

      {/* Analyze Tab */}
      {tab === 'analyze' && (
        <div className="max-w-2xl">
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-6 mb-6">
            <h3 className="text-sm font-medium text-white mb-4">Analyze YouTube Video</h3>
            <div className="flex gap-2 mb-4">
              <input
                value={analyzeUrl}
                onChange={(e) => setAnalyzeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="flex-1 bg-white/5 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/40"
              />
              <button
                onClick={handleAnalyze}
                disabled={analyzeLoading || !analyzeUrl.trim()}
                className="px-4 py-2 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs font-medium hover:bg-indigo-500/30 transition-all disabled:opacity-50"
              >
                {analyzeLoading ? 'Analyzing...' : 'Analyze'}
              </button>
            </div>
            <p className="text-[10px] text-gray-600">Paste a YouTube URL and we&apos;ll analyze the video to extract step-by-step instructions for task automation.</p>
          </div>

          {analyses.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-white">Previous Analyses</h3>
              {analyses.map((a) => (
                <div
                  key={a.id}
                  onClick={() => setSelectedAnalysis(selectedAnalysis?.id === a.id ? null : a)}
                  className={`bg-[#1a1a1f] border rounded-xl p-4 cursor-pointer transition-all ${
                    selectedAnalysis?.id === a.id ? 'border-indigo-500/40' : 'border-white/[0.06] hover:border-white/[0.1]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white truncate">{a.title}</div>
                      <div className="text-[10px] text-gray-500">{a.channel} · {a.extractedSteps.length} steps · {new Date(a.analyzedAt).toLocaleDateString()}</div>
                    </div>
                  </div>
                  {selectedAnalysis?.id === a.id && (
                    <div className="mt-4 pt-4 border-t border-white/[0.06]">
                      <STEPS_EDITOR steps={a.extractedSteps} onChange={() => {}} />
                      {a.suggestedVariables.length > 0 && (
                        <div className="mt-3 flex gap-1 flex-wrap">
                          {a.suggestedVariables.map((v) => (
                            <span key={v} className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-[9px] text-indigo-300">{`{{${v}}}`}</span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={async () => {
                            await window.api.ytLearn({ url: a.url, transcript: '', taskTitle: a.title });
                            await loadData();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-300 text-xs hover:bg-green-500/30 transition-all"
                        >
                          Learn from this
                        </button>
                        <button
                          onClick={async () => {
                            await window.api.ytCreateTemplate({
                              name: a.title,
                              steps: a.extractedSteps,
                              description: `Learned from ${a.url}`,
                            });
                            await loadData();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 text-xs hover:bg-purple-500/30 transition-all"
                        >
                          Save as Template
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCreateTemplate(false)}>
          <div className="bg-[#1a1a1f] border border-white/[0.08] rounded-2xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white mb-4">Create Task Template</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Template Name</label>
                <input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g. Sign up for a service"
                  className="w-full bg-white/5 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description</label>
                <input
                  value={newTemplateDesc}
                  onChange={(e) => setNewTemplateDesc(e.target.value)}
                  placeholder="Optional description"
                  className="w-full bg-white/5 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Steps</label>
                <STEPS_EDITOR steps={newTemplateSteps} onChange={setNewTemplateSteps} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowCreateTemplate(false)} className="px-3 py-1.5 rounded-lg text-gray-400 hover:text-white text-xs transition-all">
                  Cancel
                </button>
                <button
                  onClick={handleCreateTemplate}
                  className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs hover:bg-indigo-500/30 transition-all"
                >
                  Create Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

