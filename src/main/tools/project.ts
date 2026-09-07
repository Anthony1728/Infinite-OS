import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { infiniteHome } from '../profiles/home.js';
import { join } from 'node:path';
import type { Tool, ToolResult } from './base.js';

type Priority = 'low' | 'normal' | 'high' | 'urgent';
interface ProjectTask { id: string; projectId: string; parentId?: string; title: string; description: string; status: string; priority: Priority; assignee?: string; due?: string; sprint?: string; milestone?: string; checklist: Array<{ text: string; done: boolean }>; comments: Array<{ text: string; at: number }>; createdAt: number; updatedAt: number }
interface ProjectRecord { id: string; workspace: string; name: string; description: string; board: string[]; createdAt: number }
interface Store { projects: ProjectRecord[]; tasks: ProjectTask[] }
interface ProjectToolInput {
  action: string;
  project_id?: string;
  parent_id?: string;
  task_id?: string;
  workspace?: string;
  name?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: Priority;
  assignee?: string;
  due?: string;
  sprint?: string;
  milestone?: string;
  text?: string;
  checklist_index: number;
  board?: string[];
}

const dir = join(infiniteHome(), 'projects');
const file = join(dir, 'project-management.json');

export const projectTool: Tool = {
  name: 'Project',
  description: 'Chat-native project management for workspaces, projects, boards/Kanban, tasks, subtasks, priorities, sprints, milestones, checklists, comments, backlogs, roadmaps, and analytics.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create_project', 'list_projects', 'create_task', 'list_tasks', 'update_task', 'add_checklist', 'toggle_checklist', 'comment', 'analytics'] },
      project_id: { type: 'string' }, parent_id: { type: 'string' }, task_id: { type: 'string' }, workspace: { type: 'string' }, name: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, assignee: { type: 'string' }, due: { type: 'string' }, sprint: { type: 'string' }, milestone: { type: 'string' }, text: { type: 'string' }, checklist_index: { type: 'number' }, board: { type: 'array', items: { type: 'string' } },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as ProjectToolInput; const store = load();
    try {
      if (input.action === 'create_project') {
        if (!input.name) return bad('create_project requires name.');
        const project: ProjectRecord = { id: randomUUID(), workspace: input.workspace ?? 'Personal', name: input.name, description: input.description ?? '', board: input.board ?? ['Backlog', 'Todo', 'In Progress', 'Review', 'Done'], createdAt: Date.now() };
        store.projects.push(project); save(store); return json(project);
      }
      if (input.action === 'list_projects') return json(input.workspace ? store.projects.filter((p) => p.workspace === input.workspace) : store.projects);
      if (input.action === 'create_task') {
        if (!input.project_id || !input.title) return bad('create_task requires project_id and title.');
        if (!store.projects.some((p) => p.id === input.project_id)) return bad('Project not found.');
        const task: ProjectTask = { id: randomUUID(), projectId: input.project_id, parentId: input.parent_id, title: input.title, description: input.description ?? '', status: input.status ?? 'Todo', priority: input.priority ?? 'normal', assignee: input.assignee, due: input.due, sprint: input.sprint, milestone: input.milestone, checklist: [], comments: [], createdAt: Date.now(), updatedAt: Date.now() };
        store.tasks.push(task); save(store); return json(task);
      }
      if (input.action === 'list_tasks') return json(store.tasks.filter((task) => (!input.project_id || task.projectId === input.project_id) && (!input.status || task.status === input.status)));
      const task = store.tasks.find((item) => item.id === input.task_id);
      if (input.action !== 'analytics' && !task) return bad('Task not found.');
      if (input.action === 'update_task' && task) {
        if (input.title != null) task.title = input.title;
        if (input.description != null) task.description = input.description;
        if (input.status != null) task.status = input.status;
        if (input.priority != null) task.priority = input.priority;
        if (input.assignee != null) task.assignee = input.assignee;
        if (input.due != null) task.due = input.due;
        if (input.sprint != null) task.sprint = input.sprint;
        if (input.milestone != null) task.milestone = input.milestone;
        task.updatedAt = Date.now(); save(store); return json(task);
      }
      if (input.action === 'add_checklist' && task) { if (!input.text) return bad('text is required.'); task.checklist.push({ text: input.text, done: false }); task.updatedAt = Date.now(); save(store); return json(task); }
      if (input.action === 'toggle_checklist' && task) { const item = task.checklist[input.checklist_index]; if (!item) return bad('Checklist item not found.'); item.done = !item.done; task.updatedAt = Date.now(); save(store); return json(task); }
      if (input.action === 'comment' && task) { if (!input.text) return bad('text is required.'); task.comments.push({ text: input.text, at: Date.now() }); task.updatedAt = Date.now(); save(store); return json(task); }
      if (input.action === 'analytics') {
        const tasks = input.project_id ? store.tasks.filter((item) => item.projectId === input.project_id) : store.tasks;
        return json({ projects: store.projects.length, tasks: tasks.length, byStatus: count(tasks, 'status'), byPriority: count(tasks, 'priority'), overdue: tasks.filter((item) => item.due && new Date(item.due).getTime() < Date.now() && item.status !== 'Done').length });
      }
      return bad(`Unknown Project action: ${input.action}`);
    } catch (error) { return bad((error as Error).message); }
  },
};

function load(): Store { try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { projects: [], tasks: [] }; } catch { return { projects: [], tasks: [] }; } }
function save(store: Store): void { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(store, null, 2)); }
function count(items: ProjectTask[], key: 'status' | 'priority'): Record<string, number> { return items.reduce<Record<string, number>>((out, item) => { out[item[key]] = (out[item[key]] ?? 0) + 1; return out; }, {}); }
function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
