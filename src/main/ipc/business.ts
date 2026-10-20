// Business Command Center IPC handlers

import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipc.js';
import { businessOS } from '../index.js';

export function registerBusinessIpc(): void {
  // Contacts
  ipcMain.handle(IPC.BUSINESS_CREATE_CONTACT, async (_e, data) => {
    return businessOS.createContact(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_CONTACT, async (_e, { id, updates }) => {
    return businessOS.updateContact(id, updates);
  });

  ipcMain.handle(IPC.BUSINESS_DELETE_CONTACT, async (_e, { id }) => {
    return businessOS.deleteContact(id);
  });

  // NOTE: these list handlers take optional filters, and the renderer calls them
  // with NO argument at all (see preload `businessListContacts`). Destructuring
  // the second parameter directly meant `undefined` was destructured, the
  // handler's promise rejected, and because the view loads everything with a
  // single Promise.all the ENTIRE Business tab failed to render. Optional
  // filters now default to nothing instead of throwing.
  ipcMain.handle(IPC.BUSINESS_LIST_CONTACTS, async (_e, args) => {
    return businessOS.listContacts(args?.search);
  });

  // Leads
  ipcMain.handle(IPC.BUSINESS_CREATE_LEAD, async (_e, data) => {
    return businessOS.createLead(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_LEAD_STATUS, async (_e, { id, status }) => {
    return businessOS.updateLeadStatus(id, status);
  });

  ipcMain.handle(IPC.BUSINESS_LIST_LEADS, async (_e, args) => {
    return businessOS.listLeads(args?.status);
  });

  // Invoices
  ipcMain.handle(IPC.BUSINESS_CREATE_INVOICE, async (_e, data) => {
    return businessOS.createInvoice(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_INVOICE_STATUS, async (_e, { id, status }) => {
    return businessOS.updateInvoiceStatus(id, status);
  });

  ipcMain.handle(IPC.BUSINESS_LIST_INVOICES, async (_e, args) => {
    return businessOS.listInvoices(args?.status);
  });

  // Deals
  ipcMain.handle(IPC.BUSINESS_CREATE_DEAL, async (_e, data) => {
    return businessOS.createDeal(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_DEAL_STAGE, async (_e, { id, stage }) => {
    return businessOS.updateDealStage(id, stage);
  });

  ipcMain.handle(IPC.BUSINESS_LIST_DEALS, async (_e, args) => {
    return businessOS.listDeals(args?.stage);
  });

  // Analytics
  ipcMain.handle(IPC.BUSINESS_ANALYTICS, async () => {
    return businessOS.getAnalytics();
  });

  // Tasks now live in the store rather than in renderer memory, so the section
  // survives a reload and the agent can see and manage the same list.
  ipcMain.handle(IPC.BUSINESS_LIST_TASKS, async (_e, args?: { status?: string; assignee?: string }) =>
    businessOS.listTasks({
      status: args?.status as 'todo' | 'in_progress' | 'done' | undefined,
      assignee: args?.assignee,
    }));

  ipcMain.handle(IPC.BUSINESS_CREATE_TASK, async (_e, data: Parameters<typeof businessOS.createTask>[0]) =>
    businessOS.createTask(data));

  ipcMain.handle(IPC.BUSINESS_UPDATE_TASK, async (_e, { id, updates }: { id: string; updates: Record<string, unknown> }) => {
    const task = businessOS.updateTask(id, updates);
    return task ?? { error: 'Task not found.' };
  });

  ipcMain.handle(IPC.BUSINESS_DELETE_TASK, async (_e, { id }: { id: string }) => businessOS.deleteTask(id));

  /** Everything at once, for "how is the business doing". */
  ipcMain.handle(IPC.BUSINESS_OVERVIEW, async () => businessOS.overview());

  /** Search across every record type at once. */
  ipcMain.handle(IPC.BUSINESS_SEARCH, async (_e, { query }: { query: string }) => businessOS.search(query));

  // ── The business history and the relationships between records ──────────
  // Both of these used to live in renderer memory, so the "Recent Activity"
  // panel was wiped on every reload and a contact showed no link to the deals,
  // invoices and tasks that belonged to it.
  ipcMain.handle(IPC.BUSINESS_ACTIVITIES, async (_e, args?: { type?: string; entityId?: string; limit?: number }) =>
    businessOS.listActivities({ type: args?.type, entityId: args?.entityId, limit: args?.limit ?? 200 }));

  ipcMain.handle(IPC.BUSINESS_ADD_NOTE, async (_e, args: { text: string; entityId?: string; entityName?: string }) =>
    businessOS.addNote(args.text, args.entityId, args.entityName));

  /** Everything hanging off one contact, with the money rolled up. */
  ipcMain.handle(IPC.BUSINESS_CONTACT_DETAIL, async (_e, { id }: { id: string }) => businessOS.contactDetail(id));

  /** What is late, computed from real dates. */
  ipcMain.handle(IPC.BUSINESS_ATTENTION, async () => businessOS.attentionNeeded());

  // ── Deleting, which only the user could do before ──────────────────────
  // Leads, invoices and deals were creatable and listable but not deletable
  // from anywhere. A cancelled job could only be hidden by changing its stage.
  ipcMain.handle(IPC.BUSINESS_DELETE_LEAD, async (_e, { id }: { id: string }) => businessOS.deleteLead(id));
  ipcMain.handle(IPC.BUSINESS_DELETE_INVOICE, async (_e, { id }: { id: string }) => businessOS.deleteInvoice(id));
  ipcMain.handle(IPC.BUSINESS_DELETE_DEAL, async (_e, { id }: { id: string }) => businessOS.deleteDeal(id));

  /**
   * Log a message that went out.
   *
   * Distinct from `saveEmail`, which is a draft. The agent sends mail through
   * the same transport the UI uses, so an email it sends is logged the same way
   * and shows up in the same list.
   */
  ipcMain.handle(IPC.BUSINESS_LOG_SENT_EMAIL, async (_e, args: { from: string; to: string; subject: string; body: string }) =>
    businessOS.logSentEmail(args));

  // Emails (persisted drafts/sent log)
  ipcMain.handle(IPC.BUSINESS_LIST_EMAILS, async () => {
    return businessOS.listEmails();
  });

  ipcMain.handle(IPC.BUSINESS_SAVE_EMAIL, async (_e, data) => {
    return businessOS.saveEmail(data);
  });

  ipcMain.handle(IPC.BUSINESS_DELETE_EMAIL, async (_e, { id }) => {
    return businessOS.deleteEmail(id);
  });

  ipcMain.handle(IPC.BUSINESS_STATS, async () => {
    return businessOS.getStats();
  });
}

