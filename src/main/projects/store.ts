// The project/task store behind the `Project` tool.
//
// This data has always been real — projects with configurable Kanban columns,
// tasks with subtasks, priorities, assignees, due dates, sprints, milestones,
// checklists and comments, all persisted under <home>/projects. The problem was
// that it lived entirely inside `tools/project.ts` as module-private functions,
// so the only way to see or change a board was to ask the agent in chat. There
// was no board for the person using the app.
//
// Extracted here so the tool and the board UI share ONE implementation. When the
// logic lived in the tool, every UI feature would have needed a copy, and the two
// copies would drift — which is how the rest of the business layer ended up
// disagreeing with itself.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskComment {
  text: string;
  at: number;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  parentId?: string;
  title: string;
  description: string;
  status: string;
  priority: Priority;
  assignee?: string;
  due?: string;
  sprint?: string;
  milestone?: string;
  checklist: ChecklistItem[];
  comments: TaskComment[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRecord {
  id: string;
  workspace: string;
  name: string;
  description: string;
  /** Kanban column names, in order. Editable per project — Monday lets each board differ. */
  board: string[];
  createdAt: number;
  /**
   * Where the project's files live on disk.
   *
   * This is what makes Projects and Board ONE thing rather than two that look
   * alike. Projects scaffolds a folder; Board tracks the work. Before these
   * shared a record, creating a project in one produced nothing in the other, so
   * the app appeared to have two competing project sections.
   */
  path?: string;
  /** Projects' category (business, software, research, …). Carried so one record serves both views. */
  kind?: string;
  status?: 'active' | 'closed';
  updatedAt?: number;
}

export interface Store {
  projects: ProjectRecord[];
  tasks: ProjectTask[];
}

/** Used when a project is created without being told what its columns are. */
export const DEFAULT_BOARD = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done'];

const dir = join(infiniteHome(), 'projects');
const file = join(dir, 'project-management.json');

export function load(): Store {
  try {
    if (!existsSync(file)) return { projects: [], tasks: [] };
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return { projects: [], tasks: [] };
    const record = parsed as Partial<Store>;
    // Tolerate a partial or older file: a board that is missing a field should
    // still open, not throw and take the whole list down with it.
    return {
      projects: Array.isArray(record.projects) ? record.projects : [],
      tasks: Array.isArray(record.tasks) ? record.tasks : [],
    };
  } catch {
    return { projects: [], tasks: [] };
  }
}

export function save(store: Store): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2));
}

/** Run a read-modify-write in one step, so concurrent calls cannot clobber. */
function mutate<T>(fn: (store: Store) => T): T {
  const store = load();
  const result = fn(store);
  save(store);
  return result;
}

