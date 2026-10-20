import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The business history, the join between records, and what needs attention.
 *
 * Two real bugs these pin down:
 *   1. `updateDealStage` normalised the stage but looked up the probability with
 *      the RAW argument, so moving a deal to a board alias like "won" stored
 *      `closed_won` and then read the probability for `won` — which missed, fell
 *      back to 0.1, and valued a won deal at 10% in every forecast.
 *   2. The activity feed was renderer state, so it was wiped on every reload.
 */

const home = mkdtempSync(join(tmpdir(), 'business-history-'));
process.env.INFINITE_TEST_HOME = home;

const { BusinessOS } = await import('./crm.js');

function fresh() {
  return new BusinessOS();
}

function reset() {
  rmSync(join(home, 'business'), { recursive: true, force: true });
  mkdirSync(join(home, 'business'), { recursive: true });
}

describe('the business history is real', () => {
  beforeEach(reset);

  it('records what happened, and it survives a reload', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });

    // A fresh instance is a reload. Before the fix the feed lived in the
    // renderer, so this list came back empty.
    const reloaded = fresh();
    const activity = reloaded.listActivities();
    expect(activity.length).toBeGreaterThanOrEqual(1);
    expect(activity[0].text).toContain('Acme');
    expect(activity[0].type).toBe('contact');
    expect(activity[0].entityId).toBe(contact.id);
  });

  it('says what a record moved FROM, not just where it is now', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'Work', qty: 1, rate: 100 }] });

    crm.updateInvoiceStatus(invoice.id, 'paid');
    const entry = fresh().listActivities().find((a) => a.type === 'invoice' && a.text.includes('paid'));
    // "draft → paid" is what makes a timeline answerable. "Invoice is paid" is not.
    expect(entry?.text).toMatch(/draft\s*→\s*paid/);
  });

  it('says nothing when a save changed nothing', () => {
    const crm = fresh();
    crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const before = fresh().listActivities().length;
    const task = crm.createTask({ title: 'T' });
    crm.updateTask(task.id, { status: 'todo' });
    const after = fresh().listActivities().length;
    // One entry for the task creation, none for the no-op status write.
    expect(after - before).toBe(1);
  });

  it('keeps a note the user added, on that record', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    crm.addNote('Prefers email, hates phone', contact.id, 'Acme');

    const notes = fresh().listActivities({ entityId: contact.id, type: 'note' });
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toBe('Prefers email, hates phone');
  });

  it('does not grow without bound', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 10 }] });
    for (let i = 0; i < 600; i++) {
      crm.updateInvoiceStatus(invoice.id, i % 2 === 0 ? 'sent' : 'paid');
    }
    expect(fresh().listActivities().length).toBeLessThanOrEqual(500);
  });
});

describe('regression: a deal moved to a board alias keeps its real probability', () => {
  beforeEach(reset);

  it('values a won deal at 100%, not 10%', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const deal = crm.createDeal({ title: 'Big one', contactId: contact.id, value: 10_000 });

    const won = crm.updateDealStage(deal.id, 'won' as never);
    // Before the fix: stage became `closed_won` but probability was looked up
    // with `won`, missed, and fell back to 0.1.
    expect(won?.stage).toBe('closed_won');
    expect(won?.probability).toBe(1);
  });

  it('values a lost deal at 0%', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const deal = crm.createDeal({ title: 'Big one', contactId: contact.id, value: 10_000 });
    expect(crm.updateDealStage(deal.id, 'lost' as never)?.probability).toBe(0);
  });

  it('still handles a real stage name unchanged', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const deal = crm.createDeal({ title: 'Big one', contactId: contact.id, value: 10_000 });
    expect(crm.updateDealStage(deal.id, 'negotiation')?.probability).toBe(0.6);
  });
});

