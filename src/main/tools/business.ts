import type { Tool, ToolResult } from './base.js';
import { BusinessOS } from '../business/crm.js';

let businessOS: BusinessOS | null = null;

function getBusinessOS(): BusinessOS {
  // Fresh instance per call: the BusinessOS view holds its own singleton on the
  // same on-disk store, so a cached copy here would serve stale reads and
  // clobber the view's writes. Construction reloads from disk; every mutation
  // saves, so per-call instances are always consistent with the UI.
  businessOS = new BusinessOS();
  return businessOS;
}

export const businessTool: Tool = {
  name: 'Business',
  description: 'Manage business operations: contacts, leads, invoices, deals, and analytics. Create/update/delete contacts, manage lead pipeline, generate invoices, track deals, and view business analytics.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'create_contact', 'update_contact', 'delete_contact', 'list_contacts', 'get_contact',
          'create_lead', 'update_lead_status', 'list_leads',
          'create_invoice', 'update_invoice_status', 'list_invoices',
          'create_deal', 'update_deal_stage', 'list_deals',
          'get_analytics', 'get_stats',
        ],
        description: 'Business action to perform',
      },
      id: { type: 'string', description: 'Contact, lead, invoice, or deal ID' },
      name: { type: 'string', description: 'Contact name' },
      email: { type: 'string', description: 'Contact email' },
      phone: { type: 'string', description: 'Contact phone' },
      company: { type: 'string', description: 'Contact company' },
      role: { type: 'string', description: 'Contact role' },
      contactId: { type: 'string', description: 'Contact ID for leads/invoices/deals' },
      value: { type: 'number', description: 'Lead or deal value' },
      source: { type: 'string', description: 'Lead source' },
      notes: { type: 'string', description: 'Notes for contact, lead, invoice, or deal' },
      status: { type: 'string', description: 'Lead status: new, qualified, proposal, negotiation, won, lost' },
      invoiceStatus: { type: 'string', description: 'Invoice status: draft, sent, paid, overdue, cancelled' },
      items: {
        type: 'array',
        description: 'Invoice line items',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            quantity: { type: 'number' },
            unitPrice: { type: 'number' },
          },
        },
      },
      title: { type: 'string', description: 'Deal title' },
      expectedClose: { type: 'number', description: 'Deal expected close timestamp' },
      stage: { type: 'string', description: 'Deal stage: discovery, proposal, negotiation, closed_won, closed_lost' },
      search: { type: 'string', description: 'Search query for contacts' },
      leadStatus: { type: 'string', description: 'Filter leads by status' },
      invoiceFilter: { type: 'string', description: 'Filter invoices by status' },
      dealStage: { type: 'string', description: 'Filter deals by stage' },
    },
    required: ['action'],
  },
  permission: 'allow',

  async execute(args): Promise<ToolResult> {
    const input = args as Record<string, unknown>;
    const bos = getBusinessOS();

    try {
      switch (input.action) {
        case 'create_contact': {
          if (!input.name || !input.email) return bad('create_contact requires name and email.');
          const contact = bos.createContact({
            name: input.name as string,
            email: input.email as string,
            phone: input.phone as string | undefined,
            company: input.company as string | undefined,
            role: input.role as string | undefined,
          });
          return json(contact);
        }
        case 'update_contact': {
          if (!input.id) return bad('update_contact requires id.');
          const updates: Record<string, unknown> = {};
          if (input.name) updates.name = input.name;
          if (input.email) updates.email = input.email;
          if (input.phone) updates.phone = input.phone;
          if (input.company) updates.company = input.company;
          if (input.role) updates.role = input.role;
          if (input.notes) updates.notes = input.notes;
          const updated = bos.updateContact(input.id as string, updates);
          return updated ? json(updated) : bad('Contact not found.');
        }
        case 'delete_contact': {
          if (!input.id) return bad('delete_contact requires id.');
          const deleted = bos.deleteContact(input.id as string);
          return deleted ? ok('Contact deleted.') : bad('Contact not found.');
        }
        case 'list_contacts': {
          const contacts = bos.listContacts(input.search as string | undefined);
          return json(contacts);
        }
        case 'get_contact': {
          if (!input.id) return bad('get_contact requires id.');
          const contact = bos.getContact(input.id as string);
          return contact ? json(contact) : bad('Contact not found.');
        }
        case 'create_lead': {
          if (!input.contactId || input.value == null || !input.source) return bad('create_lead requires contactId, value, and source.');
          const lead = bos.createLead({
            contactId: input.contactId as string,
            value: input.value as number,
            source: input.source as string,
            notes: input.notes as string | undefined,
          });
          return json(lead);
        }
        case 'update_lead_status': {
          if (!input.id || !input.status) return bad('update_lead_status requires id and status.');
          const updated = bos.updateLeadStatus(input.id as string, input.status as 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost');
          return updated ? json(updated) : bad('Lead not found.');
        }
        case 'list_leads': {
          const leads = bos.listLeads(input.leadStatus as 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | undefined);
          return json(leads);
        }
        case 'create_invoice': {
          if (!input.contactId || !input.items) return bad('create_invoice requires contactId and items.');
          const items = (input.items as Array<{ description: string; quantity: number; unitPrice: number }>).map((item) => ({
            ...item,
            total: item.quantity * item.unitPrice,
          }));
          const invoice = bos.createInvoice({
            contactId: input.contactId as string,
            items,
            notes: input.notes as string | undefined,
          });
          return json(invoice);
        }
        case 'update_invoice_status': {
          if (!input.id || !input.invoiceStatus) return bad('update_invoice_status requires id and invoiceStatus.');
          const updated = bos.updateInvoiceStatus(input.id as string, input.invoiceStatus as 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled');
          return updated ? json(updated) : bad('Invoice not found.');
        }
        case 'list_invoices': {
          const invoices = bos.listInvoices(input.invoiceFilter as 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled' | undefined);
          return json(invoices);
        }
        case 'create_deal': {
          if (!input.title || !input.contactId || input.value == null || !input.expectedClose) return bad('create_deal requires title, contactId, value, and expectedClose.');
          const deal = bos.createDeal({
            title: input.title as string,
            contactId: input.contactId as string,
            value: input.value as number,
            expectedClose: input.expectedClose as number,
          });
          return json(deal);
        }
        case 'update_deal_stage': {
          if (!input.id || !input.stage) return bad('update_deal_stage requires id and stage.');
          const updated = bos.updateDealStage(input.id as string, input.stage as 'discovery' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost');
          return updated ? json(updated) : bad('Deal not found.');
        }
        case 'list_deals': {
          const deals = bos.listDeals(input.dealStage as 'discovery' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost' | undefined);
          return json(deals);
        }
        case 'get_analytics': {
          return json(bos.getAnalytics());
        }
        case 'get_stats': {
          return json(bos.getStats());
        }
        default:
          return bad(`Unknown Business action: ${input.action}`);
      }
    } catch (error) {
      return bad(`Business action failed: ${(error as Error).message}`);
    }
  },
};

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}
