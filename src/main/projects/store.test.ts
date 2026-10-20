import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The board's rules.
 *
 * The bug these exist to prevent: a task could be created with any status
 * string, so one that did not match a column name landed somewhere the board
 * never renders. From the user's side the task simply did not exist — it was
 * saved, counted in the store, and visible nowhere.
 */

const dataDir = mkdtempSync(join(tmpdir(), 'projects-store-'));
process.env.INFINITE_TEST_HOME = dataDir;
mkdirSync(join(dataDir, 'projects'), { recursive: true });

async function fresh() {
  const store = await import('./store.js');
  return store;
}

describe('project board rules', () => {
  beforeEach(async () => {
    const store = await fresh();
    store.save({ projects: [], tasks: [] });
  });

  it('creates a project with usable columns', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'Website' });
    expect(project.board.length).toBeGreaterThan(0);
    expect(project.board).toContain('In Progress');
  });

  it('uses the columns the project was given', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'Custom', board: ['Idea', 'Doing', 'Shipped'] });
    expect(project.board).toEqual(['Idea', 'Doing', 'Shipped']);
  });

  it('falls back to defaults rather than creating a board with no columns', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'Empty', board: [] });
    expect(project.board.length).toBeGreaterThan(0);
    const blank = store.createProject({ name: 'Blanks', board: ['', '  '] });
    expect(blank.board.length).toBeGreaterThan(0);
  });

  it('puts a new task in a real column so it is visible on the board', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P', board: ['Todo', 'Doing', 'Done'] });
    const task = store.createTask({ projectId: project.id, title: 'Write the thing' });
    expect(store.isError(task)).toBe(false);
    if (store.isError(task)) return;
    // The old behaviour allowed any string and produced an invisible card.
    expect(project.board).toContain(task.status);
  });

  it('rejects a requested status the board does not have', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P', board: ['Todo', 'Done'] });
    const task = store.createTask({ projectId: project.id, title: 'T', status: 'Nonexistent' });
    // It must land somewhere real rather than disappear.
    expect(store.isError(task)).toBe(false);
    if (store.isError(task)) return;
    expect(project.board).toContain(task.status);
  });

  it('refuses to move a task to a column that does not exist', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P', board: ['Todo', 'Done'] });
    const created = store.createTask({ projectId: project.id, title: 'T' });
    if (store.isError(created)) throw new Error('setup failed');
    const moved = store.updateTask(created.id, { status: 'In Limbo' });
    expect(store.isError(moved)).toBe(true);
    if (!store.isError(moved)) return;
    // And the task must still be where it was — not moved into nowhere.
    expect(store.getTask(created.id)?.status).toBe(created.status);
  });

  it('allows a move to a real column', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P', board: ['Todo', 'Doing', 'Done'] });
    const created = store.createTask({ projectId: project.id, title: 'T' });
    if (store.isError(created)) throw new Error('setup failed');
    const moved = store.updateTask(created.id, { status: 'Doing' });
    expect(store.isError(moved)).toBe(false);
    expect(store.getTask(created.id)?.status).toBe('Doing');
  });

  it('refuses a task for a project that does not exist', async () => {
    const store = await fresh();
    const result = store.createTask({ projectId: 'nope', title: 'Orphan' });
    expect(store.isError(result)).toBe(true);
  });

  it('refuses a subtask whose parent does not exist', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P' });
    const result = store.createTask({ projectId: project.id, title: 'Sub', parentId: 'missing' });
    expect(store.isError(result)).toBe(true);
  });

  it('separates top-level tasks from subtasks', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P' });
    const parent = store.createTask({ projectId: project.id, title: 'Parent' });
    if (store.isError(parent)) throw new Error('setup failed');
    store.createTask({ projectId: project.id, title: 'Child', parentId: parent.id });

    const top = store.listTopLevelTasks(project.id);
    expect(top.map((t) => t.title)).toEqual(['Parent']);
    expect(store.subtasksOf(parent.id).map((t) => t.title)).toEqual(['Child']);
  });

  it('removes subtasks along with their parent, rather than orphaning them', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P' });
    const parent = store.createTask({ projectId: project.id, title: 'Parent' });
    if (store.isError(parent)) throw new Error('setup failed');
    store.createTask({ projectId: project.id, title: 'Child', parentId: parent.id });

    store.deleteTask(parent.id);
    // An orphaned subtask would never be rendered anywhere and never be listed.
    expect(store.listTasks({ projectId: project.id })).toHaveLength(0);
  });
});

