import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The agent operating the business.
 *
 * The motivating bug: business tasks lived only in the renderer's `useState`, so
 * they were never written to disk. They vanished on every reload and the agent
 * could not see or change them — meaning a business whose task list the user had
 * to re-type each morning, and which the assistant could not answer questions
 * about.
 */

const home = mkdtempSync(join(tmpdir(), 'business-agent-'));
process.env.INFINITE_TEST_HOME = home;
mkdirSync(join(home, 'business'), { recursive: true });

const { BusinessOS } = await import('./crm.js');

function fresh() {
  const crm = new BusinessOS();
  return crm;
}

describe('tasks survive a reload', () => {
  beforeEach(async () => {
    rmSync(join(home, 'business'), { recursive: true, force: true });
    mkdirSync(join(home, 'business'), { recursive: true });
  });

  it('writes a task to disk and reads it back in a new instance', async () => {
    const crm = fresh();
    crm.createTask({ title: 'Chase the Acme invoice', assignee: 'Sam', priority: 'high' });

    // A new instance is what happens after a reload — and after the tool is
    // called from a different code path.
    const reloaded = fresh();
    const tasks = reloaded.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Chase the Acme invoice');
    expect(tasks[0].assignee).toBe('Sam');
    expect(tasks[0].priority).toBe('high');
  });

  it('updates and deletes, and the change is what is read back', () => {
    const crm = fresh();
    const task = crm.createTask({ title: 'Do the thing' });

    crm.updateTask(task.id, { status: 'done', assignee: 'Alex' });
    const reloaded = fresh().getTask(task.id);
    expect(reloaded?.status).toBe('done');
    expect(reloaded?.assignee).toBe('Alex');

    fresh().deleteTask(task.id);
    expect(fresh().listTasks()).toHaveLength(0);
  });

  it('reports a missing task rather than silently succeeding', () => {
    expect(fresh().updateTask('nope', { status: 'done' })).toBeNull();
  });

  it('knows what is overdue, and does not count finished tasks', () => {
    const crm = fresh();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    crm.createTask({ title: 'Late', dueDate: yesterday });
    crm.createTask({ title: 'Soon', dueDate: tomorrow });
    const done = crm.createTask({ title: 'Late but done', dueDate: yesterday });
    crm.updateTask(done.id, { status: 'done' });
    crm.createTask({ title: 'No deadline' });

    const overdue = crm.overdueTasks();
    expect(overdue.map((t) => t.title)).toEqual(['Late']);
  });
});

describe('the overview answers how the business is doing', () => {
  beforeEach(() => {
    // A write flushes the store, which is what gives each case a clean start.
    fresh().createContact({ name: 'Seed', email: 'seed@test' });
    fresh().deleteContact(fresh().listContacts()[0].id);
  });

  it('counts from real records, not estimates', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme Ltd', email: 'hi@acme.test' });
    crm.createDeal({ title: 'Website rebuild', contactId: contact.id, value: 5000 });
    crm.createTask({ title: 'Send the proposal' });

    const overview = crm.overview();
    expect(overview.contacts).toBeGreaterThanOrEqual(1);
    expect(overview.openDeals).toBeGreaterThanOrEqual(1);
    expect(overview.tasks.total).toBeGreaterThanOrEqual(1);
    expect(overview.tasks.open).toBeGreaterThanOrEqual(1);
    // Revenue is only what has actually been paid.
    expect(overview.revenue).toBe(0);
  });

  it('adds up what is genuinely owed, not every invoice', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Buyer', email: 'b@x.test' });
    crm.createInvoice({ contactId: contact.id, items: [{ description: 'Work', qty: 1, rate: 400 }] });
    const paid = crm.createInvoice({ contactId: contact.id, items: [{ description: 'Work', qty: 1, rate: 100 }] });
    crm.updateInvoiceStatus(paid.id, 'paid');

    const overview = crm.overview();
    // The draft is not money owed yet; the paid one is not outstanding either.
    expect(overview.invoices.paid).toBe(1);
    expect(overview.invoices.outstanding).toBe(0);
  });
});

describe('search finds things without knowing where they live', () => {
  it('looks across every record type at once', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme Corporation', email: 'buy@acme.test' });
    crm.createDeal({ title: 'Acme renewal', contactId: contact.id, value: 1000 });
    crm.createTask({ title: 'Call Acme about the renewal' });

    const found = crm.search('acme');
    expect(found.contacts.length).toBeGreaterThanOrEqual(1);
    expect(found.deals.length).toBeGreaterThanOrEqual(1);
    expect(found.tasks.length).toBeGreaterThanOrEqual(1);
  });

  it('returns nothing for an empty query rather than everything', () => {
    // An empty search matching all records would be a surprising, expensive answer.
    const result = fresh().search('   ');
    expect(result.contacts).toEqual([]);
    expect(result.deals).toEqual([]);
  });

  it('is case-insensitive', () => {
    const crm = fresh();
    crm.createContact({ name: 'Globex', email: 'g@x.test' });
    expect(crm.search('globex').contacts).toHaveLength(1);
    expect(crm.search('GLOBEX').contacts).toHaveLength(1);
  });
});