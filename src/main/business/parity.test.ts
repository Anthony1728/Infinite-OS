import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * The user and the AI must be able to do the same things to the same records.
 *
 * This is the invariant the Business section kept breaking, in both directions:
 *
 *   - Leads were a full record type the agent could create, list and move
 *     through its pipeline, while the UI loaded the list and never rendered it.
 *     A lead the AI created was invisible to the person who owned the business.
 *   - `updateContact`, `deleteContact` and `getAnalytics` were wired into the
 *     view and never called, so a mistyped email could only be fixed by
 *     deleting the contact and retyping it.
 *   - A deal, invoice or lead could be created and listed but never deleted
 *     from anywhere, so a cancelled job could only be hidden by setting its
 *     status — which then counted it as a lost deal, or as money still owed.
 *
 * These are static checks on the source rather than rendered-DOM checks. They
 * hold without a browser, and they fail loudly the moment an action is added to
 * one side and not the other, which is exactly how these gaps appeared.
 */

const home = mkdtempSync(join(tmpdir(), 'business-parity-'));
process.env.INFINITE_TEST_HOME = home;

const { BusinessOS } = await import('./crm.js');

const here = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  resolve(here, '../../renderer/components/views/BusinessOSView.tsx'),
  'utf8',
);
const toolSource = readFileSync(resolve(here, '../tools/business.ts'), 'utf8');
const preloadSource = readFileSync(resolve(here, '../../preload/index.ts'), 'utf8');

function reset() {
  rmSync(join(home, 'business'), { recursive: true, force: true });
  mkdirSync(join(home, 'business'), { recursive: true });
}

/** Names the Business section declares in state and renders. */
function viewRenders(record: string): boolean {
  // A record type the view loads but never maps out is not visible.
  return new RegExp(`\\b${record}\\b\\s*\\.map\\(`).test(viewSource)
    || new RegExp(`filtered${record[0].toUpperCase()}${record.slice(1)}`).test(viewSource);
}

describe('every record type the AI can operate, the user can see', () => {
  for (const record of ['contacts', 'leads', 'deals', 'invoices', 'tasks', 'emails']) {
    it(`the Business section renders ${record}`, () => {
      expect(viewRenders(record)).toBe(true);
    });
  }

  it('leads are shown on a tab of their own, not buried elsewhere', () => {
    expect(viewSource).toMatch(/\{ id: 'leads', label: 'Leads' \}/);
  });

  it('leads can be created from the UI, not only by the agent', () => {
    expect(viewSource).toContain('businessCreateLead');
    expect(viewSource).toMatch(/const addLead\s*=/);
  });

  it('a lead can be moved through its pipeline from the UI', () => {
    expect(viewSource).toContain('businessUpdateLeadStatus');
    expect(viewSource).toMatch(/const moveLead\s*=/);
  });
});

describe('every action the agent can take, the user can take too', () => {
  it('a contact can be edited and deleted from the UI', () => {
    // Both IPC calls existed and were never called from anywhere.
    expect(viewSource).toMatch(/const editContact\s*=/);
    expect(viewSource).toMatch(/const deleteContact\s*=/);
    expect(viewSource).toContain('api.updateContact(');
    expect(viewSource).toContain('api.deleteContact(');
  });

  it('a deal, an invoice and a lead can each be deleted from the UI', () => {
    expect(viewSource).toContain('businessDeleteDeal');
    expect(viewSource).toContain('businessDeleteInvoice');
    expect(viewSource).toContain('businessDeleteLead');
  });

  it('a task can be deleted and edited, not just ticked off', () => {
    expect(viewSource).toContain('businessDeleteTask');
    expect(viewSource).toMatch(/const editTask\s*=/);
  });

  it('a contact note can be added, which the agent can also do', () => {
    expect(viewSource).toContain('businessAddNote');
  });

  it('what needs attention is shown in the UI, not only answered by the agent', () => {
    expect(viewSource).toContain('businessAttention');
  });

  it('the history is shown in the UI, not only readable by the agent', () => {
    expect(viewSource).toContain('businessActivities');
  });

  it('a contact shows what is connected to it', () => {
    expect(viewSource).toContain('businessContactDetail');
  });
});

describe('every action the user can take, the agent can take too', () => {
  it('the agent can delete a lead, an invoice and a deal', () => {
    for (const action of ['delete_lead', 'delete_invoice', 'delete_deal']) {
      expect(toolSource).toContain(`'${action}'`);
      expect(toolSource).toContain(`case '${action}'`);
    }
  });

  it('the agent can read and remove the correspondence log the UI writes', () => {
    // The UI could list and delete emails; the agent could not. An agent that
    // cannot see the correspondence log cannot answer "what did we tell them".
    expect(toolSource).toContain("'list_emails'");
    expect(toolSource).toContain("'delete_email'");
  });

  it('the agent can change a contact\'s tags', () => {
    // Tags could be set at creation and never changed afterwards.
    expect(toolSource).toMatch(/case 'update_contact'[\s\S]{0,900}?updates\.tags/);
  });
});

describe('both sides go through the same store', () => {
  it('every IPC channel the view uses is exposed by the preload bridge', () => {
    // The view calling window.api.businessX that the bridge does not define is
    // a runtime crash the moment that path is taken.
    const used = new Set(
      [...viewSource.matchAll(/window\.api\.(business[A-Za-z]+)/g)].map(m => m[1]),
    );
    expect(used.size).toBeGreaterThan(10);
    for (const fn of used) {
      expect(preloadSource, `preload is missing ${fn}`).toContain(`${fn}:`);
    }
  });

  it('no Business IPC call in the view is dead code', () => {
    // Every api shim must be used. `updateContact` and `deleteContact` were
    // declared, wired, and never called, which is how a whole feature can look
    // present and be unreachable.
    const shims = [...viewSource.matchAll(/^\s{2}(\w+):\s*\(\)\s*=>\s*window\.api\.\w+/gm)].map(m => m[1]);
    expect(shims.length).toBeGreaterThan(5);
    for (const name of shims) {
      const uses = [...viewSource.matchAll(new RegExp(`\\bapi\\.${name}\\s*\\(`, 'g'))].length;
      expect(uses, `api.${name} is declared but never called`).toBeGreaterThan(0);
    }
  });
});

describe('the store keeps the history the UI shows', () => {
  beforeEach(reset);

  it('records both sides into the same timeline', () => {
    const crm = new BusinessOS();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    crm.addNote('Called them', contact.id, 'Acme');
    // An agent action is labelled, so the user can tell what the AI did.
    crm.logSentEmail({ from: 'me', to: 'a@acme.test', subject: 'Hi', body: 'Hello' });

    const activity = new BusinessOS().listActivities();
    expect(activity.some(a => a.type === 'note')).toBe(true);
    const sent = activity.find(a => a.type === 'email');
    expect(sent?.actor).toBe('agent');
  });

  it('deleting an invoice stops it being chased', () => {
    const crm = new BusinessOS();
    const contact = crm.createContact({ name: 'Acme', email: 'a@acme.test' });
    // Marked overdue rather than merely sent: a new invoice is due in 30 days,
    // so "sent" on its own is not yet late.
    const invoice = crm.createInvoice({ contactId: contact.id, items: [{ description: 'W', qty: 1, rate: 100 }] });
    crm.updateInvoiceStatus(invoice.id, 'overdue');
    expect(crm.attentionNeeded().length).toBe(1);

    crm.deleteInvoice(invoice.id);
    expect(new BusinessOS().attentionNeeded()).toEqual([]);
  });
});