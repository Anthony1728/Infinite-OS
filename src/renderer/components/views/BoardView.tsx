/**
 * Board — the Kanban view over the real project/task store.
 *
 * WHY THIS EXISTS
 *
 * The task engine was always real: projects with configurable columns, tasks with
 * subtasks, priorities, assignees, due dates, sprints, milestones, checklists and
 * comments, persisted under the profile home. The only way to see or change any of
 * it was to ask the agent in chat, because the storage lived inside the tool and
 * there was no view for it. This is that view.
 *
 * It reads and writes the same store as the `Project` tool, so a card dragged
 * here and a task created by the agent are one record, not two.
 *
 * Nothing on this screen is invented. Counts come from the tasks actually loaded,
 * "overdue" is computed from real due dates against the board's own final column,
 * and an empty column says it is empty rather than showing a placeholder.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, CheckCircle2, Circle, MessageSquare, ListChecks,
  Calendar, User, X, ChevronDown, FolderPlus,
} from 'lucide-react';
import type { ProjectRecord, ProjectTask, ChecklistItem, TaskComment, Priority } from '../../../main/projects/store';

// ── Local shapes ───────────────────────────────────────────────────────────
// Mirrored rather than imported from main so the renderer bundle does not pull
// node:fs in through the store module. Kept structurally identical.

interface Task extends Omit<ProjectTask, 'subtasks'> {
  subtasks?: Task[];
}

// window.api is fixed for the life of the window, so it is hoisted rather
// than read inside every callback.
const api = window.api;

const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];

const PRIORITY_STYLE: Record<Priority, string> = {
  low: 'text-slate-400 bg-slate-500/15',
  normal: 'text-blue-400 bg-blue-500/15',
  high: 'text-amber-400 bg-amber-500/15',
  urgent: 'text-red-400 bg-red-500/15',
};

/** A due date only counts as overdue once it has genuinely passed. */
function isOverdue(task: ProjectTask, finalColumn: string): boolean {
  if (!task.due || task.status === finalColumn) return false;
  const due = Date.parse(task.due);
  return Number.isFinite(due) && due < Date.now();
}

