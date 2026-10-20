import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Projects and Board must be ONE thing.
 *
 * They were built separately and kept separate data: Projects a JSON array in
 * renderer localStorage, Board a file in the profile home. Creating a project in
 * one produced nothing in the other, so the app appeared to have two competing
 * project sections. These tests pin the shared record so that cannot regress.
 */

const home = mkdtempSync(join(tmpdir(), 'projects-sync-'));
process.env.INFINITE_TEST_HOME = home;

const store = await import('./store.js');

describe('one project record behind both sections', () => {
  beforeEach(() => {
    store.save({ projects: [], tasks: [] });
  });

  it('shows a project in Projects the moment it has a folder', () => {
    // The rule the two sections agree on: `path` is what makes a project a
    // "file project", so that is exactly what Projects lists.
    const boardOnly = store.createProject({ name: 'Ideas' });
    expect(store.listFileProjects()).toHaveLength(0);

    const withFolder = store.createProject({ name: 'Website', path: 'C:\\work\\website' });
    expect(store.listFileProjects().map((p) => p.id)).toEqual([withFolder.id]);
    void boardOnly;
  });

  it('lists every project on the board, folders or not', () => {
    store.createProject({ name: 'Ideas' });
    store.createProject({ name: 'Website', path: 'C:\\work\\website' });
    expect(store.listProjects()).toHaveLength(2);
  });

  it('carries the folder, kind and description across both sections', () => {
    const created = store.createProject({
      name: 'Website',
      description: 'Rebuild the marketing site',
      kind: 'business',
      path: 'C:\\work\\website',
    });
    expect(created.path).toBe('C:\\work\\website');
    expect(created.kind).toBe('business');
    expect(created.description).toBe('Rebuild the marketing site');
    expect(created.status).toBe('active');
  });

  it('propagates an edit made in either section', () => {
    // Projects renames or closes a project; Board must show the same thing.
    const project = store.createProject({ name: 'Old name', path: 'C:\\work\\x' });
    const updated = store.updateProject(project.id, { name: 'New name', status: 'closed' });
    expect(store.isError(updated)).toBe(false);
    if (store.isError(updated)) return;
    expect(updated.name).toBe('New name');
    expect(updated.status).toBe('closed');
    expect(store.getProject(project.id)?.name).toBe('New name');
    // And it is still one folder project, not two.
    expect(store.listFileProjects()).toHaveLength(1);
  });

  it('attaches a folder later, which is how a Board project reaches Projects', () => {
    const project = store.createProject({ name: 'Started on the board' });
    expect(store.listFileProjects()).toHaveLength(0);
    store.updateProject(project.id, { path: 'C:\\work\\later' });
    expect(store.listFileProjects().map((p) => p.name)).toEqual(['Started on the board']);
  });

  it('refuses to blank a board, which would leave a project undisplayable', () => {
    const project = store.createProject({ name: 'Has columns' });
    const before = store.getProject(project.id)?.board.length ?? 0;
    store.updateProject(project.id, { board: [] });
    store.updateProject(project.id, { board: ['  ', ''] });
    // An empty board has no columns to show or drag between, so it is ignored.
    expect(store.getProject(project.id)?.board.length).toBe(before);
  });

  it('removes the tasks when a project is deleted, rather than orphaning them', () => {
    const project = store.createProject({ name: 'Doomed', path: 'C:\\x' });
    const task = store.createTask({ projectId: project.id, title: 'Something' });
    if (store.isError(task)) throw new Error('setup failed');
    expect(store.listTasks({ projectId: project.id })).toHaveLength(1);

    store.deleteProject(project.id);
    // A task whose project is gone cannot be shown anywhere and is silently lost
    // work, so it goes with the project.
    expect(store.listTasks({ projectId: project.id })).toHaveLength(0);
    expect(store.getProject(project.id)).toBeUndefined();
    expect(store.listFileProjects()).toHaveLength(0);
  });

  it('reports a missing project instead of silently doing nothing', () => {
    const result = store.updateProject('does-not-exist', { name: 'x' });
    expect(store.isError(result)).toBe(true);
  });
});

describe('older records still work', () => {
  it('treats a project with no path as board-only rather than failing', () => {
    // A board created before `path` existed must still open.
    store.save({
      projects: [{ id: 'legacy', workspace: 'Personal', name: 'Old', description: '', board: ['Todo', 'Done'], createdAt: 1 }],
      tasks: [],
    });
    expect(store.listProjects()).toHaveLength(1);
    expect(store.listFileProjects()).toHaveLength(0);
    expect(store.getProject('legacy')?.status).toBeUndefined();
  });
});