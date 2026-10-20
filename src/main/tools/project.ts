// Project — the agent's chat-native handle on the project/task board.
//
// The storage, validation and rules moved to `../projects/store.js` so the Board
// view and this tool cannot drift apart. This file is now just the tool surface:
// names, arguments, and plain-language results.
//
// Notably, tasks now start in one of the project's own columns and cannot be
// moved to a column that does not exist. Before that, a task could be created
// with any status string and land in a column the board never renders, which is
// what "the task disappeared" always turned out to be.

import type { Tool, ToolResult } from './base.js';
import * as store from '../projects/store.js';

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
  priority?: store.Priority;
  assignee?: string;
  due?: string;
  sprint?: string;
  milestone?: string;
  text?: string;
  checklist_index: number;
  board?: string[];
}

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}

export const projectTool: Tool = {
  name: 'Project',
  description:
    'Project management: workspaces, projects, Kanban boards, tasks, subtasks, priorities, assignees, due dates, sprints, milestones, checklists, and comments. The user can see and edit all of this on the Board view — changes made either way show up in the other place.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'create_project',
          'list_projects',
          'create_task',
          'list_tasks',
          'update_task',
          'add_checklist',
          'toggle_checklist',
          'comment',
          'analytics',
        ],
      },
      project_id: { type: 'string' },
      parent_id: { type: 'string' },
      task_id: { type: 'string' },
      workspace: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      status: { type: 'string', description: "Must be one of the project's board columns." },
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      assignee: { type: 'string' },
      due: { type: 'string' },
      sprint: { type: 'string' },
      milestone: { type: 'string' },
      text: { type: 'string' },
      checklist_index: { type: 'number' },
      board: { type: 'array', items: { type: 'string' }, description: 'Column names, in order.' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as ProjectToolInput;
    try {
      switch (input.action) {
        case 'create_project': {
          if (!input.name) return bad('create_project requires name.');
          return json(store.createProject({
            name: input.name,
            workspace: input.workspace,
            description: input.description,
            board: input.board,
          }));
        }
        case 'list_projects':
          return json(store.listProjects(input.workspace));

        case 'create_task': {
          if (!input.project_id || !input.title) return bad('create_task requires project_id and title.');
          const result = store.createTask({
            projectId: input.project_id,
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            assignee: input.assignee,
            due: input.due,
            sprint: input.sprint,
            milestone: input.milestone,
            parentId: input.parent_id,
          });
          return store.isError(result) ? bad(result.error) : json(result);
        }

        case 'list_tasks':
          return json(store.listTasks({ projectId: input.project_id, status: input.status, assignee: input.assignee }));

        case 'update_task': {
          if (!input.task_id) return bad('update_task requires task_id.');
          const result = store.updateTask(input.task_id, {
            title: input.title,
            description: input.description,
            status: input.status,
            priority: input.priority,
            assignee: input.assignee,
            due: input.due,
            sprint: input.sprint,
            milestone: input.milestone,
          });
          return store.isError(result) ? bad(result.error) : json(result);
        }

        case 'add_checklist': {
          if (!input.task_id || !input.text) return bad('add_checklist requires task_id and text.');
          const result = store.addChecklistItem(input.task_id, input.text);
          return store.isError(result) ? bad(result.error) : json(result);
        }

        case 'toggle_checklist': {
          if (!input.task_id) return bad('toggle_checklist requires task_id.');
          const result = store.toggleChecklistItem(input.task_id, input.checklist_index);
          return store.isError(result) ? bad(result.error) : json(result);
        }

        case 'comment': {
          if (!input.task_id || !input.text) return bad('comment requires task_id and text.');
          const result = store.addComment(input.task_id, input.text);
          return store.isError(result) ? bad(result.error) : json(result);
        }

        case 'analytics':
          return json(store.analytics(input.project_id));

        default:
          return bad(`Unknown Project action: ${input.action}`);
      }
    } catch (error) {
      return bad((error as Error).message);
    }
  },
};