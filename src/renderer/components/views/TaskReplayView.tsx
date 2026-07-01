import { useState, useEffect } from 'react';

interface ReplayExecution {
  id: string;
  taskName: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  startTime: string;
  endTime?: string;
  error?: string;
  variables: Record<string, string>;
  results: { stepIndex: number; success: boolean; error?: string; result?: unknown }[];
}

export function TaskReplayView() {
  const [executions, setExecutions] = useState<ReplayExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [nlInput, setNlInput] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [selectedExecution, setSelectedExecution] = useState<ReplayExecution | null>(null);

  useEffect(() => {
    loadExecutions();
  }, []);

  const loadExecutions = async () => {
    setLoading(true);
    try {
      const data = await window.api.replayList();
      setExecutions(data as ReplayExecution[]);
    } catch (err) {
      console.error('Failed to load executions:', err);
    }
    setLoading(false);
  };

  const handleExecuteNL = async () => {
    if (!nlInput.trim() || nlLoading) return;
    setNlLoading(true);
    try {
      await window.api.replayExecuteNL({ description: nlInput });
      setNlInput('');
      await loadExecutions();
    } catch (err) {
      console.error('Execution failed:', err);
    }
    setNlLoading(false);
  };

  const handleCancel = async (id: string) => {
    await window.api.replayCancel({ executionId: id });
    await loadExecutions();
  };

  const handlePause = async (id: string) => {
    await window.api.replayPause({ executionId: id });
    await loadExecutions();
  };

  const handleResume = async (id: string) => {
    await window.api.replayResume({ executionId: id });
    await loadExecutions();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'paused': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      case 'completed': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'failed': return 'text-red-400 bg-red-500/10 border-red-500/20';
      case 'cancelled': return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
      default: return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running': return (
        <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      );
      case 'paused': return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>;
      case 'completed': return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>;
      case 'failed': return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
      case 'cancelled': return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
      default: return <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
    }
  };

  const NL_TASK_EXAMPLES = [
    'Open Chrome and search for "InfiniteAI OS" on Google',
    'Install the latest version of Node.js',
    'Open VS Code and create a new file called test.py',
    'Go to amazon.com and find the cheapest USB cable',
    'Send an email to john@example.com with subject "Hello"',
    'Open Spotify and play my liked songs',
    'Take a screenshot and save it to Desktop',
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Task Replay</h1>
          <p className="text-gray-500 text-sm">Execute learned tasks with natural language or step-by-step replay.</p>
        </div>
      </div>

      {/* Natural Language Input */}
      <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-6 mb-6">
        <h3 className="text-sm font-medium text-white mb-3">Natural Language Task Execution</h3>
        <div className="flex gap-2 mb-4">
          <input
            value={nlInput}
            onChange={(e) => setNlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExecuteNL()}
            placeholder="Describe what you want to do... (e.g. 'Open Chrome and go to google.com')"
            className="flex-1 bg-white/5 border border-white/[0.08] rounded-lg px-4 py-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500/40 transition-all"
          />
          <button
            onClick={handleExecuteNL}
            disabled={nlLoading || !nlInput.trim()}
            className="px-6 py-3 rounded-lg bg-gradient-to-r from-indigo-500/20 to-purple-500/20 text-indigo-300 text-sm font-medium hover:from-indigo-500/30 hover:to-purple-500/30 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {nlLoading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Executing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                </svg>
                Execute
              </>
            )}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {NL_TASK_EXAMPLES.map((example, i) => (
            <button
              key={i}
              onClick={() => setNlInput(example)}
              className="px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06] text-[10px] text-gray-500 hover:text-white hover:border-white/[0.1] transition-all"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Executions List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <h3 className="text-sm font-medium text-white mb-3">Execution History</h3>
          <div className="space-y-3">
            {executions.map((ex) => (
              <div
                key={ex.id}
                onClick={() => setSelectedExecution(selectedExecution?.id === ex.id ? null : ex)}
                className={`bg-[#1a1a1f] border rounded-xl p-4 cursor-pointer transition-all ${
                  selectedExecution?.id === ex.id ? 'border-indigo-500/40' : 'border-white/[0.06] hover:border-white/[0.1]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`${getStatusColor(ex.status)} px-2 py-0.5 rounded-full text-[10px] font-medium border flex items-center gap-1`}>
                      {getStatusIcon(ex.status)}
                      {ex.status}
                    </span>
                    <span className="text-sm text-white font-medium">{ex.taskName}</span>
                  </div>
                  <span className="text-[10px] text-gray-500">{new Date(ex.startTime).toLocaleString()}</span>
                </div>

                <div className="flex items-center gap-3 mb-2">
                  <div className="flex-1 bg-white/5 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        ex.status === 'completed' ? 'bg-green-500' :
                        ex.status === 'failed' ? 'bg-red-500' :
                        ex.status === 'running' ? 'bg-indigo-500' :
                        'bg-gray-500'
                      }`}
                      style={{ width: `${ex.totalSteps > 0 ? (ex.currentStep / ex.totalSteps) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500">
                    {ex.currentStep}/{ex.totalSteps}
                  </span>
                </div>

                {ex.error && (
                  <p className="text-[10px] text-red-400 mt-2">{ex.error}</p>
                )}

                {selectedExecution?.id === ex.id && (
                  <div className="mt-4 pt-4 border-t border-white/[0.06]">
                    {/* Step Results */}
                    <div className="space-y-2 mb-4">
                      {ex.results.map((r, i) => (
                        <div key={i} className={`flex items-center gap-3 text-xs p-2 rounded-lg ${r.success ? 'bg-green-500/5' : 'bg-red-500/5'}`}>
                          <span className={r.success ? 'text-green-400' : 'text-red-400'}>
                            {r.success ? '✓' : '✗'}
                          </span>
                          <span className="text-gray-400">Step {r.stepIndex + 1}</span>
                          {r.error && <span className="text-red-400 flex-1">{r.error}</span>}
                          {r.result != null && <span className="text-gray-500 flex-1 truncate">{String(JSON.stringify(r.result).slice(0, 50))}</span>}
                        </div>
                      ))}
                    </div>

                    {/* Variables */}
                    {Object.keys(ex.variables).length > 0 && (
                      <div className="mb-4">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-2">Variables</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(ex.variables).map(([key, value]) => (
                            <span key={key} className="px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-[10px]">
                              <span className="text-indigo-400">{key}:</span>{' '}
                              <span className="text-white">{value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2">
                      {ex.status === 'running' && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); handlePause(ex.id); }}
                            className="px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-300 text-xs hover:bg-yellow-500/20 transition-all"
                          >
                            Pause
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancel(ex.id); }}
                            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-300 text-xs hover:bg-red-500/20 transition-all"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {ex.status === 'paused' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResume(ex.id); }}
                          className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-300 text-xs hover:bg-green-500/20 transition-all"
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {executions.length === 0 && !loading && (
              <div className="text-center py-12 text-gray-500 text-sm bg-[#1a1a1f] border border-white/[0.06] rounded-xl">
                <svg className="w-10 h-10 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
                </svg>
                No task executions yet.
                <br />
                <span className="text-xs">Use natural language above to run a task.</span>
              </div>
            )}
          </div>
        </div>

        {/* Info Panel */}
        <div className="space-y-4">
          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">How It Works</h3>
            <div className="space-y-3 text-xs text-gray-400">
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span>
                <p>Type a natural language command describing your task.</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span>
                <p>The AI parses your intent and maps it to computer actions (click, type, navigate, etc.).</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span>
                <p>Steps are executed in sequence with mouse/keyboard control.</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span>
                <p>You can pause, resume, or cancel at any time.</p>
              </div>
            </div>
          </div>

          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">Supported Actions</h3>
            <div className="flex flex-wrap gap-1.5">
              {['open_url', 'click', 'type', 'press_key', 'scroll', 'wait', 'screenshot', 'select', 'hover', 'extract', 'navigate_back'].map((action) => (
                <span key={action} className="px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06] text-[10px] text-gray-400">
                  {action.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-[#1a1a1f] border border-white/[0.06] rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-3">Quick Commands</h3>
            <div className="space-y-2">
              {[
                'Take a screenshot',
                'Open File Explorer',
                'Type "hello world"',
                'Press Ctrl+S',
                'Scroll down 3 times',
                'Go to github.com',
              ].map((cmd, i) => (
                <button
                  key={i}
                  onClick={() => setNlInput(cmd)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-xs text-gray-400 hover:text-white hover:border-white/[0.1] transition-all"
                >
                  {cmd}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

