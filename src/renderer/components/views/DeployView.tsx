import { useState, useEffect } from 'react';
import { Rocket, Play, XCircle, Trash2, Plus, CheckCircle2, AlertCircle, Clock, Terminal } from 'lucide-react';

interface DeployTarget {
  id: string;
  name: string;
  type: string;
  config: Record<string, string>;
  lastDeploy?: number;
  status: string;
}

interface DeployPipeline {
  id: string;
  name: string;
  projectId: string;
  targetId: string;
  steps: any[];
  status: string;
  currentStep: number;
  logs: string[];
  startedAt?: number;
  completedAt?: number;
}

export function DeployView() {
  const [targets, setTargets] = useState<DeployTarget[]>([]);
  const [pipelines, setPipelines] = useState<DeployPipeline[]>([]);
  const [showNewTarget, setShowNewTarget] = useState(false);
  const [newTargetName, setNewTargetName] = useState('');
  const [newTargetType, setNewTargetType] = useState('npm');
  const [newTargetConfig, setNewTargetConfig] = useState('');
  const [selectedPipeline, setSelectedPipeline] = useState<DeployPipeline | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [detectedType, setDetectedType] = useState('');

  useEffect(() => { loadTargets(); loadPipelines(); }, []);

  const loadTargets = async () => {
    try { setTargets(await (window as any).api.deployListTargets()); } catch {}
  };
  const loadPipelines = async () => {
    try { setPipelines(await (window as any).api.deployListPipelines()); } catch {}
  };

  const createTarget = async () => {
    if (!newTargetName) return;
    let config = {};
    try { config = JSON.parse(newTargetConfig); } catch {}
    await (window as any).api.deployCreateTarget({ name: newTargetName, type: newTargetType, config });
    setShowNewTarget(false);
    setNewTargetName('');
    setNewTargetConfig('');
    loadTargets();
  };

  const deleteTarget = async (id: string) => {
    await (window as any).api.deployDeleteTarget({ id });
    loadTargets();
  };

  const runPipeline = async (pipeline: DeployPipeline) => {
    const result = await (window as any).api.deployRunPipeline({ pipelineId: pipeline.id, cwd: projectPath || undefined });
    if (result) setSelectedPipeline(result);
    loadPipelines();
  };

  const cancelPipeline = async (id: string) => {
    await (window as any).api.deployCancelPipeline({ pipelineId: id });
    loadPipelines();
  };

  const detectProject = async () => {
    if (!projectPath) return;
    const type = await (window as any).api.deployDetectProject({ projectPath });
    setDetectedType(type || 'unknown');
  };

  const createQuickPipeline = async () => {
    const config = await (window as any).api.deployDefaultConfig({ type: detectedType || 'node' });
    if (!config) return;
    const tgt = targets[0];
    if (!tgt) return;
    const cmds = Object.values(config.commands).filter(Boolean);
    const p = await (window as any).api.deployCreatePipeline({
      name: `Build ${detectedType || 'project'}`,
      projectId: projectPath,
      targetId: tgt.id,
      commands: cmds,
    });
    setSelectedPipeline(p);
    loadPipelines();
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle2 size={14} className="text-green-400" />;
      case 'failed': return <AlertCircle size={14} className="text-red-400" />;
      case 'deploying': case 'running': return <Clock size={14} className="text-yellow-400 animate-pulse" />;
      default: return <div className="w-3.5 h-3.5 rounded-full border border-[var(--border)]" />;
    }
  };

  return (
    <div className="h-full flex bg-[var(--bg-primary)]">
      <div className="w-72 border-r border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)] space-y-2">
          <button onClick={() => setShowNewTarget(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[var(--accent)] text-white text-sm">
            <Plus size={14} /> New Target
          </button>
          <div className="flex gap-2">
            <input type="text" placeholder="Project path..." value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              className="flex-1 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm" />
            <button onClick={detectProject} className="px-2 py-2 rounded bg-[var(--bg-tertiary)] text-sm">
              Detect
            </button>
          </div>
          {detectedType && (
            <div className="flex items-center justify-between p-2 bg-[var(--bg-secondary)] rounded text-sm">
              <span>Detected: <strong>{detectedType}</strong></span>
              <button onClick={createQuickPipeline} className="text-[var(--accent)] text-xs">Quick Build</button>
            </div>
          )}
        </div>

        <div className="p-2 border-b border-[var(--border)]">
          <h3 className="text-xs font-medium text-[var(--text-secondary)] px-2">Targets</h3>
        </div>
        <div className="flex-1 overflow-auto">
          {targets.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                {statusIcon(t.status)}
                <div>
                  <span className="text-sm font-medium">{t.name}</span>
                  <span className="text-xs text-[var(--text-secondary)] ml-2">{t.type}</span>
                </div>
              </div>
              <button onClick={() => deleteTarget(t.id)} className="text-[var(--text-secondary)] hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-2 border-b border-[var(--border)]">
          <h3 className="text-xs font-medium text-[var(--text-secondary)] px-2">Pipelines</h3>
        </div>
        <div className="flex-1 overflow-auto">
          {pipelines.map((p) => (
            <div key={p.id} onClick={() => setSelectedPipeline(p)}
              className={`p-3 border-b border-[var(--border)] cursor-pointer hover:bg-[var(--bg-tertiary)] ${
                selectedPipeline?.id === p.id ? 'bg-[var(--bg-tertiary)]' : ''
              }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {statusIcon(p.status)}
                  <span className="text-sm">{p.name}</span>
                </div>
                <div className="flex gap-1">
                  {p.status === 'idle' && (
                    <button onClick={(e) => { e.stopPropagation(); runPipeline(p); }}
                      className="p-1 hover:text-green-400"><Play size={12} /></button>
                  )}
                  {p.status === 'running' && (
                    <button onClick={(e) => { e.stopPropagation(); cancelPipeline(p.id); }}
                      className="p-1 hover:text-red-400"><XCircle size={12} /></button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {showNewTarget ? (
          <div className="p-6 max-w-md">
            <h2 className="text-lg font-semibold mb-4">New Deploy Target</h2>
            <div className="space-y-3">
              <input type="text" placeholder="Target name" value={newTargetName}
                onChange={(e) => setNewTargetName(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm" />
              <select value={newTargetType} onChange={(e) => setNewTargetType(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm">
                <option value="npm">npm</option>
                <option value="docker">Docker</option>
                <option value="vercel">Vercel</option>
                <option value="netlify">Netlify</option>
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcloud">Google Cloud</option>
                <option value="ssh">SSH</option>
                <option value="local">Local</option>
              </select>
              <textarea placeholder='Config JSON: {"token":"xxx"}' value={newTargetConfig}
                onChange={(e) => setNewTargetConfig(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm h-20 font-mono resize-none" />
              <div className="flex gap-2">
                <button onClick={createTarget} className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm">Create</button>
                <button onClick={() => setShowNewTarget(false)} className="px-4 py-2 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
              </div>
            </div>
          </div>
        ) : selectedPipeline ? (
          <div className="flex-1 flex flex-col p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">{selectedPipeline.name}</h2>
              <div className="flex gap-2">
                {selectedPipeline.status === 'idle' && (
                  <button onClick={() => runPipeline(selectedPipeline)}
                    className="px-3 py-2 rounded bg-green-600 text-white text-sm flex items-center gap-1">
                    <Play size={14} /> Run
                  </button>
                )}
                {selectedPipeline.status === 'running' && (
                  <button onClick={() => cancelPipeline(selectedPipeline.id)}
                    className="px-3 py-2 rounded bg-red-600 text-white text-sm flex items-center gap-1">
                    <XCircle size={14} /> Cancel
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {selectedPipeline.steps.map((step: any, i: number) => (
                <div key={step.id} className={`flex items-center gap-3 p-3 rounded ${
                  i === selectedPipeline.currentStep && selectedPipeline.status === 'running'
                    ? 'bg-yellow-500/10 border border-yellow-500/30'
                    : 'bg-[var(--bg-secondary)]'
                }`}>
                  {statusIcon(step.status)}
                  <span className="text-sm flex-1">{step.name}</span>
                  <span className="text-xs text-[var(--text-secondary)] font-mono">{step.command}</span>
                </div>
              ))}
            </div>

            {selectedPipeline.logs.length > 0 && (
              <div className="flex-1 bg-[var(--bg-secondary)] rounded-lg p-4 overflow-auto">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal size={14} />
                  <span className="text-xs font-medium">Pipeline Logs</span>
                </div>
                <pre className="text-xs font-mono text-[var(--text-secondary)] whitespace-pre-wrap">
                  {selectedPipeline.logs.join('\n')}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <div className="text-center">
              <Rocket size={48} className="mx-auto mb-4 opacity-50" />
              <p>Select a pipeline or create a deploy target</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
