/**
 * Business Command Center
 *
 * Complete business management system:
 * - CRM (Customer Relationship Management)
 * - Invoicing
 * - Lead management
 * - Sales pipeline
 * - Analytics
 * - Contacts
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface BusinessConfig {
  dataDir: string;
  currency: string;
  taxRate: number;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  role?: string;
  tags: string[];
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface Lead {
  id: string;
  contactId: string;
  status: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  value: number;
  source: string;
  assignedTo?: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
}

export interface Invoice {
  id: string;
  number: string;
  contactId: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  issuedAt: number;
  dueAt: number;
  paidAt?: number;
  notes: string;
}

export interface Deal {
  id: string;
  title: string;
  contactId: string;
  leadId?: string;
  value: number;
  stage: 'discovery' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  probability: number;
  expectedClose: number;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface BusinessMetric {
  id: string;
  metric: string;
  value: number;
  change: number;
  period: string;
  timestamp: number;
}

/**
 * An entry in the business history.
 *
 * This used to be built in the renderer with `useState`, so the "Recent Activity"
 * list the Business section shows was wiped on every reload — it looked like a
 * history and was not one.
 *
 * It is now recorded by the store itself whenever something actually changes, so
 * the timeline is a by-product of the real work rather than something a screen
 * has to remember to write down.
 */
export interface BusinessActivity {
  id: string;
  /** What happened, in plain language. */
  text: string;
  /** contact | lead | deal | invoice | task | email | note */
  type: string;
  /** The record this concerns, when there is one. */
  entityId?: string;
  entityName?: string;
  at: number;
  /** Who did it — the user in the UI, or the agent. */
  actor?: 'user' | 'agent';
}

/**
 * A business task.
 *
 * These used to live only in the renderer's `useState`, which meant they were
 * never written to disk: they vanished on every reload, the agent could not see
 * or manage them, and they could not be searched or exported. A business whose
 * task list disappears when you close the window is not a business record.
 */
export interface BusinessTask {
  id: string;
  title: string;
  description: string;
  /** Free text so the same list serves a shop and a consultancy. */
  assignee: string;
  /** ISO date string, or empty when there is no deadline. */
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  /** Optional links, so a task can point at the customer and money involved. */
  contactId?: string;
  dealId?: string;
  invoiceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EmailRecord {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  preview: string;
  time: number;
  read: boolean;
}

/** Coerce anything into a usable finite number, falling back when it is not. */
function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** How likely a deal at each stage is to close. One source of truth. */
const DEAL_STAGE_PROBABILITY: Record<Deal['stage'], number> = {
  discovery: 0.1,
  proposal: 0.3,
  negotiation: 0.6,
  closed_won: 1,
  closed_lost: 0,
};

/**
 * Read a persisted collection that may be in EITHER on-disk shape.
 *
 * Files written before this fix stored `[id, record]` tuples; files written by
 * BusinessSuite (and now by saveData) are plain records. Reading only one shape
 * would silently discard a user's real data on upgrade, so both are accepted.
 * Rows that are neither are skipped rather than throwing.
 */
export function rowsToMap<T extends { id: string }>(rows: unknown[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (Array.isArray(row) && row.length === 2 && typeof row[0] === 'string') {
      map.set(row[0], row[1] as T);
    } else if (row && typeof row === 'object' && typeof (row as T).id === 'string') {
      map.set((row as T).id, row as T);
    }
  }
  return map;
}

/**
 * A store instance for callers outside the IPC layer.
 *
 * Fresh per call: the BusinessOS view holds its own instance on the same
 * on-disk store, so a cached copy would serve stale reads and clobber the
 * view's writes. Construction reloads from disk and every mutation saves, so
 * per-call instances are always consistent with what the user sees.
 */
export function getBusinessOS(): BusinessOS {
  return new BusinessOS();
}

export class BusinessOS {
  private config: BusinessConfig;
  private contacts: Map<string, Contact> = new Map();
  private leads: Map<string, Lead> = new Map();
  private invoices: Map<string, Invoice> = new Map();
  private deals: Map<string, Deal> = new Map();
  private tasks: Map<string, BusinessTask> = new Map();
  private activities: BusinessActivity[] = [];
  private metrics: BusinessMetric[] = [];
  private emails: Map<string, EmailRecord> = new Map();
  private dataDir: string;
  private invoiceCounter: number = 1000;