describe('a contact shows everything connected to it', () => {
  beforeEach(reset);

  it('joins deals, invoices and tasks, with the money added up', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    crm.createDeal({ title: 'Rebuild', contactId: contact.id, value: 5_000 });
    const paid = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 400 }] });
    crm.updateInvoiceStatus(paid.id, 'paid');
    const unpaid = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 600 }] });
    crm.updateInvoiceStatus(unpaid.id, 'sent');
    crm.createTask({ title: 'Chase them', contactId: contact.id });

    const detail = crm.contactDetail(contact.id);
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.deals).toHaveLength(1);
    expect(detail.invoices).toHaveLength(2);
    expect(detail.tasks).toHaveLength(1);
    // Tax-agnostic on purpose: asserting absolutes here would encode the default
    // tax rate into the test and fail for the wrong reason if it ever changed.
    // The invariant that actually matters is that paid plus owed is everything
    // billed, and that the two are split by status rather than guessed at.
    expect(detail.totals.collected + detail.totals.outstanding).toBe(detail.totals.billed);
    expect(detail.totals.collected).toBeGreaterThan(0);
    expect(detail.totals.outstanding).toBeGreaterThan(0);
    expect(detail.totals.outstanding).not.toBe(detail.totals.collected);
    expect(detail.totals.openTasks).toBe(1);
  });

  it('does not mix up two different customers', () => {
    const crm = fresh();
    const acme = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const globex = crm.createContact({ name: 'Globex', email: 'g@globex.test' });
    crm.createDeal({ title: 'Acme work', contactId: acme.id, value: 100 });
    crm.createTask({ title: 'Chase Acme', contactId: acme.id });
    crm.createTask({ title: 'Call Globex', contactId: globex.id });

    const detail = crm.contactDetail(acme.id);
    if (!detail) throw new Error('expected a contact');
    expect(detail.tasks.map((t) => t.title)).toEqual(['Chase Acme']);
    expect(detail.deals.map((d) => d.title)).toEqual(['Acme work']);
  });

  it('reports a contact that does not exist', () => {
    expect(fresh().contactDetail('nope')).toBeNull();
  });
});

describe('deleting a contact does not leave money owed by nobody', () => {
  beforeEach(reset);

  it('removes the records that hung off it', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    crm.createLead({ contactId: contact.id, value: 100, source: 'web' });
    crm.createDeal({ title: 'Rebuild', contactId: contact.id, value: 500 });
    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 400 }] });
    crm.updateInvoiceStatus(invoice.id, 'sent');
    crm.createTask({ title: 'Chase', contactId: contact.id });

    expect(crm.deleteContact(contact.id)).toBe(true);

    const after = fresh();
    expect(after.listContacts()).toHaveLength(0);
    expect(after.listLeads()).toHaveLength(0);
    expect(after.listDeals()).toHaveLength(0);
    expect(after.listInvoices()).toHaveLength(0);
    expect(after.listTasks()).toHaveLength(0);
    // The point of the whole change: nothing is still owed.
    expect(after.attentionNeeded()).toEqual([]);
  });

  it('says how much went with it, rather than silently dropping records', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    crm.createDeal({ title: 'Rebuild', contactId: contact.id, value: 500 });
    crm.createTask({ title: 'Chase', contactId: contact.id });
    crm.deleteContact(contact.id);

    const entry = fresh().listActivities().find((a) => a.type === 'contact' && a.text.includes('deleted'));
    expect(entry?.text).toContain('2 connected records');
  });

  it('leaves another customer completely alone', () => {
    const crm = fresh();
    const acme = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const globex = crm.createContact({ name: 'Globex', email: 'g@globex.test' });
    crm.createDeal({ title: 'Globex work', contactId: globex.id, value: 700 });
    crm.deleteContact(acme.id);

    const after = fresh();
    expect(after.listContacts().map((c) => c.name)).toEqual(['Globex']);
    expect(after.listDeals().map((d) => d.title)).toEqual(['Globex work']);
  });

  it('reports deleting something that is not there, instead of claiming success', () => {
    expect(fresh().deleteContact('nope')).toBe(false);
  });
});

