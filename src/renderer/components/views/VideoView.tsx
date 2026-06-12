import { useState, useEffect } from 'react';
import { Film, Plus, Trash2, Scissors, Play, Tag, Clock, Zap, Search } from 'lucide-react';

interface VideoProject {
  id: string;
  name: string;
  description: string;
  sourceFile: string;
  clips: any[];
  highlights: string[];
  createdAt: number;
}

export function VideoView() {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<VideoProject | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [clipStart, setClipStart] = useState('0');
  const [clipEnd, setClipEnd] = useState('60');
  const [clipName, setClipName] = useState('');
  const [highlights, setHighlights] = useState<any[]>([]);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => { loadProjects(); }, []);

  const loadProjects = async () => {
    try {
      const p = await (window as any).api.videoListProjects();
      setProjects(p || []);
    } catch {}
  };

  const createProject = async () => {
    if (!newName || !newSource) return;
    const p = await (window as any).api.videoCreateProject({ name: newName, sourceFile: newSource, description: newDesc });
    setSelectedProject(p);
    setShowNewProject(false);
    setNewName('');
    setNewSource('');
    setNewDesc('');
    loadProjects();
  };

  const deleteProject = async (id: string) => {
    await (window as any).api.videoDeleteProject({ id });
    if (selectedProject?.id === id) setSelectedProject(null);
    loadProjects();
  };

  const analyzeProject = async () => {
    if (!selectedProject) return;
    setAnalyzing(true);
    try {
      await (window as any).api.videoAnalyze({ projectId: selectedProject.id });
    } catch {}
    setAnalyzing(false);
  };

  const findHighlights = async () => {
    if (!selectedProject) return;
    try {
      const h = await (window as any).api.videoFindHighlights({ projectId: selectedProject.id, maxClips: 10 });
      setHighlights(h || []);
    } catch {}
  };

  const extractClip = async () => {
    if (!selectedProject) return;
    await (window as any).api.videoExtractClip({
      projectId: selectedProject.id,
      startTime: parseInt(clipStart) || 0,
      endTime: parseInt(clipEnd) || 60,
      name: clipName || `Clip ${clipStart}-${clipEnd}`,
      tags: [],
    });
    loadProjects();
  };

  return (
    <div className="h-full flex bg-[var(--bg-primary)]">
      <div className="w-64 border-r border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)]">
          <button
            onClick={() => setShowNewProject(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded bg-[var(--accent)] text-white text-sm"
          >
            <Plus size={14} /> New Project
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {projects.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedProject(p)}
              className={`p-3 border-b border-[var(--border)] cursor-pointer hover:bg-[var(--bg-tertiary)] ${
                selectedProject?.id === p.id ? 'bg-[var(--bg-tertiary)]' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Film size={14} className="text-[var(--accent)]" />
                  <span className="text-sm font-medium truncate">{p.name}</span>
                </div>
                <button onClick={() => deleteProject(p.id)} className="text-[var(--text-secondary)] hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mt-1">{p.clips.length} clips</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {showNewProject ? (
          <div className="p-6 max-w-md mx-auto">
            <h2 className="text-lg font-semibold mb-4">New Video Project</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Project name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm"
              />
              <input
                type="text"
                placeholder="Source file path"
                value={newSource}
                onChange={(e) => setNewSource(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm"
              />
              <textarea
                placeholder="Description (optional)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="w-full p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-sm h-20 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={createProject} className="px-4 py-2 rounded bg-[var(--accent)] text-white text-sm">
                  Create
                </button>
                <button onClick={() => setShowNewProject(false)} className="px-4 py-2 rounded bg-[var(--bg-tertiary)] text-sm">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : selectedProject ? (
          <div className="flex-1 overflow-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-lg font-semibold">{selectedProject.name}</h2>
                <p className="text-sm text-[var(--text-secondary)]">{selectedProject.description || selectedProject.sourceFile}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={analyzeProject} disabled={analyzing}
                  className="px-3 py-2 rounded bg-[var(--bg-tertiary)] text-sm flex items-center gap-1 disabled:opacity-50">
                  <Zap size={14} /> {analyzing ? 'Analyzing...' : 'Analyze'}
                </button>
                <button onClick={findHighlights}
                  className="px-3 py-2 rounded bg-[var(--bg-tertiary)] text-sm flex items-center gap-1">
                  <Search size={14} /> Find Highlights
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Scissors size={14} /> Extract Clip
                </h3>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Clip name"
                    value={clipName}
                    onChange={(e) => setClipName(e.target.value)}
                    className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm"
                  />
                  <div className="flex gap-2">
                    <input type="number" placeholder="Start (s)" value={clipStart}
                      onChange={(e) => setClipStart(e.target.value)}
                      className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                    <input type="number" placeholder="End (s)" value={clipEnd}
                      onChange={(e) => setClipEnd(e.target.value)}
                      className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                  </div>
                  <button onClick={extractClip}
                    className="w-full px-3 py-2 rounded bg-[var(--accent)] text-white text-sm">
                    Extract Clip
                  </button>
                </div>
              </div>

              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Clock size={14} /> Clips ({selectedProject.clips.length})
                </h3>
                <div className="space-y-1 max-h-40 overflow-auto">
                  {selectedProject.clips.map((c: any) => (
                    <div key={c.id} className="flex items-center justify-between p-2 bg-[var(--bg-primary)] rounded text-sm">
                      <span className="truncate">{c.name}</span>
                      <span className="text-[var(--text-secondary)]">{c.duration}s</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {highlights.length > 0 && (
              <div className="p-4 bg-[var(--bg-secondary)] rounded-lg">
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Zap size={14} /> AI Highlights
                </h3>
                <div className="space-y-2">
                  {highlights.map((h, i) => (
                    <div key={i} className="p-3 bg-[var(--bg-primary)] rounded flex items-center justify-between">
                      <div>
                        <p className="text-sm">{h.name}</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {Math.floor(h.startTime / 60)}:{String(h.startTime % 60).padStart(2, '0')} -{' '}
                          {Math.floor(h.endTime / 60)}:{String(h.endTime % 60).padStart(2, '0')}
                        </p>
                      </div>
                      {h.score && (
                        <span className="text-xs text-[var(--accent)]">{Math.round(h.score * 100)}%</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[var(--text-secondary)]">
            <div className="text-center">
              <Film size={48} className="mx-auto mb-4 opacity-50" />
              <p>Select a project or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
