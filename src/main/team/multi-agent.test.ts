import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MultiAgentSystem } from './multi-agent.js';

const dirs: string[] = [];

function makeSystem(): { dir: string; system: MultiAgentSystem } {
  const dir = mkdtempSync(join(tmpdir(), 'infinite-multi-agent-'));
  dirs.push(dir);
  return { dir, system: new MultiAgentSystem({ dataDir: dir }) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('MultiAgentSystem org chart', () => {
  it('defaults the first member to manager and the rest to employee', () => {
    const { system } = makeSystem();
    const team = system.createTeam('Product', 'Ship it', ['planner', 'coder', 'tester']);

    expect(team.leader).toBe('planner');
    expect(team.roles).toEqual({ planner: 'manager', coder: 'employee', tester: 'employee' });
    expect(team.agents).toEqual(['planner', 'coder', 'tester']);
  });

  it('respects explicit CEO and manager assignments and keeps one CEO', () => {
    const { system } = makeSystem();
    const team = system.createTeam('Company', '', ['ada', 'grace', 'linus'], {
      roles: { ada: 'ceo', grace: 'manager', linus: 'employee' },
      leader: 'grace',
      mission: 'Build the product',
    });

    expect(team.roles.ada).toBe('ceo');
    expect(team.leader).toBe('grace');
    expect(team.mission).toBe('Build the product');

    system.setAgentRole(team.id, 'linus', 'ceo');
    const after = system.getTeam(team.id)!;
    expect(after.roles.linus).toBe('ceo');
    expect(after.roles.ada).toBe('manager');
  });

  it('promotes a member when the leader is removed', () => {
    const { system } = makeSystem();
    const team = system.createTeam('Ops', '', ['lead', 'worker'], { leader: 'lead' });

    system.setAgentRole(team.id, 'worker', 'manager');
    system.removeAgentFromTeam(team.id, 'lead');

    const after = system.getTeam(team.id)!;
    expect(after.agents).toEqual(['worker']);
    expect(after.leader).toBe('worker');
    expect(after.roles.worker).toBe('manager');
  });

  it('summarizes the org with per-role totals', () => {
    const { system } = makeSystem();
    system.createTeam('Exec', '', ['ada'], { roles: { ada: 'ceo' } });
    system.createTeam('Eng', '', ['grace', 'linus'], { roles: { grace: 'manager', linus: 'employee' } });

    const org = system.getOrg();
    expect(org.teams).toHaveLength(2);
    expect(org.roots).toHaveLength(2);
    expect(org.totals).toEqual({ teams: 2, agents: 3, ceo: 1, manager: 1, employee: 1 });
  });
});

describe('MultiAgentSystem task contract', () => {
  it('accepts renderer-shaped title/description/assignTo input', () => {
    const { system } = makeSystem();
    const team = system.createTeam('Squad', '', ['doer']);
    const task = system.createTask({
      title: 'Write the report',
      description: 'Weekly summary',
      teamId: team.id,
      assignTo: 'doer',
    });

    expect(task.title).toBe('Write the report');
    expect(task.description).toBe('Weekly summary');
    expect(task.type).toBe('Write the report');
    expect(task.assignedTo).toBe('doer');
    expect(task.role).toBe('manager');
    expect(task.status).toBe('pending');
  });

  it('uses in_progress consistently for assigned/started tasks', () => {
    const { system } = makeSystem();
    const task = system.createTask({ title: 'Do work' });

    expect(system.assignTask(task.id, 'agent-1')?.status).toBe('in_progress');
    expect(system.startTask(task.id)?.status).toBe('in_progress');
    expect(system.listTasks('running')).toHaveLength(1);
    expect(system.completeTask(task.id, 'done')?.status).toBe('completed');
    expect(system.getStats()).toMatchObject({
      teams: 0,
      tasks: 1,
      completedTasks: 1,
      inProgressTasks: 0,
      runningTasks: 0,
    });
  });

  it('heals legacy teams/tasks written by the flat schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'infinite-multi-agent-legacy-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'teams.json'), JSON.stringify([
      ['legacy-team', {
        name: 'Legacy',
        description: 'old shape',
        members: ['a', 'b'],
        createdAt: 1,
      }],
    ]));
    writeFileSync(join(dir, 'tasks.json'), JSON.stringify([
      ['legacy-task', {
        type: 'research',
        input: { title: 'Old task', description: 'Old description' },
        assignedTo: 'a',
        status: 'assigned',
        createdAt: 2,
      }],
    ]));

    const system = new MultiAgentSystem({ dataDir: dir });
    const team = system.getTeam('legacy-team')!;
    const task = system.getTask('legacy-task')!;

    expect(team.agents).toEqual(['a', 'b']);
    expect(team.roles).toEqual({ a: 'employee', b: 'employee' });
    expect(task.title).toBe('Old task');
    expect(task.description).toBe('Old description');
    expect(task.status).toBe('in_progress');
  });
});
