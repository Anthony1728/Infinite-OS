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

export class BusinessOS {
  private config: BusinessConfig;
  private contacts: Map<string, Contact> = new Map();
  private leads: Map<string, Lead> = new Map();
  private invoices: Map<string, Invoice> = new Map();
  private deals: Map<string, Deal> = new Map();
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
      const load = (name: string) => {
        const path = join(this.dataDir, `${name}.json`);
        if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
        return [];
      };
      this.contacts = new Map(load('contacts'));
      this.leads = new Map(load('leads'));
      this.invoices = new Map(load('invoices'));
      this.deals = new Map(load('deals'));
      this.metrics = load('metrics');
      this.emails = new Map(load('emails'));
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      const save = (name: string, data: unknown) => writeFileSync(join(this.dataDir, `${name}.json`), JSON.stringify(data, null, 2));
      save('contacts', Array.from(this.contacts.entries()));
      save('leads', Array.from(this.leads.entries()));
      save('invoices', Array.from(this.invoices.entries()));
      save('deals', Array.from(this.deals.entries()));
      save('metrics', this.metrics.slice(-1000));
      save('emails', Array.from(this.emails.entries()));
    } catch { /* silent */ }
  }

  // Contacts
  createContact(data: { name: string; email: string; phone?: string; company?: string; role?: string }): Contact {
    const contact: Contact = {
      id: randomUUID(),
      name: data.name,
      email: data.email,
      phone: data.phone,
      company: data.company,
      role: data.role,
      tags: [],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.contacts.set(contact.id, contact);
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
    const result = this.contacts.delete(id);
    this.saveData();
    return result;
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
    this.saveData();
    return lead;
  }

  updateLeadStatus(id: string, status: Lead['status']): Lead | null {
    const lead = this.leads.get(id);
    if (!lead) return null;
    lead.status = status;
    lead.updatedAt = Date.now();
    if (status === 'won' || status === 'lost') lead.closedAt = Date.now();
    this.saveData();
    return lead;
  }

  listLeads(status?: Lead['status']): Lead[] {
    const leads = Array.from(this.leads.values());
    return status ? leads.filter((l) => l.status === status) : leads;
  }

  // Invoices
  createInvoice(data: { contactId: string; items: Invoice['items']; notes?: string }): Invoice {
    this.invoiceCounter++;
    const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const tax = subtotal * this.config.taxRate;

    const invoice: Invoice = {
      id: randomUUID(),
      number: `INV-${this.invoiceCounter}`,
      contactId: data.contactId,
      items: data.items.map((item) => ({ ...item, total: item.quantity * item.unitPrice })),
      subtotal,
      tax,
      total: subtotal + tax,
      status: 'draft',
      issuedAt: Date.now(),
      dueAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      notes: data.notes ?? '',
    };
    this.invoices.set(invoice.id, invoice);
    this.saveData();
    return invoice;
  }

  updateInvoiceStatus(id: string, status: Invoice['status']): Invoice | null {
    const invoice = this.invoices.get(id);
    if (!invoice) return null;
    invoice.status = status;
    if (status === 'paid') invoice.paidAt = Date.now();
    this.saveData();
    return invoice;
  }

  listInvoices(status?: Invoice['status']): Invoice[] {
    const invoices = Array.from(this.invoices.values());
    return status ? invoices.filter((i) => i.status === status) : invoices;
  }

  // Deals
  createDeal(data: { title: string; contactId: string; value: number; expectedClose: number }): Deal {
    const deal: Deal = {
      id: randomUUID(),
      title: data.title,
      contactId: data.contactId,
      value: data.value,
      stage: 'discovery',
      probability: 0.1,
      expectedClose: data.expectedClose,
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.deals.set(deal.id, deal);
    this.saveData();
    return deal;
  }

  updateDealStage(id: string, stage: Deal['stage']): Deal | null {
    const deal = this.deals.get(id);
    if (!deal) return null;
    deal.stage = stage;
    const probabilities: Record<string, number> = {
      discovery: 0.1, proposal: 0.3, negotiation: 0.6, closed_won: 1, closed_lost: 0,
    };
    deal.probability = probabilities[stage] ?? 0.1;
    deal.updatedAt = Date.now();
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

