import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Code2, FolderOpen, Megaphone, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { useNotificationStore } from '../../stores/notifications';

type ProjectKind = 'business' | 'software' | 'research' | 'marketing' | 'operations' | 'personal' | 'general';
type ProjectStatus = 'active' | 'closed';

interface ManagedProject {
  id: string;
  name: string;
  description: string;
  kind: ProjectKind;
  path: string;
  status: ProjectStatus;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'infinite:managed-projects';
const kinds: Array<{ id: ProjectKind; label: string; description: string }> = [
  { id: 'business', label: 'Business', description: 'Strategy, planning, clients, finances, and operations' },
  { id: 'software', label: 'Software', description: 'Code, technical notes, releases, and product work' },
  { id: 'research', label: 'Research', description: 'Sources, findings, experiments, and reports' },
  { id: 'marketing', label: 'Marketing', description: 'Campaigns, content, brand, and growth work' },
  { id: 'operations', label: 'Operations', description: 'Processes, checklists, logistics, and delivery' },
  { id: 'personal', label: 'Personal', description: 'Personal goals, notes, and organized files' },
  { id: 'general', label: 'General', description: 'A flexible project for anything else' },
];

const kindStyles: Record<ProjectKind, string> = {
  business: 'from-emerald-500 to-teal-500', software: 'from-cyan-500 to-blue-500',
  research: 'from-violet-500 to-indigo-500', marketing: 'from-pink-500 to-orange-500',
  operations: 'from-amber-500 to-yellow-500', personal: 'from-fuchsia-500 to-purple-500',
  general: 'from-zinc-500 to-slate-500',
};

function currentRoot(): string {
  try { return JSON.parse(localStorage.getItem('infinite:current') ?? '{}').cwd ?? '.'; }
  catch { return '.'; }
}

function joinPath(parent: string, child: string): string {
  return `${parent.replace(/[\\/]+$/, '')}/${child.replace(/^[\\/]+/, '')}`;
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'Project';
}

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code <= 31 || code === 127) continue;
    out += ch;
  }
  return out;
}

function safeFolderName(name: string): string {
  return stripControlChars(name.trim()).replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'New Project';
}

function loadProjects(): ManagedProject[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as ManagedProject[]; }
  catch { return []; }
}

function projectFiles(name: string, kind: ProjectKind, description: string): Array<{ name: string; content: string }> {
  const intro = `# ${name}\n\n${description || `${kinds.find((item) => item.id === kind)?.label} project created in Infinite OS.`}\n`;
  const templates: Record<ProjectKind, Array<{ name: string; content: string }>> = {
    business: [
      { name: 'README.md', content: `${intro}\n## Project overview\n\n## Goals\n\n## Success measures\n` },
      { name: 'business-plan.md', content: '# Business Plan\n\n## Customer\n\n## Offer\n\n## Revenue model\n\n## Operations\n' },
      { name: 'tasks.md', content: '# Tasks\n\n- [ ] Define the next milestone\n- [ ] Assign owners\n- [ ] Review progress\n' },
    ],
    software: [{ name: 'README.md', content: `${intro}\n## Requirements\n\n## Setup\n\n## Roadmap\n` }, { name: 'notes.md', content: '# Development Notes\n' }],
    research: [{ name: 'README.md', content: intro }, { name: 'sources.md', content: '# Sources\n' }, { name: 'findings.md', content: '# Findings\n' }],
    marketing: [{ name: 'README.md', content: intro }, { name: 'campaign-plan.md', content: '# Campaign Plan\n\n## Audience\n\n## Message\n\n## Channels\n\n## Metrics\n' }],
    operations: [{ name: 'README.md', content: intro }, { name: 'processes.md', content: '# Processes\n' }, { name: 'checklist.md', content: '# Checklist\n\n- [ ] First action\n' }],
    personal: [{ name: 'README.md', content: intro }, { name: 'notes.md', content: '# Notes\n' }, { name: 'tasks.md', content: '# Tasks\n' }],
    general: [{ name: 'README.md', content: intro }, { name: 'notes.md', content: '# Notes\n' }],
  };
  return templates[kind];
}

