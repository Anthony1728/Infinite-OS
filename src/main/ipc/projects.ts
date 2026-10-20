// Project board IPC.
//
// The board data was previously reachable only by asking the agent in chat,
// because the storage lived inside the tool. These handlers expose the same
// shared store (`main/projects/store.ts`) that the tool uses, so a card dragged
// on the Board and a task created by the agent are the same record.

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import * as store from '../projects/store.js';

/** Turn a `{ error }` result into a thrown channel error, so the renderer sees a rejection. */
function unwrap<T>(value: T | { error: string }): T {
  if (store.isError(value)) throw new Error(value.error);
  return value;
}

export function registerProjectIpc(): void {
  ipcMain.handle(IPC.PROJECTS_LIST, async (_e, args?: { workspace?: string }) =>
    store.listProjects(args?.workspace),
  );

  ipcMain.handle(IPC.PROJECTS_CREATE, async (_e, args: { name: string; workspace?: string; description?: string; board?: string[]; path?: string; kind?: string }) =>
    store.createProject(args),
  );

  // Projects and Board are ONE record, so editing it here must be visible in
  // both places. Without this the two sections drift apart and the app looks
  // like it has two competing project systems.
  ipcMain.handle(IPC.PROJECTS_UPDATE, async (_e, args: { id: string; updates: Parameters<typeof store.updateProject>[1] }) =>
    unwrap(store.updateProject(args.id, args.updates)),
  );

  ipcMain.handle(IPC.PROJECTS_DELETE, async (_e, args: { id: string }) => store.deleteProject(args.id));

  /** Projects that have files on disk — what the Projects section lists. */
  ipcMain.handle(IPC.PROJECTS_WITH_FILES, async () => store.listFileProjects());

  /**
   * A whole board in one call — the project, its columns, and its top-level
   * tasks. The renderer would otherwise make three round trips before it could
   * draw anything, and three half-loaded states to handle while they arrive.
   */
  ipcMain.handle(IPC.PROJECTS_BOARD, async (_e, args: { projectId: string }) => {
    const project = store.getProject(args.projectId);
    if (!project) return { project: null, tasks: [] };
    return {
      project,
      // Top-level only; subtasks ride along on each parent so the card can show
      // them without a second request.
      tasks: store.listTopLevelTasks(project.id).map((task) => ({
        ...task,
        subtasks: store.subtasksOf(task.id),
      })),
    };
  });

  ipcMain.handle(IPC.PROJECTS_LIST_ALL, async () => store.listTasks());

  ipcMain.handle(IPC.PROJECTS_CREATE_TASK, async (_e, args: Parameters<typeof store.createTask>[0]) =>
    unwrap(store.createTask(args)),
  );

  ipcMain.handle(IPC.PROJECTS_UPDATE_TASK, async (_e, args: { id: string; updates: Parameters<typeof store.updateTask>[1] }) =>
    unwrap(store.updateTask(args.id, args.updates)),
  );

  ipcMain.handle(IPC.PROJECTS_DELETE_TASK, async (_e, args: { id: string }) => store.deleteTask(args.id));

  ipcMain.handle(IPC.PROJECTS_ADD_CHECKLIST, async (_e, args: { taskId: string; text: string }) =>
    unwrap(store.addChecklistItem(args.taskId, args.text)),
  );

  ipcMain.handle(IPC.PROJECTS_TOGGLE_CHECKLIST, async (_e, args: { taskId: string; index: number }) =>
    unwrap(store.toggleChecklistItem(args.taskId, args.index)),
  );

  ipcMain.handle(IPC.PROJECTS_ADD_COMMENT, async (_e, args: { taskId: string; text: string }) =>
    unwrap(store.addComment(args.taskId, args.text)),
  );

  ipcMain.handle(IPC.PROJECTS_ANALYTICS, async (_e, args?: { projectId?: string }) => store.analytics(args?.projectId));
}