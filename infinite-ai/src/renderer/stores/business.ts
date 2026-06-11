import { create } from 'zustand';

export interface Contact {
  id: string; name: string; email: string; phone?: string; company?: string;
  role?: string; tags: string[]; createdAt: number;
}

export interface Lead {
  id: string; name: string; email: string; status: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  value: number; source?: string; notes?: string; createdAt: number;
}

export interface Invoice {
  id: string; number: string; contactId: string; contactName: string; amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  items: { description: string; amount: number }[];
  dueDate?: number; createdAt: number;
}

export interface Deal {
  id: string; name: string; contactId: string; contactName: string; value: number;
  stage: 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  probability: number; expectedCloseDate?: number; createdAt: number;
}

export interface BusinessAnalytics {
  totalRevenue: number; totalDeals: number; activeLeads: number;
  conversionRate: number; avgDealSize: number;
}

export interface BusinessStats {
  contacts: number; leads: number; invoices: number; deals: number;
}

interface BusinessState {
  contacts: Contact[]; leads: Lead[]; invoices: Invoice[]; deals: Deal[];
  analytics: BusinessAnalytics | null; stats: BusinessStats | null; loading: boolean;
  loadContacts: () => Promise<void>; loadLeads: () => Promise<void>;
  loadInvoices: () => Promise<void>; loadDeals: () => Promise<void>;
  loadAnalytics: () => Promise<void>; loadStats: () => Promise<void>;
  createContact: (c: Omit<Contact, 'id' | 'createdAt'>) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;
  createLead: (l: Omit<Lead, 'id' | 'createdAt'>) => Promise<void>;
  createInvoice: (i: Omit<Invoice, 'id' | 'createdAt'>) => Promise<void>;
  createDeal: (d: Omit<Deal, 'id' | 'createdAt'>) => Promise<void>;
  updateDealStage: (id: string, stage: Deal['stage']) => Promise<void>;
}

export const useBusinessStore = create<BusinessState>((set, get) => ({
  contacts: [], leads: [], invoices: [], deals: [],
  analytics: null, stats: null, loading: false,
  loadContacts: async () => { try { set({ contacts: await window.api.businessListContacts() as Contact[] }); } catch {} },
  loadLeads: async () => { try { set({ leads: await window.api.businessListLeads() as Lead[] }); } catch {} },
  loadInvoices: async () => { try { set({ invoices: await window.api.businessListInvoices() as Invoice[] }); } catch {} },
  loadDeals: async () => { try { set({ deals: await window.api.businessListDeals() as Deal[] }); } catch {} },
  loadAnalytics: async () => { try { set({ analytics: await window.api.businessAnalytics() as BusinessAnalytics }); } catch {} },
  loadStats: async () => { try { set({ stats: await window.api.businessStats() as BusinessStats }); } catch {} },
  createContact: async (c) => { await window.api.businessCreateContact(c); await get().loadContacts(); await get().loadStats(); },
  deleteContact: async (id) => { await window.api.businessDeleteContact({ id }); await get().loadContacts(); },
  createLead: async (l) => { await window.api.businessCreateLead(l); await get().loadLeads(); await get().loadStats(); },
  createInvoice: async (i) => { await window.api.businessCreateInvoice(i); await get().loadInvoices(); await get().loadStats(); },
  createDeal: async (d) => { await window.api.businessCreateDeal(d); await get().loadDeals(); await get().loadStats(); },
  updateDealStage: async (id, stage) => { await window.api.businessUpdateDealStage({ id, stage }); await get().loadDeals(); await get().loadAnalytics(); },
}));
