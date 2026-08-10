import { useEffect, useState } from 'react';
import { useAppStore } from '../../../renderer/stores/app';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function AppBuilderView() {
  const { projects, templates, stats, loadProjects, loadTemplates, loadStats, createProject, buildProject, deleteProject, renameProject, moveProject, runProject, generateComponent, generatePage, generateApi } = useAppStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', type: 'react' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { loadProjects(); loadTemplates(); loadStats(); }, [loadProjects, loadTemplates, loadStats]);

  const handleCreate = async () => {
    if (!newProject.name.trim()) return;
    try {
      await createProject({ name: newProject.name, type: newProject.type });
      setNewProject({ name: '', type: 'react' }); setShowCreate(false);
      addToast({ type: 'success', title: 'Project created' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not create project', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleBuild = async (id: string) => {
    setBusyId(id);
    try {
      await buildProject(id);
      addToast({ type: 'success', title: 'Project built' });
    } catch (error) {
      addToast({ type: 'error', title: 'Build failed', message: error instanceof Error ? error.message : String(error) });
    } finally { setBusyId(null); }
  };

  const act = async (title: string, action: () => Promise<void>) => {
    try { await action(); addToast({ type: 'success', title }); }
    catch (error) { addToast({ type: 'error', title: `${title} failed`, message: error instanceof Error ? error.message : String(error) }); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete the project “${name}”?`)) return;
    try {
      await deleteProject(id);
      addToast({ type: 'success', title: 'Project deleted' });
    } catch (error) {
      addToast({ type: 'error', title: 'Could not delete project', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
            </div>
            App Builder
          </h1>
          <p className="text-textMuted text-sm mt-1">Generate React, Electron, and Express apps with AI.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New Project
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Projects', value: stats?.totalProjects ?? projects.length },
          { label: 'React', value: stats?.byType?.react ?? 0 },
          { label: 'Electron', value: stats?.byType?.electron ?? 0 },
        ].map((stat, i) => (
          <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
            <div className="text-xs text-textMuted mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-textMain">{stat.value}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="card-premium mb-6 border-cyan-500/30 animate-scale-in">
          <h3 className="text-sm font-semibold text-textMain mb-3">Create Project</h3>
          <div className="flex gap-3 mb-3">
            <input value={newProject.name} onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))} placeholder="Project name" className="input-premium flex-1" />
            <select value={newProject.type} onChange={(e) => setNewProject((p) => ({ ...p, type: e.target.value }))} className="input-premium">
              <option value="react">React App</option>
              <option value="electron">Electron App</option>
              <option value="express">Express API</option>
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs">Cancel</button>
            <button onClick={handleCreate} className="btn-premium text-xs">Create Project</button>
          </div>
        </div>
      )}

      {/* Templates */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-textMain mb-3">Templates</h2>
        <div className="grid grid-cols-3 gap-3">
          {templates.map((t, i) => (
            <button key={t.id} onClick={() => { setNewProject({ name: '', type: t.type }); setShowCreate(true); }} className="card-premium text-left hover:border-cyan-500/30 cursor-pointer animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
              <div className="font-medium text-textMain text-sm">{t.name}</div>
              <div className="text-xs text-textMuted mt-1">{t.description}</div>
              <span className="inline-block mt-2 px-2 py-0.5 bg-cyan-500/10 text-cyan-400 rounded text-[10px]">{t.type}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Projects */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-textMain">Your Projects</h2>
        {projects.length === 0 ? (
          <div className="text-center py-12 text-textMuted">
            <p className="text-lg font-medium text-textMain">No projects yet</p>
            <p className="text-sm text-textMuted">Create your first app project</p>
          </div>
        ) : projects.map((proj, i) => (
          <div key={proj.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 20}ms` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" /></svg>
                </div>
                <div>
                  <div className="font-medium text-textMain">{proj.name}</div>
                  <div className="text-xs text-textMuted">{proj.type} &middot; {proj.files?.length ?? 0} files</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${proj.status === 'built' ? 'bg-green-500/15 text-green-400' : proj.status === 'building' ? 'bg-amber-500/15 text-amber-400' : 'bg-gray-500/15 text-gray-400'}`}>{proj.status}</span>
                <button onClick={() => setSelectedId(selectedId === proj.id ? null : proj.id)} className="px-3 py-1.5 rounded-lg bg-bgCard border border-borderSubtle text-xs text-textMain hover:border-cyan-500/30 transition-all">{selectedId === proj.id ? 'Close' : 'Manage'}</button>
                <button onClick={() => handleBuild(proj.id)} disabled={busyId === proj.id} className="px-3 py-1.5 rounded-lg bg-bgCard border border-borderSubtle text-xs text-textMain hover:border-cyan-500/30 disabled:opacity-50 transition-all">{busyId === proj.id ? 'Building…' : 'Build'}</button>
                <button onClick={() => handleDelete(proj.id, proj.name)} className="text-textMuted hover:text-brandRed transition-colors p-1" aria-label={`Delete ${proj.name}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                </button>
              </div>
            </div>
            {selectedId === proj.id && (
              <div className="mt-4 border-t border-borderSubtle pt-4">
                {proj.outputPath && <div className="mb-3 break-all rounded-lg bg-black/20 px-3 py-2 font-mono text-[10px] text-textMuted">{proj.outputPath}</div>}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { const name = window.prompt('Rename project', proj.name); if (name) void act('Project renamed', () => renameProject(proj.id, name)); }} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs hover:border-cyan-500/30">Rename</button>
                  <button onClick={() => void (async () => { const destination = await window.api.pickDirectory(); if (destination) await act('Project moved', () => moveProject(proj.id, destination)); })()} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs hover:border-cyan-500/30">Move</button>
                  <button disabled={!proj.outputPath} onClick={() => proj.outputPath && void window.api.fileOpen({ path: proj.outputPath })} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs disabled:opacity-40 hover:border-cyan-500/30">Open Folder</button>
                  <button disabled={!proj.outputPath} onClick={() => void act('Project started', () => runProject(proj.id))} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs disabled:opacity-40 hover:border-green-500/30">Run</button>
                  <button onClick={() => { const name = window.prompt('Component name', 'Dashboard'); if (name) void act('Component added', () => generateComponent({ projectId: proj.id, name, description: '' })); }} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs hover:border-violet-500/30">+ Component</button>
                  <button onClick={() => { const name = window.prompt('Page name', 'Home'); if (name) void act('Page added', () => generatePage({ projectId: proj.id, name, description: '' })); }} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs hover:border-violet-500/30">+ Page</button>
                  {(proj.type === 'express' || proj.type === 'fullstack') && <button onClick={() => { const name = window.prompt('API route name', 'items'); if (name) void act('API route added', () => generateApi({ projectId: proj.id, name, description: '' })); }} className="px-3 py-1.5 rounded-lg border border-borderSubtle text-xs hover:border-violet-500/30">+ API</button>}
                </div>
                <div className="mt-3 text-[10px] text-textMuted">{proj.files.map((file) => file.path).join(' · ') || 'No files yet'}</div>
                {proj.lastBuildLog && <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-[10px] text-textMuted">{proj.lastBuildLog}</pre>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