function formatDue(due: string): string {
  const at = Date.parse(due);
  if (!Number.isFinite(at)) return due;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Whole days until due; negative when past. */
function daysUntil(due: string): number {
  const at = Date.parse(due);
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return Math.ceil((at - Date.now()) / 86_400_000);
}

// ── Task detail ────────────────────────────────────────────────────────────

function TaskDetail({ task, board, subtasks, onClose, onChanged }: {
  task: Task;
  board: string[];
  subtasks: Task[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [assignee, setAssignee] = useState(task.assignee ?? '');
  const [due, setDue] = useState(task.due ? task.due.slice(0, 10) : '');
  const [checklistText, setChecklistText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const dirty =
    title !== task.title ||
    description !== task.description ||
    assignee !== (task.assignee ?? '') ||
    due !== (task.due ? task.due.slice(0, 10) : '');

  // Only the edit block is remounted when the selected task changes, so the
  // detail panel can show a full page rather than sit in a narrow column.
  const save = async () => {
    if (!title.trim()) {
      setError('A task needs a title.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.projectsUpdateTask({
        id: task.id,
        updates: {
          title: title.trim(),
          description,
          ...(assignee.trim() ? { assignee: assignee.trim() } : {}),
          // An emptied due date means "no due date", so send an empty string
          // rather than dropping the key and leaving the old value in place.
          due,
        },
      });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const moveTo = async (status: string) => {
    try {
      await api.projectsUpdateTask({ id: task.id, updates: { status } });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleItem = async (index: number) => {
    try {
      await api.projectsToggleChecklist({ taskId: task.id, index });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addItem = async () => {
    const text = checklistText.trim();
    if (!text) return;
    try {
      await api.projectsAddChecklist({ taskId: task.id, text });
      setChecklistText('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const addComment = async () => {
    const text = commentText.trim();
    if (!text) return;
    try {
      await api.projectsAddComment({ taskId: task.id, text });
      setCommentText('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    try {
      await api.projectsDeleteTask({ id: task.id });
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const done = task.checklist.filter((item: ChecklistItem) => item.done).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-[#12121a] border-l border-white/10 overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-white/10 bg-[#12121a]">
          <span className="text-xs font-medium text-white/50">Task</span>
          <div className="flex items-center gap-2">
            <button onClick={remove} title="Delete task (and its subtasks)" className="p-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10">
              <Trash2 size={15} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {error && <div className="text-xs text-red-400">{error}</div>}

          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-transparent border-b border-white/10 pb-2 text-lg font-semibold text-white outline-none focus:border-white/25"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-white/45">Column</span>
              <select
                value={task.status}
                onChange={(e) => void moveTo(e.target.value)}
                className="mt-1 w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
              >
                {/* A column the stored status no longer matches is still shown,
                    so renaming a board never makes its cards unselectable. */}
                {!board.includes(task.status) && <option value={task.status}>{task.status} (not on board)</option>}
                {board.map((column) => <option key={column} value={column}>{column}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] text-white/45">Priority</span>
              <select
                value={task.priority}
                onChange={async (e) => {
                  try {
                    await api.projectsUpdateTask({ id: task.id, updates: { priority: e.target.value as Priority } });
                    onChanged();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
                className="mt-1 w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] text-white/45">Assignee</span>
              <input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="unassigned"
                className="mt-1 w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none"
              />
            </label>

            <label className="block">
              <span className="text-[11px] text-white/45">Due</span>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="mt-1 w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none"
              />
            </label>
          </div>

          <div>
            <span className="text-[11px] text-white/45">Description</span>
            <textarea
              value={description}
              rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does done look like?"
              className="mt-1 w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/25 outline-none resize-y"
            />
          </div>

          {subtasks.length > 0 && (
            <div>
              <span className="text-[11px] text-white/45">Subtasks</span>
              <ul className="mt-1 space-y-1">
                {subtasks.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-2 text-xs">
                    {sub.status === board[board.length - 1]
                      ? <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                      : <Circle size={13} className="text-white/30 flex-shrink-0" />}
                    <span className={sub.status === board[board.length - 1] ? 'text-white/40 line-through' : 'text-white/75'}>
                      {sub.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <span className="text-[11px] text-white/45 flex items-center gap-1">
              <ListChecks size={12} /> Checklist
              {task.checklist.length > 0 && <span className="text-white/25">· {done}/{task.checklist.length}</span>}
            </span>
            <ul className="mt-1.5 space-y-1">
              {task.checklist.map((item: ChecklistItem, index: number) => (
                <li key={index}>
                  <button onClick={() => void toggleItem(index)} className="flex items-center gap-2 text-xs text-left w-full group">
                    {item.done
                      ? <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                      : <Circle size={13} className="text-white/30 group-hover:text-white/60 flex-shrink-0" />}
                    <span className={item.done ? 'text-white/40 line-through' : 'text-white/75'}>{item.text}</span>
                  </button>
                </li>
              ))}
              {task.checklist.length === 0 && <li className="text-xs text-white/25">No checklist items yet.</li>}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                value={checklistText}
                onChange={(e) => setChecklistText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addItem(); }}
                placeholder="Add an item…"
                className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none"
              />
              <button onClick={() => void addItem()} className="px-3 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:bg-white/10">
                Add
              </button>
            </div>
          </div>

          <div>
            <span className="text-[11px] text-white/45 flex items-center gap-1">
              <MessageSquare size={12} /> Comments
            </span>
            <ul className="mt-1.5 space-y-1.5">
              {(task.comments as TaskComment[]).map((comment, index) => (
                <li key={index} className="text-xs">
                  <span className="text-white/20">{new Date(comment.at).toLocaleString()}</span>
                  <span className="block text-white/70 whitespace-pre-wrap">{comment.text}</span>
                </li>
              ))}
              {task.comments.length === 0 && <li className="text-xs text-white/25">No comments yet.</li>}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }}
                placeholder="Write a comment…"
                className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none"
              />
              <button onClick={() => void addComment()} className="px-3 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:bg-white/10">
                Post
              </button>
            </div>
          </div>

          {dirty && (
            <div className="sticky bottom-0 -mx-4 px-4 py-3 bg-[#12121a] border-t border-white/10 flex items-center justify-end gap-2">
              <button onClick={() => { setTitle(task.title); setDescription(task.description); setAssignee(task.assignee ?? ''); setDue(task.due ? task.due.slice(0, 10) : ''); setError(''); }} className="px-3 py-1.5 rounded-lg text-xs text-white/50 hover:text-white">
                Discard
              </button>
              <button onClick={() => void save()} disabled={saving} className="px-4 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-medium disabled:opacity-50">
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────

function Card({ task, board, finalColumn, subtaskCount, checklist, onOpen, onMove }: {
  task: ProjectTask;
  board: string[];
  finalColumn: string;
  subtaskCount: number;
  checklist: { done: number; total: number };
  onOpen: () => void;
  onMove: (status: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const overdue = isOverdue(task, finalColumn);
  const days = task.due ? daysUntil(task.due) : Number.POSITIVE_INFINITY;

  return (
    <div
      draggable
      onDragStart={() => setDragging(true)}
      onDragEnd={() => setDragging(false)}
      onClick={onOpen}
      className={`group p-2.5 rounded-lg bg-[#0a0a0f] border border-white/5 cursor-pointer hover:border-indigo-500/40 transition-all ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        <span className="text-xs text-white/85 leading-snug flex-1">{task.title}</span>
        {/* Dragging a card is faster than opening it, so offer a compact
            column switcher on hover instead of forcing the detail panel. */}
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          <select
            value={task.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onMove(e.target.value)}
            title="Move to another column"
            className="bg-white/5 border border-white/10 rounded text-[10px] text-white/60 py-0.5 px-1 outline-none"
          >
            {/* Keep an off-board status selectable, so a card whose column was
                removed from the board can still be moved back onto it. */}
            {!board.includes(task.status) && <option value={task.status}>{task.status} (off board)</option>}
            {board.map((column) => <option key={column} value={column}>{column}</option>)}
          </select>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className={`text-[9px] px-1.5 py-0.5 rounded ${PRIORITY_STYLE[task.priority]}`}>{task.priority}</span>
        {task.assignee && (
          <span className="text-[9px] text-white/40 flex items-center gap-0.5"><User size={8} />{task.assignee}</span>
        )}
        {task.due && (
          <span className={`text-[9px] flex items-center gap-0.5 ${overdue ? 'text-red-400' : days <= 2 ? 'text-amber-400' : 'text-white/30'}`}>
            <Calendar size={8} />{formatDue(task.due)}{overdue ? ' · overdue' : ''}
          </span>
        )}
        {subtaskCount > 0 && (
          <span className="text-[9px] text-white/30">{subtaskCount} subtask{subtaskCount === 1 ? '' : 's'}</span>
        )}
        {checklist.total > 0 && (
          <span className="text-[9px] text-white/30 flex items-center gap-0.5">
            <ListChecks size={8} />{checklist.done}/{checklist.total}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Board ──────────────────────────────────────────────────────────────────

export default function BoardView() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  // `api` is `window.api`, stable for the life of the window, so hoisting it to
  // a module const keeps it out of the dependency arrays below.
  const loadProjects = useCallback(async () => {
    try {
      const list = await api.projectsList();
      setProjects(Array.isArray(list) ? list : []);
      // Keep the current selection if it still exists; otherwise fall to the first.
      setProjectId((current) => (list.some((p: ProjectRecord) => p.id === current) ? current : list[0]?.id ?? ''));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadBoard = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setTasks([]);
      return;
    }
    try {
      const board = await api.projectsBoard({ projectId });
      setProject(board?.project ?? null);
      setTasks(Array.isArray(board?.tasks) ? board.tasks : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadBoard(); }, [loadBoard]);

  // Memoised so it keeps a stable identity — `board` feeds the byColumn and
  // totals memos, and a fresh array each render would invalidate both.
  const board = useMemo(() => project?.board ?? [], [project]);
  const finalColumn = board[board.length - 1] ?? '';

  const byColumn = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const column of board) map.set(column, []);
    for (const task of tasks) {
      // A card whose column is not on the board still gets its own column, so it
      // is visible and explainable rather than silently missing.
      if (!map.has(task.status)) map.set(task.status, []);
      map.get(task.status)!.push(task);
    }
    return map;
  }, [tasks, board]);

  const totals = useMemo(() => {
    let overdue = 0;
    let done = 0;
    for (const task of tasks) {
      if (isOverdue(task, finalColumn)) overdue++;
      if (task.status === finalColumn) done++;
    }
    return { overdue, done, total: tasks.length };
  }, [tasks, finalColumn]);

  const addTask = async (column: string) => {
    const title = newTitle.trim();
    if (!title || !projectId) return;
    try {
      await api.projectsCreateTask({ projectId, title, status: column });
      setNewTitle('');
      setAddingTo(null);
      await loadBoard();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const moveTask = async (taskId: string, status: string) => {
    const previous = tasks;
    // Move locally first so the card lands under the cursor immediately; the
    // store call then confirms or the board is reloaded to tell the truth.
    setTasks((current) => current.map((t) => (t.id === taskId ? { ...t, status } : t)));
    try {
      await api.projectsUpdateTask({ id: taskId, updates: { status } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTasks(previous);
      await loadBoard();
    }
  };

  const createProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      // Projects and Board share one record. A project created here appears in
      // Projects as soon as it has a folder; until then it is board-only, which
      // is honest rather than pretending files exist.
      const created = await api.projectsCreate({ name });
      setNewProjectName('');
      setShowNewProject(false);
      await loadProjects();
      if (created?.id) setProjectId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /**
   * Give the current project a folder on disk.
   *
   * This is what links the two sections: a project becomes visible in Projects
   * once it has a `path`, and files are scaffolded the same way Projects does it,
   * so there is one project with both a board and a folder rather than two
   * half-projects.
   */
  const addFolder = async () => {
    if (!project) return;
    setBusy(true);
    try {
      const path = (await window.api.pickDirectory()) as string | null;
      if (!path) return;
      await api.projectsUpdate({ id: project.id, updates: { path } });
      await loadProjects();
      setNote(`${project.name} now has a folder, so it shows in Projects too.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f] text-white">
      <div className="flex-shrink-0 flex items-center justify-between gap-3 p-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-semibold shrink-0">Board</h1>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="appearance-none bg-white/5 border border-white/10 rounded-lg pl-3 pr-7 py-1.5 text-xs text-white outline-none"
            >
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" />
          </div>
          {project && (
            <div className="flex items-center gap-3 text-[11px] text-white/40 shrink-0">
              <span>{totals.total} task{totals.total === 1 ? '' : 's'}</span>
              <span className="text-emerald-400/70">{totals.done} in “{finalColumn}”</span>
              {totals.overdue > 0 && <span className="text-red-400">{totals.overdue} overdue</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project && !project.path && (
            // Explains the relationship between the two sections rather than
            // leaving the user to wonder why their project is not in Projects.
            <button
              onClick={() => void addFolder()}
              disabled={busy}
              title="Give this project a folder so it also appears in Projects"
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <FolderPlus size={12} />
              Add folder
            </button>
          )}
          {project?.path && (
            <span className="text-[10px] text-white/30 truncate max-w-[200px]" title={project.path}>
              in Projects
            </span>
          )}
          <button
            onClick={() => { setShowNewProject(true); setNote(''); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white/70 hover:bg-white/10 shrink-0"
          >
            <Plus size={12} /> New project
          </button>
        </div>
      </div>

      {note && <div className="px-4 py-1.5 text-[11px] text-emerald-300/80">{note}</div>}

      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-300">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={13} /></button>
        </div>
      )}

      {showNewProject && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
          <input
            autoFocus
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createProject(); }}
            placeholder="Project name"
            className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none"
          />
          <button onClick={() => void createProject()} className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs">Create</button>
          <button onClick={() => setShowNewProject(false)} className="px-2 py-1.5 text-xs text-white/50">Cancel</button>
        </div>
      )}

      {projects.length === 0 && !showNewProject ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <p className="text-sm text-white/50">No projects yet.</p>
          <p className="text-xs text-white/30 max-w-sm">
            A project holds a board of columns and the tasks on it. You can make one here, or just ask
            the agent — “start a project called Website Redesign” — and it will appear on this board.
          </p>
          <button onClick={() => setShowNewProject(true)} className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs">
            <Plus size={12} /> New project
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 p-4 h-full min-w-max">
            {[...byColumn.entries()].map(([column, columnTasks]) => (
              <div
                key={column}
                onDragOver={(e) => { e.preventDefault(); setDropTarget(column); }}
                onDragLeave={() => setDropTarget((c) => (c === column ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  const id = e.dataTransfer.getData('text/plain');
                  if (id) void moveTask(id, column);
                }}
                className={`w-64 flex flex-col rounded-xl border transition-colors ${dropTarget === column ? 'border-indigo-500/50 bg-indigo-500/[0.06]' : 'border-white/5 bg-[#14141a]'}`}
              >
                <div className="flex items-center justify-between px-3 py-2 shrink-0">
                  <span className="text-xs font-medium text-white/60">{column}</span>
                  <span className="text-[10px] text-white/30">{columnTasks.length}</span>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5 min-h-[40px]">
                  {columnTasks.map((task) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', task.id)}
                    >
                      <Card
                        task={task}
                        board={board}
                        finalColumn={finalColumn}
                        subtaskCount={task.subtasks?.length ?? 0}
                        checklist={{
                          done: task.checklist.filter((c) => c.done).length,
                          total: task.checklist.length,
                        }}
                        onOpen={() => setSelectedId(task.id)}
                        onMove={(status) => void moveTask(task.id, status)}
                      />
                    </div>
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="text-[10px] text-white/20 text-center py-3">Empty</div>
                  )}
                </div>

                <div className="shrink-0 p-2">
                  {addingTo === column ? (
                    <div className="space-y-1.5">
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void addTask(column);
                          if (e.key === 'Escape') { setAddingTo(null); setNewTitle(''); }
                        }}
                        placeholder="Task title"
                        className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none"
                      />
                      <div className="flex gap-1.5">
                        <button onClick={() => void addTask(column)} className="flex-1 px-2 py-1 rounded-lg bg-indigo-500 text-white text-[10px]">Add</button>
                        <button onClick={() => { setAddingTo(null); setNewTitle(''); }} className="px-2 py-1 rounded-lg text-[10px] text-white/50">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setAddingTo(column); setNewTitle(''); }}
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-white/30 hover:bg-white/5 hover:text-white/60"
                    >
                      <Plus size={11} /> Add task
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <TaskDetail
          task={selected}
          board={board}
          subtasks={selected.subtasks ?? []}
          onClose={() => setSelectedId(null)}
          onChanged={() => void loadBoard()}
        />
      )}
    </div>
  );
}