export function createProject(input: {
  name: string;
  workspace?: string;
  description?: string;
  board?: string[];
  /** Folder on disk, when this project also has files. */
  path?: string;
  kind?: string;
}): ProjectRecord {
  return mutate((store) => {
    const project: ProjectRecord = {
      id: randomUUID(),
      workspace: input.workspace ?? 'Personal',
      name: input.name,
      description: input.description ?? '',
      // An empty or missing board would render as a board with no columns and
      // no way to drag anything, so fall back rather than store nothing.
      board: input.board?.filter((column) => typeof column === 'string' && column.trim()) as string[] ?? DEFAULT_BOARD,
      ...(input.path ? { path: input.path } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    if (project.board.length === 0) project.board = [...DEFAULT_BOARD];
    store.projects.push(project);
    return project;
  });
}

/**
 * Edit a project's metadata. Backs the shared record so both sections see the
 * same change without one having to know the other exists.
 */
export function updateProject(
  id: string,
  updates: Partial<Pick<ProjectRecord, 'name' | 'description' | 'board' | 'status' | 'kind' | 'workspace' | 'path'>>,
): ProjectRecord | { error: string } {
  return mutate((store) => {
    const project = store.projects.find((p) => p.id === id);
    if (!project) return { error: 'Project not found.' };
    if (updates.name !== undefined) project.name = updates.name;
    if (updates.description !== undefined) project.description = updates.description;
    if (updates.kind !== undefined) project.kind = updates.kind;
    if (updates.workspace !== undefined) project.workspace = updates.workspace;
    if (updates.path !== undefined) project.path = updates.path;
    if (updates.status !== undefined) project.status = updates.status;
    if (updates.board !== undefined) {
      const columns = updates.board.filter((column) => typeof column === 'string' && column.trim());
      // An empty board would leave the project with nothing to show or drag to.
      project.board = columns.length > 0 ? columns : project.board;
    }
    project.updatedAt = Date.now();
    return project;
  });
}

export function deleteProject(id: string): boolean {
  return mutate((store) => {
    const project = store.projects.find((p) => p.id === id);
    if (!project) return false;
    store.projects = store.projects.filter((p) => p.id !== id);
    // Tasks are removed too: a task whose project no longer exists cannot be
    // displayed anywhere, and leaving them behind silently loses the user's work.
    store.tasks = store.tasks.filter((t) => t.projectId !== id);
    return true;
  });
}

/** Projects that have files on disk — what the Projects section lists. */
export function listFileProjects(): ProjectRecord[] {
  return load()
    .projects.filter((p) => Boolean(p.path))
    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
}

export function listProjects(workspace?: string): ProjectRecord[] {
  const store = load();
  return workspace ? store.projects.filter((p) => p.workspace === workspace) : store.projects;
}

export function getProject(id: string): ProjectRecord | undefined {
  return load().projects.find((p) => p.id === id);
}

export function createTask(input: {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: Priority;
  assignee?: string;
  due?: string;
  sprint?: string;
  milestone?: string;
  parentId?: string;
}): ProjectTask | { error: string } {
  return mutate((store) => {
    const project = store.projects.find((p) => p.id === input.projectId);
    if (!project) return { error: 'Project not found.' };
    if (input.parentId && !store.tasks.some((t) => t.id === input.parentId)) {
      return { error: 'Parent task not found.' };
    }
    const task: ProjectTask = {
      id: randomUUID(),
      projectId: input.projectId,
      parentId: input.parentId,
      title: input.title,
      description: input.description ?? '',
      // A task on a board must start in one of that board's columns, or it is
      // invisible on the board and looks lost.
      status: input.status && project.board.includes(input.status) ? input.status : project.board[0] ?? DEFAULT_BOARD[0],
      priority: input.priority ?? 'normal',
      assignee: input.assignee,
      due: input.due,
      sprint: input.sprint,
      milestone: input.milestone,
      checklist: [],
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.tasks.push(task);
    return task;
  });
}

export function listTasks(filter: { projectId?: string; status?: string; assignee?: string } = {}): ProjectTask[] {
  const store = load();
  return store.tasks.filter((task) => {
    if (filter.projectId && task.projectId !== filter.projectId) return false;
    if (filter.status && task.status !== filter.status) return false;
    if (filter.assignee && task.assignee !== filter.assignee) return false;
    return true;
  });
}

export function getTask(id: string): ProjectTask | undefined {
  return load().tasks.find((t) => t.id === id);
}

/** Top-level tasks only — subtasks are shown inside their parent. */
export function listTopLevelTasks(projectId: string): ProjectTask[] {
  return listTasks({ projectId }).filter((task) => !task.parentId);
}

export function subtasksOf(taskId: string): ProjectTask[] {
  return listTasks().filter((task) => task.parentId === taskId);
}

export function updateTask(id: string, updates: Partial<Omit<ProjectTask, 'id' | 'createdAt'>>): ProjectTask | { error: string } {
  return mutate((store) => {
    const task = store.tasks.find((t) => t.id === id);
    if (!task) return { error: 'Task not found.' };

    // Moving to a column the board does not have would make the card vanish.
    if (updates.status !== undefined) {
      const project = store.projects.find((p) => p.id === task.projectId);
      const columns = project?.board ?? DEFAULT_BOARD;
      if (!columns.includes(updates.status)) {
        return { error: `"${updates.status}" is not a column on this board.` };
      }
      task.status = updates.status;
    }
    if (updates.title !== undefined) task.title = updates.title;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.assignee !== undefined) task.assignee = updates.assignee;
    if (updates.due !== undefined) task.due = updates.due;
    if (updates.sprint !== undefined) task.sprint = updates.sprint;
    if (updates.milestone !== undefined) task.milestone = updates.milestone;
    task.updatedAt = Date.now();
    return task;
  });
}

export function addChecklistItem(taskId: string, text: string): ProjectTask | { error: string } {
  return mutate((store) => {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return { error: 'Task not found.' };
    task.checklist.push({ text, done: false });
    task.updatedAt = Date.now();
    return task;
  });
}

export function toggleChecklistItem(taskId: string, index: number): ProjectTask | { error: string } {
  return mutate((store) => {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return { error: 'Task not found.' };
    const item = task.checklist[index];
    if (!item) return { error: 'Checklist item not found.' };
    item.done = !item.done;
    task.updatedAt = Date.now();
    return task;
  });
}

export function addComment(taskId: string, text: string): ProjectTask | { error: string } {
  return mutate((store) => {
    const task = store.tasks.find((t) => t.id === taskId);
    if (!task) return { error: 'Task not found.' };
    task.comments.push({ text, at: Date.now() });
    task.updatedAt = Date.now();
    return task;
  });
}

export function deleteTask(id: string): boolean {
  return mutate((store) => {
    // Remove subtasks with their parent, or they are orphaned and invisible.
    for (let i = store.tasks.length - 1; i >= 0; i--) {
      if (store.tasks[i].id === id || store.tasks[i].parentId === id) store.tasks.splice(i, 1);
    }
    return true;
  });
}

function tally(items: ProjectTask[], key: 'status' | 'priority'): Record<string, number> {
  return items.reduce<Record<string, number>>((out, item) => {
    out[item[key]] = (out[item[key]] ?? 0) + 1;
    return out;
  }, {});
}

export function analytics(projectId?: string) {
  const store = load();
  const tasks = projectId ? store.tasks.filter((t) => t.projectId === projectId) : store.tasks;
  const now = Date.now();
  return {
    projects: store.projects.length,
    tasks: tasks.length,
    byStatus: tally(tasks, 'status'),
    byPriority: tally(tasks, 'priority'),
    // "Overdue" means a due date in the past on a task not in the board's
    // final column. Comparing against a hard-coded 'Done' string would mark
    // every task on a board whose last column is called "Shipped".
    overdue: tasks.filter((t) => {
      if (!t.due) return false;
      const due = Date.parse(t.due);
      if (!Number.isFinite(due) || due >= now) return false;
      const project = store.projects.find((p) => p.id === t.projectId);
      const columns = project?.board ?? DEFAULT_BOARD;
      return t.status !== columns[columns.length - 1];
    }).length,
  };
}

/** Narrow a `{ error }` result so callers can branch without casting everywhere. */
export function isError<T>(value: T | { error: string }): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}