describe('checklist and comments', () => {
  beforeEach(async () => {
    const store = await fresh();
    store.save({ projects: [], tasks: [] });
  });

  it('adds and toggles checklist items', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P' });
    const task = store.createTask({ projectId: project.id, title: 'T' });
    if (store.isError(task)) throw new Error('setup failed');

    store.addChecklistItem(task.id, 'step one');
    store.addChecklistItem(task.id, 'step two');
    expect(store.getTask(task.id)?.checklist).toHaveLength(2);
    expect(store.getTask(task.id)?.checklist[0].done).toBe(false);

    store.toggleChecklistItem(task.id, 0);
    expect(store.getTask(task.id)?.checklist[0].done).toBe(true);
  });

  it('reports a bad checklist index instead of silently doing nothing', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P' });
    const task = store.createTask({ projectId: project.id, title: 'T' });
    if (store.isError(task)) throw new Error('setup failed');
    const result = store.toggleChecklistItem(task.id, 99);
    expect(store.isError(result)).toBe(true);
  });

  it('keeps comments with the task', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P' });
    const task = store.createTask({ projectId: project.id, title: 'T' });
    if (store.isError(task)) throw new Error('setup failed');
    store.addComment(task.id, 'looks good');
    expect(store.getTask(task.id)?.comments[0].text).toBe('looks good');
  });
});

describe('analytics count real work', () => {
  beforeEach(async () => {
    const store = await fresh();
    store.save({ projects: [], tasks: [] });
  });

  it('counts overdue against the board own final column', async () => {
    const store = await fresh();
    // A board whose last column is NOT called "Done" — the old check compared
    // against the literal 'Done' and called every task here overdue forever.
    const project = store.createProject({ name: 'P', board: ['Backlog', 'Shipped'] });
    const shipped = store.createTask({ projectId: project.id, title: 'Shipped', status: 'Shipped' });
    if (store.isError(shipped)) throw new Error('setup failed');

    const past = new Date(Date.now() - 86_400_000).toISOString();
    const overdue = store.createTask({ projectId: project.id, title: 'Late', status: 'Backlog', due: past });
    if (store.isError(overdue)) throw new Error('setup failed');

    const result = store.analytics(project.id);
    expect(result.overdue).toBe(1);
    expect(result.byStatus.Shipped).toBe(1);
  });

  it('does not call a future due date overdue', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P', board: ['Todo', 'Done'] });
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    store.createTask({ projectId: project.id, title: 'Later', due: future });
    expect(store.analytics(project.id).overdue).toBe(0);
  });

  it('ignores an unparseable due date rather than counting it', async () => {
    const store = await fresh();
    const project = store.createProject({ name: 'P', board: ['Todo', 'Done'] });
    store.createTask({ projectId: project.id, title: 'Bad date', due: 'not-a-date' });
    expect(store.analytics(project.id).overdue).toBe(0);
  });
});

describe('loading is tolerant of a damaged file', () => {
  it('does not throw on malformed JSON', async () => {
    writeFileSync(join(dataDir, 'projects', 'project-management.json'), '{ this is not json', 'utf8');
    const store = await fresh();
    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual({ projects: [], tasks: [] });
  });

  it('fills in missing collections rather than returning undefined', async () => {
    writeFileSync(join(dataDir, 'projects', 'project-management.json'), '{"projects":[]}', 'utf8');
    const store = await fresh();
    const loaded = store.load();
    expect(loaded.tasks).toEqual([]);
  });
});