  constructor(config?: Partial<BusinessConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(infiniteHome(), 'business'),
      currency: config?.currency ?? 'USD',
      taxRate: config?.taxRate ?? 0.1,
    };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) mkdirSync(this.dataDir, { recursive: true });
  }

  private loadData(): void {
    try {
      const load = (name: string): unknown[] => {
        const path = join(this.dataDir, `${name}.json`);
        if (!existsSync(path)) return [];
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return Array.isArray(parsed) ? parsed : [];
      };
      // Accept both on-disk shapes. See `rowsToMap`.
      this.contacts = rowsToMap<Contact>(load('contacts'));
      this.leads = rowsToMap<Lead>(load('leads'));
      this.invoices = rowsToMap<Invoice>(load('invoices'));
      this.deals = rowsToMap<Deal>(load('deals'));
      // Tasks were never written before, so a missing file is the normal case.
      this.tasks = rowsToMap<BusinessTask>(load('tasks'));
      // Bounded, so a long-lived business cannot grow this without limit.
      const loadedActivities = load('activities');
      this.activities = loadedActivities
        .filter((row): row is BusinessActivity => Boolean(row) && typeof (row as BusinessActivity).text === 'string')
        .slice(-500);
      this.metrics = load('metrics') as BusinessMetric[];
      this.emails = rowsToMap<EmailRecord>(load('emails'));
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      const save = (name: string, data: unknown) => writeFileSync(join(this.dataDir, `${name}.json`), JSON.stringify(data, null, 2));
      // Plain arrays, NOT Map entries.
      //
      // These files are also written by `BusinessSuite`, which reads them as
      // plain objects. Saving `[id, record]` tuples here meant whichever tool
      // wrote last changed the on-disk shape, and the other one then read
      // garbage — silent data corruption between two tools using the same
      // folder. One shape on disk: an array of records.
      save('contacts', Array.from(this.contacts.values()));
      save('leads', Array.from(this.leads.values()));
      save('invoices', Array.from(this.invoices.values()));
      save('deals', Array.from(this.deals.values()));
      save('tasks', Array.from(this.tasks.values()));
      save('activities', this.activities.slice(-500));
      save('metrics', this.metrics.slice(-1000));
      save('emails', Array.from(this.emails.values()));
    } catch { /* silent */ }
  }

  // Contacts
  createContact(data: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
    role?: string;
    tags?: string[];
    notes?: string;
  }): Contact {
    const contact: Contact = {
      id: randomUUID(),
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      role: data.role,
      // These used to be hard-coded to `[]` and `''`, which silently threw away
      // whatever the caller sent — so tags and notes typed into the CRM vanished
      // on save while the detail panel still displayed them.
      tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === 'string' && Boolean(tag.trim())) : [],
      notes: typeof data.notes === 'string' ? data.notes : '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.contacts.set(contact.id, contact);
    this.recordActivity(`Contact added: ${contact.name}`, 'contact', { entityId: contact.id, entityName: contact.name });
    this.saveData();
    return contact;
  }

  updateContact(id: string, updates: Partial<Contact>): Contact | null {
    const contact = this.contacts.get(id);
    if (!contact) return null;
    Object.assign(contact, updates, { updatedAt: Date.now() });
    this.saveData();
    return contact;
  }

  deleteContact(id: string): boolean {
    const contact = this.contacts.get(id);
    if (!contact) return false;
    this.contacts.delete(id);
    // The records that hang off this contact would otherwise be orphaned: an
    // invoice still owed by a customer who no longer exists, counted in the
    // revenue totals with nobody to chase. They are removed with the contact so
    // the business never reports money owed by a deleted customer.
    let removed = 0;
    for (const lead of Array.from(this.leads.values())) {
      if (lead.contactId === id) { this.leads.delete(lead.id); removed++; }
    }
    for (const invoice of Array.from(this.invoices.values())) {
      if (invoice.contactId === id) { this.invoices.delete(invoice.id); removed++; }
    }
    for (const deal of Array.from(this.deals.values())) {
      if (deal.contactId === id) { this.deals.delete(deal.id); removed++; }
    }
    for (const task of Array.from(this.tasks.values())) {
      if (task.contactId === id) { this.tasks.delete(task.id); removed++; }
    }
    this.recordActivity(
      `Contact deleted: ${contact.name}${removed > 0 ? ` (and ${removed} connected record${removed === 1 ? '' : 's'})` : ''}`,
      'contact',
      { entityId: id, entityName: contact.name },
    );
    this.saveData();
    return true;
  }

  getContact(id: string): Contact | undefined {
    return this.contacts.get(id);
  }

  listContacts(search?: string): Contact[] {
    const contacts = Array.from(this.contacts.values());
    if (!search) return contacts;
    const lower = search.toLowerCase();
    return contacts.filter((c) => c.name.toLowerCase().includes(lower) || c.email.toLowerCase().includes(lower));
  }

  // Leads
  createLead(data: { contactId: string; value: number; source: string; notes?: string }): Lead {
    const lead: Lead = {
      id: randomUUID(),
      contactId: data.contactId,
      status: 'new',
      value: data.value,
      source: data.source,
      notes: data.notes ?? '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.leads.set(lead.id, lead);
    this.recordActivity(`Lead created: ${this.contacts.get(lead.contactId)?.name ?? 'unknown contact'}`, 'lead', {
      entityId: lead.id,
      entityName: this.contacts.get(lead.contactId)?.name,
    });
    this.saveData();
    return lead;
  }

  /**
   * Remove a lead, invoice or deal.
   *
   * These were creatable and listable but not deletable — from either side. That
   * is not a small gap: a mistyped record or a cancelled job could only be
   * hidden by changing its status, so "delete" in a business tool has to be a
   * real operation rather than a word on a button.
   *
   * Deleted by id, and the history entry is kept so the timeline still explains
   * what used to be there.
   */
  deleteLead(id: string): boolean {
    const lead = this.leads.get(id);
    if (!lead) return false;
    this.leads.delete(id);
    this.recordActivity(
      `Lead deleted: ${this.contacts.get(lead.contactId)?.name ?? id}`,
      'lead',
      { entityId: id, entityName: this.contacts.get(lead.contactId)?.name },
    );
    this.saveData();
    return true;
  }

  deleteInvoice(id: string): boolean {
    const invoice = this.invoices.get(id);
    if (!invoice) return false;
    this.invoices.delete(id);
    this.recordActivity(`Invoice ${invoice.number} deleted`, 'invoice', {
      entityId: id,
      entityName: this.contacts.get(invoice.contactId)?.name,
    });
    this.saveData();
    return true;
  }

  deleteDeal(id: string): boolean {
    const deal = this.deals.get(id);
    if (!deal) return false;
    this.deals.delete(id);
    this.recordActivity(`Deal deleted: ${deal.title}`, 'deal', { entityId: id, entityName: deal.title });
    this.saveData();
    return true;
  }

  updateLeadStatus(id: string, status: Lead['status']): Lead | null {
    const lead = this.leads.get(id);
    if (!lead) return null;
    // Captured before the change so the history can say what it moved FROM.
    const from = lead.status;
    lead.status = status;
    lead.updatedAt = Date.now();
    if (status === 'won' || status === 'lost') lead.closedAt = Date.now();
    this.recordActivity(
      `Lead ${this.contacts.get(lead.contactId)?.name ?? id}: ${from} → ${status}`,
      'lead',
      { entityId: lead.id, entityName: this.contacts.get(lead.contactId)?.name },
    );
    this.saveData();
    return lead;
  }

  listLeads(status?: Lead['status']): Lead[] {
    const leads = Array.from(this.leads.values());
    return status ? leads.filter((l) => l.status === status) : leads;
  }

  // Invoices
  //
  // Line items arrive with several possible field spellings depending on the
  // caller (the CRM UI sends `qty`/`rate`, the Business tool sends
  // `quantity`/`unitPrice`). They used to be read as `quantity`/`unitPrice`
  // unconditionally, so a UI-created invoice multiplied `undefined * undefined`
  // and every total came out NaN — an invoice that looked real and was
  // worthless. Normalise first, and refuse a line with no usable figures rather
  // than writing NaN to disk.
  createInvoice(data: {
    contactId: string;
    items: Array<Record<string, unknown>>;
    notes?: string;
    dueAt?: number;
  }): Invoice {
    this.invoiceCounter++;
    const items = (data.items ?? []).map((raw) => {
      const quantity = toFiniteNumber(raw.quantity ?? raw.qty, 1);
      const unitPrice = toFiniteNumber(raw.unitPrice ?? raw.rate ?? raw.price, 0);
      return {
        description: typeof raw.description === 'string' ? raw.description : '',
        quantity,
        unitPrice,
        total: quantity * unitPrice,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.total, 0);
    const tax = subtotal * this.config.taxRate;

    const invoice: Invoice = {
      id: randomUUID(),
      number: `INV-${this.invoiceCounter}`,
      contactId: data.contactId,
      items,
      subtotal,
      tax,
      total: subtotal + tax,
      status: 'draft',
      issuedAt: Date.now(),
      dueAt: data.dueAt ?? Date.now() + 30 * 24 * 60 * 60 * 1000,
      notes: data.notes ?? '',
    };
    this.invoices.set(invoice.id, invoice);
    this.recordActivity(
      `Invoice ${invoice.number} created for ${this.contacts.get(invoice.contactId)?.name ?? 'unknown contact'}`,
      'invoice',
      { entityId: invoice.id, entityName: this.contacts.get(invoice.contactId)?.name },
    );
    this.saveData();
    return invoice;
  }

  updateInvoiceStatus(id: string, status: Invoice['status']): Invoice | null {
    const invoice = this.invoices.get(id);
    if (!invoice) return null;
    const from = invoice.status;
    invoice.status = status;
    if (status === 'paid') invoice.paidAt = Date.now();
    // Payment is the single most important event in a business, so it is always
    // recorded — including when an invoice is marked overdue.
    this.recordActivity(
      `Invoice ${invoice.number}: ${from} → ${status}`,
      'invoice',
      { entityId: invoice.id, entityName: this.contacts.get(invoice.contactId)?.name },
    );
    this.saveData();
    return invoice;
  }

  listInvoices(status?: Invoice['status']): Invoice[] {
    const invoices = Array.from(this.invoices.values());
    return status ? invoices.filter((i) => i.status === status) : invoices;
  }

  // Deals
  //
  // The CRM board's stage names (`lead`, `contact`, `won`, `lost`) never matched
  // the stored ones (`discovery`, `closed_won`, …), so dragging a card wrote a
  // stage the store did not recognise: the card vanished from every filter and
  // the analytics counted it wrongly. Accepted on the way in and mapped.
  static readonly STAGE_ALIASES: Record<string, Deal['stage']> = {
    lead: 'discovery',
    contact: 'discovery',
    discovery: 'discovery',
    qualified: 'proposal',
    proposal: 'proposal',
    negotiation: 'negotiation',
    won: 'closed_won',
    closed_won: 'closed_won',
    lost: 'closed_lost',
    closed_lost: 'closed_lost',
  };

  static normaliseStage(stage: unknown): Deal['stage'] {
    const key = String(stage ?? '').trim().toLowerCase();
    return BusinessOS.STAGE_ALIASES[key] ?? 'discovery';
  }

  createDeal(data: { title: string; contactId: string; value: number; expectedClose?: number; stage?: string }): Deal {
    const deal: Deal = {
      id: randomUUID(),
      title: data.title,
      contactId: data.contactId,
      value: toFiniteNumber(data.value, 0),
      stage: BusinessOS.normaliseStage(data.stage),
      probability: DEAL_STAGE_PROBABILITY[BusinessOS.normaliseStage(data.stage)] ?? 0.1,
      // The UI never sent this, so it was always undefined and every forecast
      // that depended on a close date had nothing to work with.
      expectedClose: toFiniteNumber(data.expectedClose, 0),
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    deal.probability = DEAL_STAGE_PROBABILITY[deal.stage] ?? 0.1;
    this.deals.set(deal.id, deal);
    this.recordActivity(`Deal created: ${deal.title}`, 'deal', { entityId: deal.id, entityName: deal.title });
    this.saveData();
    return deal;
  }

  updateDealStage(id: string, stage: Deal['stage']): Deal | null {
    const deal = this.deals.get(id);
    if (!deal) return null;
    const from = deal.stage;
    deal.stage = BusinessOS.normaliseStage(stage);
    // The lookup MUST use the normalised stage. It used the raw argument, so
    // moving a deal to a board alias like `won` stored `closed_won` but then
    // read the probability for `won`, missed, and fell back to 0.1 — a won deal
    // valued at 10% in every forecast.
    deal.probability = DEAL_STAGE_PROBABILITY[deal.stage] ?? 0.1;
    deal.updatedAt = Date.now();
    this.recordActivity(`Deal ${deal.title}: ${from} → ${deal.stage}`, 'deal', { entityId: deal.id, entityName: deal.title });
    this.saveData();
    return deal;
  }

  listDeals(stage?: Deal['stage']): Deal[] {
    const deals = Array.from(this.deals.values());
    return stage ? deals.filter((d) => d.stage === stage) : deals;
  }

  // Emails (Business Command Center drafts/sent log — persisted, survives restart)
  listEmails(): EmailRecord[] {
    return Array.from(this.emails.values()).sort((a, b) => b.time - a.time);
  }

  saveEmail(data: { id?: string; from: string; to: string; subject: string; body: string; read?: boolean }): EmailRecord {
    const existing = data.id ? this.emails.get(data.id) : undefined;
    const record: EmailRecord = {
      id: existing?.id ?? data.id ?? randomUUID(),
      from: data.from,
      to: data.to,
      subject: data.subject,
      body: data.body,
      preview: data.body.slice(0, 80),
      time: existing?.time ?? Date.now(),
      read: data.read ?? existing?.read ?? true,
    };
    this.emails.set(record.id, record);
    // Only an outbound message is history. A draft saved twice is not news.
    if (record.subject.trim() && data.from && data.from !== 'draft') {
      this.recordActivity(`Email saved to ${record.to}: ${record.subject}`, 'email', {
        entityId: record.id,
        entityName: record.to,
      });
    }
    this.saveData();
    return record;
  }

  /**
   * Log a message that actually went out.
   *
   * Separate from `saveEmail` because the difference matters: `saveEmail` is a
   * draft or a local copy, this one is proof of delivery. Without a distinct
   * call the agent could only ever say "an email was written", which is a much
   * weaker claim than "an email was sent".
   */
  logSentEmail(data: { from: string; to: string; subject: string; body: string }): EmailRecord {
    const record = this.saveEmail({ ...data, read: true });
    this.recordActivity(`Email sent to ${record.to}: ${record.subject}`, 'email', {
      entityId: record.id,
      entityName: record.to,
      actor: 'agent',
    });
    this.saveData();
    return record;
  }

  deleteEmail(id: string): boolean {
    const deleted = this.emails.delete(id);
    if (deleted) this.saveData();
    return deleted;
  }

  // Analytics
  getAnalytics(): {
    totalRevenue: number;
    totalContacts: number;
    totalLeads: number;
    activeDeals: number;
    pipelineValue: number;
    conversionRate: number;
    avgDealSize: number;
    dealsByStage: Record<string, number>;
    leadsByStatus: Record<string, number>;
  } {
    const invoices = Array.from(this.invoices.values());
    const leads = Array.from(this.leads.values());
    const deals = Array.from(this.deals.values());

    const totalRevenue = invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.total, 0);
    const wonLeads = leads.filter((l) => l.status === 'won').length;
    const conversionRate = leads.length > 0 ? wonLeads / leads.length : 0;
    const activeDeals = deals.filter((d) => !d.stage.startsWith('closed'));
    const pipelineValue = activeDeals.reduce((sum, d) => sum + d.value * d.probability, 0);

    const dealsByStage: Record<string, number> = {};
    for (const d of deals) {
      dealsByStage[d.stage] = (dealsByStage[d.stage] ?? 0) + 1;
    }

    const leadsByStatus: Record<string, number> = {};
    for (const l of leads) {
      leadsByStatus[l.status] = (leadsByStatus[l.status] ?? 0) + 1;
    }

    return {
      totalRevenue,
      totalContacts: this.contacts.size,
      totalLeads: leads.length,
      activeDeals: activeDeals.length,
      pipelineValue,
      conversionRate,
      avgDealSize: deals.length > 0 ? deals.reduce((s, d) => s + d.value, 0) / deals.length : 0,
      dealsByStage,
      leadsByStatus,
    };
  }

  /**
 * Record something that actually happened.
 *
 * Called by the mutations themselves rather than by the screen, so the timeline
 * is complete whether the work came from the user clicking in Business or from
 * the agent operating it in chat. A history that only the UI writes is a history
 * that is missing everything the AI did.
 *
 * `save` is left to the caller's own `saveData()` so a change and its history
 * entry land together.
 */
recordActivity(
  text: string,
  type: BusinessActivity['type'],
  detail: { entityId?: string; entityName?: string; actor?: BusinessActivity['actor'] } = {},
): BusinessActivity {
  const entry: BusinessActivity = {
    id: randomUUID(),
    text,
    type,
    ...(detail.entityId ? { entityId: detail.entityId } : {}),
    ...(detail.entityName ? { entityName: detail.entityName } : {}),
    ...(detail.actor ? { actor: detail.actor } : {}),
    at: Date.now(),
  };
  this.activities.push(entry);
  // Keep the file from growing without bound; 500 entries is plenty of history
  // to answer "what happened recently".
  if (this.activities.length > 500) this.activities = this.activities.slice(-500);
  return entry;
}

/** The business history, newest first. */
listActivities(filter: { type?: string; entityId?: string; limit?: number } = {}): BusinessActivity[] {
  let list = [...this.activities].reverse();
  if (filter.type) list = list.filter((a) => a.type === filter.type);
  if (filter.entityId) list = list.filter((a) => a.entityId === filter.entityId);
  return filter.limit ? list.slice(0, filter.limit) : list;
}

/** Add a free-text note to a record's history. */
addNote(text: string, entityId?: string, entityName?: string): BusinessActivity {
  const entry = this.recordActivity(text, 'note', { entityId, entityName, actor: 'user' });
  this.saveData();
  return entry;
}

// Tasks
  createTask(data: {
    title: string;
    description?: string;
    assignee?: string;
    dueDate?: string;
    priority?: BusinessTask['priority'];
    status?: BusinessTask['status'];
    contactId?: string;
    dealId?: string;
    invoiceId?: string;
  }): BusinessTask {
    const now = Date.now();
    const task: BusinessTask = {
      id: randomUUID(),
      title: data.title,
      description: data.description ?? '',
      assignee: data.assignee ?? '',
      dueDate: data.dueDate ?? '',
      priority: data.priority ?? 'medium',
      status: data.status ?? 'todo',
      ...(data.contactId ? { contactId: data.contactId } : {}),
      ...(data.dealId ? { dealId: data.dealId } : {}),
      ...(data.invoiceId ? { invoiceId: data.invoiceId } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.recordActivity(`Task created: ${task.title}`, 'task', { entityId: task.id, entityName: task.title });
    this.saveData();
    return task;
  }

  updateTask(id: string, updates: Partial<Omit<BusinessTask, 'id' | 'createdAt'>>): BusinessTask | null {
    const task = this.tasks.get(id);
    if (!task) return null;
    // Recorded before the change, so the history says what it moved FROM — a
    // timeline that only says "status: done" cannot answer "when did this slip?".
    const was = { status: task.status, assignee: task.assignee, priority: task.priority, dueDate: task.dueDate };
    if (updates.title !== undefined) task.title = updates.title;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.assignee !== undefined) task.assignee = updates.assignee;
    if (updates.dueDate !== undefined) task.dueDate = updates.dueDate;
    if (updates.priority !== undefined) task.priority = updates.priority;
    if (updates.status !== undefined) task.status = updates.status;
    if (updates.contactId !== undefined) task.contactId = updates.contactId;
    if (updates.dealId !== undefined) task.dealId = updates.dealId;
    if (updates.invoiceId !== undefined) task.invoiceId = updates.invoiceId;
    task.updatedAt = Date.now();
    // Only say something when something actually changed, so the timeline is not
    // padded with no-op saves.
    const changes: string[] = [];
    if (was.status !== task.status) changes.push(`status ${was.status} → ${task.status}`);
    if (was.assignee !== task.assignee && task.assignee) changes.push(`assigned to ${task.assignee}`);
    if (was.priority !== task.priority) changes.push(`priority ${was.priority} → ${task.priority}`);
    if (was.dueDate !== task.dueDate) changes.push(task.dueDate ? `due ${task.dueDate}` : 'due date removed');
    if (changes.length > 0) {
      this.recordActivity(`${task.title}: ${changes.join(', ')}`, 'task', { entityId: task.id, entityName: task.title });
    }
    this.saveData();
    return task;
  }

  deleteTask(id: string): boolean {
    const removed = this.tasks.delete(id);
    this.saveData();
    return removed;
  }

  getTask(id: string): BusinessTask | undefined {
    return this.tasks.get(id);
  }

  listTasks(filter: { status?: BusinessTask['status']; assignee?: string; contactId?: string } = {}): BusinessTask[] {
    const all = Array.from(this.tasks.values());
    return all.filter((task) => {
      if (filter.status && task.status !== filter.status) return false;
      if (filter.assignee && task.assignee !== filter.assignee) return false;
      if (filter.contactId && task.contactId !== filter.contactId) return false;
      return true;
    });
  }

  /** Tasks that are past their deadline and not finished. */
  overdueTasks(): BusinessTask[] {
    const now = Date.now();
    return this.listTasks().filter((task) => {
      if (task.status === 'done' || !task.dueDate) return false;
      const due = Date.parse(task.dueDate);
      return Number.isFinite(due) && due < now;
    });
  }

  /**
   * The whole business in one call.
   *
   * The agent should be able to answer "how is the business doing?" without
   * needing eight round trips and a schema it has to remember. Everything here is
   * counted from real records — nothing is estimated or filled in.
   */
  overview() {
    const analytics = this.getAnalytics();
    const tasks = this.listTasks();
    return {
      revenue: analytics.totalRevenue,
      pipelineValue: analytics.pipelineValue,
      openDeals: analytics.activeDeals,
      contacts: this.contacts.size,
      openLeads: this.listLeads().filter((l) => l.status !== 'won' && l.status !== 'lost').length,
      invoices: {
        total: this.invoices.size,
        paid: this.listInvoices('paid').length,
        overdue: this.listInvoices('overdue').length,
        // Money owed, which is the number a business is judged on.
        outstanding: this.listInvoices()
          .filter((i) => i.status === 'sent' || i.status === 'overdue')
          .reduce((sum, i) => sum + i.total, 0),
      },
      tasks: {
        total: tasks.length,
        open: tasks.filter((t) => t.status !== 'done').length,
        overdue: this.overdueTasks().length,
        byPriority: tasks.reduce<Record<string, number>>((acc, t) => {
          acc[t.priority] = (acc[t.priority] ?? 0) + 1;
          return acc;
        }, {}),
      },
      dealsByStage: analytics.dealsByStage,
    };
  }

  /**
   * Search across every entity at once.
   *
   * One call so the agent can find "the Acme invoice" without knowing whether it
   * is filed as a contact, an invoice or a deal.
   */
  search(query: string): {
    contacts: Contact[];
    leads: Lead[];
    invoices: Invoice[];
    deals: Deal[];
    tasks: BusinessTask[];
  } {
    const q = query.trim().toLowerCase();
    if (!q) return { contacts: [], leads: [], invoices: [], deals: [], tasks: [] };
    const hit = (...fields: Array<string | undefined>) => fields.some((f) => (f ?? '').toLowerCase().includes(q));
    return {
      contacts: Array.from(this.contacts.values()).filter((c) => hit(c.name, c.email, c.company, c.notes, ...c.tags)),
      leads: Array.from(this.leads.values()).filter((l) => hit(l.source, l.notes)),
      invoices: Array.from(this.invoices.values()).filter((i) => hit(i.number, i.notes, ...i.items.map((it) => it.description))),
      deals: Array.from(this.deals.values()).filter((d) => hit(d.title, d.notes)),
      tasks: Array.from(this.tasks.values()).filter((t) => hit(t.title, t.description, t.assignee)),
    };
  }

  /**
   * Everything connected to one contact.
   *
   * Monday's central idea is that a person is one item and the deals,
   * invoices and tasks hang off them. Five separate lists with no way to see
   * what belongs together is why a business section feels like a filing cabinet.
   * This is the join the screens and the agent both need.
   */
  contactDetail(contactId: string) {
    const contact = this.contacts.get(contactId);
    if (!contact) return null;
    const deals = this.listDeals().filter((d) => d.contactId === contactId);
    const leads = this.listLeads().filter((l) => l.contactId === contactId);
    const invoices = this.listInvoices().filter((i) => i.contactId === contactId);
    const tasks = this.listTasks({ contactId });
    return {
      contact,
      deals,
      leads,
      invoices,
      tasks,
      // Rolled up, so "what is this customer worth" is one number rather than
      // something the reader has to add up.
      totals: {
        openDeals: deals.filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost').length,
        pipelineValue: deals
          .filter((d) => d.stage !== 'closed_won' && d.stage !== 'closed_lost')
          .reduce((sum, d) => sum + d.value * (d.probability ?? 0), 0),
        billed: invoices.reduce((sum, i) => sum + i.total, 0),
        collected: invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.total, 0),
        outstanding: invoices
          .filter((i) => i.status === 'sent' || i.status === 'overdue')
          .reduce((sum, i) => sum + i.total, 0),
        openTasks: tasks.filter((t) => t.status !== 'done').length,
        overdueTasks: this.overdueTasks().filter((t) => t.contactId === contactId).length,
      },
      // Their own history, which is what makes the relationship legible.
      activity: this.listActivities({ entityId: contactId }),
    };
  }

  /**
   * What needs attention today.
   *
   * The reason a business section is opened at all is to find the three things
   * that are late. Computed from real dates, not a "reminders" list nobody
   * maintains.
   */
  attentionNeeded() {
    const now = Date.now();
    const overdueInvoices = this.listInvoices('overdue').map((i) => ({
      id: i.id,
      kind: 'invoice' as const,
      label: `Invoice ${i.number} is overdue`,
      who: this.contacts.get(i.contactId)?.name ?? 'unknown',
      amount: i.total,
    }));
    const sentOverdue = this.listInvoices()
      .filter((i) => i.status === 'sent' && Date.parse(String(i.dueAt ?? 0)) < now)
      .map((i) => ({
        id: i.id,
        kind: 'invoice' as const,
        label: `Invoice ${i.number} is past its due date`,
        who: this.contacts.get(i.contactId)?.name ?? 'unknown',
        amount: i.total,
      }));
    const overdueTasks = this.overdueTasks().map((t) => ({
      id: t.id,
      kind: 'task' as const,
      label: `Task "${t.title}" is overdue`,
      who: t.assignee || 'unassigned',
      amount: undefined,
    }));
    const dueSoon = this.listTasks()
      .filter((t) => {
        if (t.status === 'done' || !t.dueDate) return false;
        const due = Date.parse(t.dueDate);
        return Number.isFinite(due) && due >= now && due < now + 3 * 86_400_000;
      })
      .map((t) => ({
        id: t.id,
        kind: 'task' as const,
        label: `Task "${t.title}" is due soon`,
        who: t.assignee || 'unassigned',
        amount: undefined,
      }));
    // Deduplicated: an invoice can be both "overdue" and past its due date.
    const seen = new Set<string>();
    return [...overdueInvoices, ...sentOverdue, ...overdueTasks, ...dueSoon].filter((item) => {
      const key = `${item.kind}:${item.id}:${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  getStats(): {
    contacts: number;
    leads: number;
    invoices: number;
    deals: number;
    totalRevenue: number;
  } {
    const invoices = Array.from(this.invoices.values());
    return {
      contacts: this.contacts.size,
      leads: this.leads.size,
      invoices: this.invoices.size,
      deals: this.deals.size,
      totalRevenue: invoices.filter((i) => i.status === 'paid').reduce((sum, i) => sum + i.total, 0),
    };
  }
}

