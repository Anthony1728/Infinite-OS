import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The CRM had a cluster of silent-corruption bugs that all presented the same
 * way: the UI looked fine and the data was wrong. These tests pin the fixes.
 */

const home = mkdtempSync(join(tmpdir(), 'crm-test-'));
process.env.INFINITE_TEST_HOME = home;

async function freshBusiness() {
  const { BusinessOS } = await import('./crm.js');
  return new BusinessOS();
}

describe('CRM invoices', () => {
  it('accepts the field names the UI actually sends (qty/rate)', async () => {
    const crm = await freshBusiness();
    const invoice = crm.createInvoice({
      contactId: 'c1',
      // This is the exact shape BusinessOSView sends.
      items: [{ description: 'Design', qty: 3, rate: 100 }],
    } as never);

    // Before the fix: quantity * unitPrice = undefined * undefined = NaN.
    expect(Number.isFinite(invoice.subtotal)).toBe(true);
    expect(invoice.subtotal).toBe(300);
    expect(Number.isFinite(invoice.total)).toBe(true);
    expect(invoice.items[0].total).toBe(300);
  });

  it('still accepts the field names the Business tool sends', async () => {
    const crm = await freshBusiness();
    const invoice = crm.createInvoice({
      contactId: 'c1',
      items: [{ description: 'Build', quantity: 2, unitPrice: 50 }],
    });
    expect(invoice.subtotal).toBe(100);
  });

  it('never writes NaN into an invoice, whatever it is handed', async () => {
    const crm = await freshBusiness();
    const invoice = crm.createInvoice({
      contactId: 'c1',
      items: [{ description: 'Broken', qty: 'abc' as never, rate: null as never }],
    } as never);
    expect(Number.isFinite(invoice.subtotal)).toBe(true);
    expect(Number.isFinite(invoice.tax)).toBe(true);
    expect(Number.isFinite(invoice.total)).toBe(true);
  });

  it('handles an empty invoice without producing NaN', async () => {
    const crm = await freshBusiness();
    const invoice = crm.createInvoice({ contactId: 'c1', items: [] });
    expect(invoice.subtotal).toBe(0);
    expect(invoice.total).toBe(0);
  });
});

describe('CRM contacts', () => {
  it('keeps tags and notes instead of discarding them', async () => {
    const crm = await freshBusiness();
    const contact = crm.createContact({
      name: 'Sam',
      email: 'sam@example.com',
      tags: ['vip', 'urgent'],
      notes: 'Prefers email',
    });
    expect(contact.tags).toEqual(['vip', 'urgent']);
    expect(contact.notes).toBe('Prefers email');
  });

  it('tolerates a caller that sends no tags at all', async () => {
    const crm = await freshBusiness();
    const contact = crm.createContact({ name: 'Ann', email: 'ann@example.com' });
    expect(contact.tags).toEqual([]);
    expect(contact.notes).toBe('');
  });
});

describe('CRM deal stages', () => {
  it('maps the board stage names onto the stored ones', async () => {
    const crm = await freshBusiness();
    const deal = crm.createDeal({ title: 'Big', contactId: 'c1', value: 1000 });
    expect(deal.stage).toBe('discovery');

    // Dragging a card to "won" in the CRM used to write stage:'won', which the
    // store did not recognise.
    const won = crm.updateDealStage(deal.id, 'won' as never);
    expect(won?.stage).toBe('closed_won');

    const lost = crm.updateDealStage(deal.id, 'lost' as never);
    expect(lost?.stage).toBe('closed_lost');
  });

  it('keeps a deal visible after it is dragged between columns', async () => {
    const crm = await freshBusiness();
    const deal = crm.createDeal({ title: 'X', contactId: 'c1', value: 500 });
    crm.updateDealStage(deal.id, 'proposal' as never);
    // A stage the store does not know used to hide the deal from every filter.
    expect(crm.listDeals('proposal')).toHaveLength(1);
  });

  it('gives a stored stage the matching probability', async () => {
    const crm = await freshBusiness();
    const deal = crm.createDeal({ title: 'Y', contactId: 'c1', value: 100 });
    expect(deal.probability).toBe(0.1);
    const neg = crm.updateDealStage(deal.id, 'negotiation');
    expect(neg?.probability).toBe(0.6);
  });
});

describe('CRM on-disk shape', () => {
  // The store resolves its directory from `infiniteHome()`, which caches for the
  // process — so these tests share one home and reset the folder between cases.
  beforeEach(() => {
    rmSync(join(home, 'business'), { recursive: true, force: true });
  });

  it('writes plain records, so two tools can share the folder safely', async () => {
    const crm = await freshBusiness();
    crm.createContact({ name: 'Zed', email: 'z@example.com', tags: ['a'] });

    const { BusinessOS } = await import('./crm.js');
    // Point a second instance at the same home and read it back.
    const reloaded = new BusinessOS();
    expect(reloaded.listContacts()).toHaveLength(1);
    expect(reloaded.listContacts()[0].tags).toEqual(['a']);

    // The on-disk file must be an array of objects, not [id, record] tuples.
    const path = join(home, 'business', 'contacts.json');
    expect(existsSync(path)).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    expect(Array.isArray(parsed)).toBe(true);
    expect(Array.isArray(parsed[0])).toBe(false);
    expect(typeof parsed[0].id).toBe('string');
  });

  it('reads legacy [id, record] tuple files instead of losing the data', async () => {
    // `infiniteHome()` caches its directory for the process, so a second home
    // cannot be used mid-file. The parser is exported precisely so the legacy
    // shape can be pinned directly — that is the logic the upgrade depends on.
    const { rowsToMap } = await import('./crm.js');

    const legacy = rowsToMap<{ id: string; name: string; tags: string[] }>([
      ['legacy-1', { id: 'legacy-1', name: 'Legacy', tags: ['old'] }],
    ]);
    expect(legacy.size).toBe(1);
    expect(legacy.get('legacy-1')?.name).toBe('Legacy');
    expect(legacy.get('legacy-1')?.tags).toEqual(['old']);
  });

  it('reads plain records too, so both shapes interoperate', async () => {
    const { rowsToMap } = await import('./crm.js');
    const mixed = rowsToMap<{ id: string; name: string }>([
      ['tuple-1', { id: 'tuple-1', name: 'From tuple' }],
      { id: 'plain-1', name: 'From record' },
    ]);
    expect(mixed.size).toBe(2);
    expect(mixed.get('tuple-1')?.name).toBe('From tuple');
    expect(mixed.get('plain-1')?.name).toBe('From record');
  });

  it('skips rows that are neither shape rather than crashing the whole load', async () => {
    const { rowsToMap } = await import('./crm.js');
    const rows = rowsToMap<{ id: string }>([null, undefined, 'garbage', 42, { noId: true }, ['only-one']]);
    expect(rows.size).toBe(0);
  });
});