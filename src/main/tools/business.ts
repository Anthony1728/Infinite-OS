import type { Tool, ToolResult } from './base.js';
import { getBusinessOS } from '../business/crm.js';

export const businessTool: Tool = {
  name: 'Business',
  description: [
    'Operate the business: contacts, leads, invoices, deals, tasks and email — the same records the Business section shows.',
    'Start with action=overview for "how is the business doing": it returns revenue, pipeline, open leads, outstanding invoices and open/overdue tasks in one call.',
    'Use action=attention for "what needs doing today" or "what is late" — it is computed from real due dates, so prefer it over reading invoices and tasks separately.',
    'Use action=search to find something without knowing which record holds it, then act on the id it returns.',
    'Use action=contact_detail for everything about one customer at once: their deals, invoices, tasks and what they owe.',
    'Use action=list_activity for "what happened recently" or "what did we do about X"; action=add_note to record something against a record.',
    'Deal stages: discovery, proposal, negotiation, closed_won, closed_lost (won and lost aliases accepted).',
    'Everything here is the real record, so a change you make is immediately what the user sees in Business, and appears in its history.',
  ].join(' '),
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
          // Tasks, which used to exist only in the renderer's memory — the agent
          // could not see them and they were lost on every reload.
          'create_task', 'update_task', 'delete_task', 'list_tasks',
          // One call for "how is the business doing", and one that finds
          // something without knowing which record type holds it.
          'overview', 'search',
          // The business history, and the records that belong together.
          'list_activity', 'add_note', 'contact_detail', 'attention',
          // Deleting. Only contacts and tasks could be deleted before, from the
          // agent's side and the user's alike, so a cancelled job or a mistyped
          // invoice could only be hidden by changing its status.
          'delete_lead', 'delete_invoice', 'delete_deal',
          // The correspondence log the Business section shows. It used to be
          // written only by the user clicking in the UI, so the log omitted
          // everything the agent had sent.
          'list_emails', 'delete_email',
        ],
        description: 'Business action to perform',
      },
      id: { type: 'string', description: 'Contact, lead, invoice, deal, or task ID' },
      name: { type: 'string', description: 'Contact name' },
      email: { type: 'string', description: 'Contact email' },
      phone: { type: 'string', description: 'Contact phone' },
      company: { type: 'string', description: 'Contact company' },
      role: { type: 'string', description: 'Contact role' },
      contactId: { type: 'string', description: 'Contact ID for leads/invoices/deals' },
      value: { type: 'number', description: 'Lead or deal value' },
      source: { type: 'string', description: 'Lead source' },
      notes: { type: 'string', description: 'Notes for contact, lead, invoice, or deal' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Tags for a contact, e.g. ["vip", "wholesale"]. On update_contact this replaces the existing tags.' },
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
      title: { type: 'string', description: 'Deal title, or task title' },
      description: { type: 'string', description: 'Description to set on a record' },
      expectedClose: { type: 'number', description: 'Deal expected close timestamp' },
      stage: { type: 'string', description: 'Deal stage: discovery, proposal, negotiation, closed_won, closed_lost' },
      search: { type: 'string', description: 'Search query — a contact name, or any text, for action=search' },
      leadStatus: { type: 'string', description: 'Filter leads by status' },
      invoiceFilter: { type: 'string', description: 'Filter invoices by status' },
      dealStage: { type: 'string', description: 'Filter deals by stage' },
      assignee: { type: 'string', description: 'Task assignee' },
      dueDate: { type: 'string', description: 'Task due date, ISO (YYYY-MM-DD)' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Task priority' },
      taskStatus: { type: 'string', enum: ['todo', 'in_progress', 'done'], description: 'Task status' },
      entityId: { type: 'string', description: 'A record id, for filtering history or attaching a note' },
      entityName: { type: 'string', description: 'Display name for the record a note is about' },
      activityType: { type: 'string', enum: ['contact', 'lead', 'deal', 'invoice', 'task', 'email', 'note'], description: 'Filter the history by kind of event' },
      limit: { type: 'number', description: 'How many history entries to return' },
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
          // Tags could be set when a contact was created but not changed
          // afterwards, from either side. The user tags contacts to group them
          // ("vip", "wholesale"), and a tag that can only be set once at birth
          // is not a tag.
          if (Array.isArray(input.tags)) {
            updates.tags = (input.tags as unknown[]).map(t => String(t).trim()).filter(Boolean);
          } else if (typeof input.tags === 'string') {
            // Accepts a comma-separated string too, since that is how the tags
            // are entered everywhere else in the UI.
            updates.tags = input.tags.split(',').map(t => t.trim()).filter(Boolean);
          }
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

        // ── Tasks ──────────────────────────────────────────────────────────
        case 'create_task': {
          if (!input.title) return bad('create_task requires title.');
          return json(bos.createTask({
            title: input.title as string,
            description: input.description as string | undefined,
            assignee: input.assignee as string | undefined,
            dueDate: input.dueDate as string | undefined,
            priority: input.priority as 'low' | 'medium' | 'high' | undefined,
            status: input.taskStatus as 'todo' | 'in_progress' | 'done' | undefined,
            contactId: input.contactId as string | undefined,
            dealId: input.id as string | undefined,
            invoiceId: input.invoiceId as string | undefined,
          }));
        }
        case 'update_task': {
          if (!input.id) return bad('update_task requires id.');
          const updates: Record<string, unknown> = {};
          if (input.title !== undefined) updates.title = input.title;
          if (input.description !== undefined) updates.description = input.description;
          if (input.assignee !== undefined) updates.assignee = input.assignee;
          if (input.dueDate !== undefined) updates.dueDate = input.dueDate;
          if (input.priority !== undefined) updates.priority = input.priority;
          if (input.taskStatus !== undefined) updates.status = input.taskStatus;
          const updated = bos.updateTask(input.id as string, updates);
          return updated ? json(updated) : bad('Task not found.');
        }
        case 'delete_task': {
          if (!input.id) return bad('delete_task requires id.');
          return bos.deleteTask(input.id as string) ? ok('Task deleted.') : bad('Task not found.');
        }
        case 'list_tasks': {
          return json(bos.listTasks({
            status: input.taskStatus as 'todo' | 'in_progress' | 'done' | undefined,
            assignee: input.assignee as string | undefined,
            contactId: input.contactId as string | undefined,
          }));
        }

        // ── One call answers "how is the business doing" ───────────────────
        case 'overview': {
          // Every number is counted from real records. Use this first rather than
          // fetching six lists and adding them up.
          return json(bos.overview());
        }
        case 'search': {
          if (!input.search) return bad('search requires a search query.');
          const found = bos.search(input.search as string);
          const total = found.contacts.length + found.leads.length + found.invoices.length + found.deals.length + found.tasks.length;
          if (total === 0) return ok(`Nothing in the business records matches "${input.search}".`);
          return json(found);
        }

        // ── History and relationships ──────────────────────────────────────
        case 'list_activity': {
          // The same timeline the Business section shows, so the agent can answer
          // "what has happened lately" and "what did we do about Acme".
          return json(bos.listActivities({
            type: input.activityType as string | undefined,
            entityId: input.entityId as string | undefined,
            limit: typeof input.limit === 'number' ? input.limit : 50,
          }));
        }
        case 'add_note': {
          if (!input.text) return bad('add_note requires text.');
          return json(bos.addNote(
            input.text as string,
            input.entityId as string | undefined,
            input.entityName as string | undefined,
          ));
        }
        case 'contact_detail': {
          if (!input.id) return bad('contact_detail requires id.');
          const detail = bos.contactDetail(input.id as string);
          // Names the totals so the agent does not have to add the lists up.
          return detail
            ? json({ ...detail, totals: detail.totals })
            : bad('Contact not found.');
        }
        case 'attention': {
          const items = bos.attentionNeeded();
          if (items.length === 0) return ok('Nothing is overdue or due in the next three days.');
          return json(items);
        }

        // ── Deleting ──────────────────────────────────────────────────────
        case 'delete_lead': {
          if (!input.id) return bad('delete_lead requires id.');
          // Named in the failure, so a wrong id does not read as a silent no-op.
          return bos.deleteLead(input.id as string)
            ? ok('Lead deleted.')
            : bad('No lead with that id. Use list_leads to see the ids.');
        }
        case 'delete_invoice': {
          if (!input.id) return bad('delete_invoice requires id.');
          return bos.deleteInvoice(input.id as string)
            ? ok('Invoice deleted.')
            : bad('No invoice with that id. Use list_invoices to see the ids.');
        }
        case 'delete_deal': {
          if (!input.id) return bad('delete_deal requires id.');
          return bos.deleteDeal(input.id as string)
            ? ok('Deal deleted.')
            : bad('No deal with that id. Use list_deals to see the ids.');
        }

        // ── Correspondence ────────────────────────────────────────────────
        case 'list_emails': {
          const emails = bos.listEmails();
          if (emails.length === 0) return ok('No email has been sent or saved yet.');
          return json(emails.slice(0, input.limit ? (input.limit as number) : 25));
        }
        case 'delete_email': {
          if (!input.id) return bad('delete_email requires id.');
          return bos.deleteEmail(input.id as string)
            ? ok('Email removed from the log.')
            : bad('No email with that id.');
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