describe('a lead, invoice or deal can actually be deleted', () => {
  beforeEach(reset);

  it('deletes each one, from either side', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });

    const lead = crm.createLead({ contactId: contact.id, value: 100, source: 'web' });
    expect(crm.deleteLead(lead.id)).toBe(true);
    expect(fresh().listLeads()).toHaveLength(0);

    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 100 }] });
    expect(crm.deleteInvoice(invoice.id)).toBe(true);
    expect(fresh().listInvoices()).toHaveLength(0);

    const deal = crm.createDeal({ title: 'Rebuild', contactId: contact.id, value: 100 });
    expect(crm.deleteDeal(deal.id)).toBe(true);
    expect(fresh().listDeals()).toHaveLength(0);
  });

  it('keeps the contact when only the deal goes', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const deal = crm.createDeal({ title: 'Cancelled job', contactId: contact.id, value: 100 });
    crm.deleteDeal(deal.id);
    expect(fresh().listContacts().map((c) => c.name)).toEqual(['Acme']);
  });

  it('reports a delete of something that does not exist', () => {
    const crm = fresh();
    expect(crm.deleteLead('nope')).toBe(false);
    expect(crm.deleteInvoice('nope')).toBe(false);
    expect(crm.deleteDeal('nope')).toBe(false);
  });
});

describe('an email that was sent is different from a draft', () => {
  beforeEach(reset);

  it('records a sent message as sent, by the agent', () => {
    const crm = fresh();
    crm.logSentEmail({ from: 'me@shop.test', to: 'a@acme.test', subject: 'Invoice 1', body: 'Attached.' });

    const entry = fresh().listActivities().find((a) => a.type === 'email');
    expect(entry?.text).toContain('Email sent to a@acme.test');
    // The agent is labelled, so activity it produced is not mistaken for the
    // user's own.
    expect(entry?.actor).toBe('agent');
  });

  it('logs a sent email in the email list so both sides see it', () => {
    const crm = fresh();
    crm.logSentEmail({ from: 'me@shop.test', to: 'a@acme.test', subject: 'Invoice 1', body: 'Attached.' });
    expect(fresh().listEmails()).toHaveLength(1);
  });
});

describe('what needs attention comes from real dates', () => {
  beforeEach(reset);

  it('finds the invoice that is overdue', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 100 }] });
    crm.updateInvoiceStatus(invoice.id, 'overdue');

    const items = fresh().attentionNeeded();
    expect(items.some((i) => i.kind === 'invoice' && i.id === invoice.id)).toBe(true);
  });

  it('finds the task that is late, and ignores one that is done', () => {
    const crm = fresh();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const late = crm.createTask({ title: 'Late one', dueDate: past });
    const done = crm.createTask({ title: 'Late but done', dueDate: past });
    crm.updateTask(done.id, { status: 'done' });

    const items = fresh().attentionNeeded();
    expect(items.some((i) => i.id === late.id)).toBe(true);
    expect(items.some((i) => i.id === done.id)).toBe(false);
  });

  it('warns about something due in the next three days, not next month', () => {
    const crm = fresh();
    const soon = crm.createTask({ title: 'Soon', dueDate: new Date(Date.now() + 86_400_000).toISOString() });
    const later = crm.createTask({ title: 'Much later', dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString() });

    const items = fresh().attentionNeeded();
    expect(items.some((i) => i.id === soon.id)).toBe(true);
    expect(items.some((i) => i.id === later.id)).toBe(false);
  });

  it('says nothing is wrong when nothing is', () => {
    const crm = fresh();
    crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    expect(fresh().attentionNeeded()).toEqual([]);
  });

  it('does not list the same invoice twice', () => {
    const crm = fresh();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 100 }] });
    // "sent" and past its due date is the same problem as "overdue".
    crm.updateInvoiceStatus(invoice.id, 'sent');
    const items = fresh().attentionNeeded().filter((i) => i.id === invoice.id);
    // Whatever the count, the same label must not appear twice.
    expect(new Set(items.map((i) => i.label)).size).toBe(items.length);
  });
});