export function ProjectsView({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const addToast = useNotificationStore((state) => state.addToast);
  const [projects, setProjects] = useState<ManagedProject[]>(loadProjects);
  const [showCreate, setShowCreate] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', kind: 'business' as ProjectKind, parent: currentRoot() });
  const [busy, setBusy] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(projects)); }, [projects]);

  const visible = useMemo(() => projects
    .filter((project) => project.status === (showClosed ? 'closed' : 'active'))
    .filter((project) => `${project.name} ${project.description} ${project.kind}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [projects, query, showClosed]);

  const update = (id: string, values: Partial<ManagedProject>) => setProjects((items) => items.map((item) => item.id === id ? { ...item, ...values, updatedAt: Date.now() } : item));
  const notifyError = (title: string, error: unknown) => addToast({ type: 'error', title, message: error instanceof Error ? error.message : String(error) });

  const chooseParent = async () => {
    const path = await window.api.pickDirectory();
    if (path) setForm((value) => ({ ...value, parent: path }));
  };

  const createProject = async () => {
    if (!form.name.trim() || !form.parent) return;
    setBusy(true);
    try {
      const name = safeFolderName(form.name);
      const path = joinPath(form.parent, name);
      const result = await window.api.fileMkdir({ path }) as { ok?: boolean; error?: string };
      if (result?.error) throw new Error(result.error);
      for (const file of projectFiles(form.name.trim(), form.kind, form.description.trim())) {
        const write = await window.api.fileWrite({ path: joinPath(path, file.name), content: file.content }) as { error?: string };
        if (write?.error) throw new Error(write.error);
      }
      setProjects((items) => [{ id: crypto.randomUUID(), name: form.name.trim(), description: form.description.trim(), kind: form.kind, path, status: 'active', createdAt: Date.now(), updatedAt: Date.now() }, ...items]);
      setForm({ name: '', description: '', kind: 'business', parent: currentRoot() });
      setShowCreate(false);
      addToast({ type: 'success', title: 'Project created', message: `${form.kind} project files are ready.` });
    } catch (error) { notifyError('Could not create project', error); }
    finally { setBusy(false); }
  };

  const addExisting = async () => {
    const path = await window.api.pickDirectory();
    if (!path) return;
    const existing = projects.find((project) => project.path.toLowerCase() === path.toLowerCase());
    if (existing) { update(existing.id, { status: 'active' }); return; }
    setProjects((items) => [{ id: crypto.randomUUID(), name: basename(path), description: 'Existing folder', kind: 'general', path, status: 'active', createdAt: Date.now(), updatedAt: Date.now() }, ...items]);
  };

  const openInWorkspace = (project: ManagedProject) => {
    const current = JSON.parse(localStorage.getItem('infinite:current') ?? '{}');
    localStorage.setItem('infinite:current', JSON.stringify({ ...current, cwd: project.path }));
    update(project.id, {});
    onOpenWorkspace();
  };

  const renameProject = async (project: ManagedProject) => {
    const requested = window.prompt('Rename project', project.name)?.trim();
    if (!requested || requested === project.name) return;
    const parent = project.path.replace(/[\\/][^\\/]+[\\/]?$/, '');
    const newPath = joinPath(parent, safeFolderName(requested));
    try {
      const result = await window.api.fileRename({ oldPath: project.path, newPath }) as { ok?: boolean; error?: string };
      if (result?.error) throw new Error(result.error);
      update(project.id, { name: requested, path: newPath });
    } catch (error) { notifyError('Could not rename project', error); }
  };

  const moveProject = async (project: ManagedProject) => {
    const destination = await window.api.pickDirectory();
    if (!destination) return;
    const newPath = joinPath(destination, basename(project.path));
    try {
      const result = await window.api.fileRename({ oldPath: project.path, newPath }) as { ok?: boolean; error?: string };
      if (result?.error) throw new Error(result.error);
      update(project.id, { path: newPath });
    } catch (error) { notifyError('Could not move project', error); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 animate-fade-in">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">Organize every kind of project and open its real files in Infinite OS.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void addExisting()} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-zinc-300 hover:border-white/20"><FolderOpen className="mr-2 inline h-4 w-4" />Add Existing</button>
          <button onClick={() => setShowCreate(true)} className="btn-premium flex items-center gap-2"><Plus className="h-4 w-4" />New Project</button>
        </div>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <div className="relative max-w-lg flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." className="input-premium w-full pl-9" /></div>
        <button onClick={() => setShowClosed(false)} className={`rounded-lg px-3 py-2 text-xs ${!showClosed ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-200'}`}>Active ({projects.filter((item) => item.status === 'active').length})</button>
        <button onClick={() => setShowClosed(true)} className={`rounded-lg px-3 py-2 text-xs ${showClosed ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-500 hover:text-zinc-200'}`}>Closed ({projects.filter((item) => item.status === 'closed').length})</button>
      </div>

      {showCreate && <div className="card-premium mb-6 border-cyan-500/25">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-zinc-100">Create a project</h2><p className="text-xs text-zinc-500">Infinite OS creates an organized folder with editable starter documents.</p></div><button onClick={() => setShowCreate(false)}><X className="h-4 w-4 text-zinc-500" /></button></div>
        <div className="grid gap-3 md:grid-cols-2"><input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))} placeholder="Project name" className="input-premium" /><select value={form.kind} onChange={(event) => setForm((value) => ({ ...value, kind: event.target.value as ProjectKind }))} className="input-premium">{kinds.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}</select><textarea value={form.description} onChange={(event) => setForm((value) => ({ ...value, description: event.target.value }))} placeholder="What is this project for?" className="input-premium min-h-20 md:col-span-2" /></div>
        <div className="mt-3 flex items-center gap-2"><div className="min-w-0 flex-1 truncate rounded-lg bg-black/20 px-3 py-2 font-mono text-[10px] text-zinc-500">{form.parent || 'Choose a location'}</div><button onClick={() => void chooseParent()} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300">Choose Location</button><button onClick={() => void createProject()} disabled={busy || !form.name.trim() || !form.parent} className="btn-premium disabled:opacity-40">{busy ? 'Creating...' : 'Create Project'}</button></div>
      </div>}

      {visible.length === 0 ? <div className="rounded-xl border border-dashed border-white/10 py-20 text-center"><BriefcaseBusiness className="mx-auto mb-3 h-9 w-9 text-zinc-700" /><div className="font-medium text-zinc-300">{showClosed ? 'No closed projects' : 'No projects yet'}</div><p className="mt-1 text-xs text-zinc-600">Create a business, software, research, or any other project.</p></div> : <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{visible.map((project) => <article key={project.id} className="card-premium group relative hover:border-white/15">
        <div className="mb-4 flex items-start gap-3"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${kindStyles[project.kind]} shadow-lg`}>{project.kind === 'software' ? <Code2 className="h-5 w-5 text-white" /> : project.kind === 'marketing' ? <Megaphone className="h-5 w-5 text-white" /> : <BriefcaseBusiness className="h-5 w-5 text-white" />}</div><div className="min-w-0 flex-1"><h2 className="truncate font-medium text-white">{project.name}</h2><div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-600">{kinds.find((kind) => kind.id === project.kind)?.label}</div></div><button onClick={() => setMenuId(menuId === project.id ? null : project.id)} className="rounded p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-200"><MoreHorizontal className="h-4 w-4" /></button></div>
        <p className="mb-4 line-clamp-2 min-h-10 text-xs leading-5 text-zinc-500">{project.description || 'No description yet.'}</p><div className="mb-4 truncate rounded-lg bg-black/20 px-2.5 py-2 font-mono text-[10px] text-zinc-600" title={project.path}>{project.path}</div>
        <div className="flex gap-2"><button onClick={() => openInWorkspace(project)} className="flex-1 rounded-lg bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/15">Open in Workspace</button><button onClick={() => void window.api.fileOpen({ path: project.path })} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white">Folder</button></div>
        {menuId === project.id && <div className="absolute right-4 top-12 z-20 min-w-36 rounded-lg border border-white/10 bg-[#17171d] py-1 shadow-xl"><button onClick={() => { setMenuId(null); void renameProject(project); }} className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/5">Rename</button><button onClick={() => { setMenuId(null); void moveProject(project); }} className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/5">Move</button><button onClick={() => { update(project.id, { status: project.status === 'active' ? 'closed' : 'active' }); setMenuId(null); }} className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-white/5">{project.status === 'active' ? 'Close project' : 'Reopen project'}</button><div className="mx-2 border-t border-white/10" /><button onClick={() => { if (window.confirm(`Remove “${project.name}” from Projects? Its files will not be deleted.`)) setProjects((items) => items.filter((item) => item.id !== project.id)); }} className="w-full px-3 py-2 text-left text-xs text-red-400 hover:bg-white/5">Remove from list</button></div>}
      </article>)}</div>}
    </div>
  );
}
