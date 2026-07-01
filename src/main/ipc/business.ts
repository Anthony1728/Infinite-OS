// Business OS IPC handlers

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

  ipcMain.handle(IPC.BUSINESS_LIST_CONTACTS, async (_e, { search }) => {
    return businessOS.listContacts(search);
  });

  // Leads
  ipcMain.handle(IPC.BUSINESS_CREATE_LEAD, async (_e, data) => {
    return businessOS.createLead(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_LEAD_STATUS, async (_e, { id, status }) => {
    return businessOS.updateLeadStatus(id, status);
  });

  ipcMain.handle(IPC.BUSINESS_LIST_LEADS, async (_e, { status }) => {
    return businessOS.listLeads(status);
  });

  // Invoices
  ipcMain.handle(IPC.BUSINESS_CREATE_INVOICE, async (_e, data) => {
    return businessOS.createInvoice(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_INVOICE_STATUS, async (_e, { id, status }) => {
    return businessOS.updateInvoiceStatus(id, status);
  });

  ipcMain.handle(IPC.BUSINESS_LIST_INVOICES, async (_e, { status }) => {
    return businessOS.listInvoices(status);
  });

  // Deals
  ipcMain.handle(IPC.BUSINESS_CREATE_DEAL, async (_e, data) => {
    return businessOS.createDeal(data);
  });

  ipcMain.handle(IPC.BUSINESS_UPDATE_DEAL_STAGE, async (_e, { id, stage }) => {
    return businessOS.updateDealStage(id, stage);
  });

  ipcMain.handle(IPC.BUSINESS_LIST_DEALS, async (_e, { stage }) => {
    return businessOS.listDeals(stage);
  });

  // Analytics
  ipcMain.handle(IPC.BUSINESS_ANALYTICS, async () => {
    return businessOS.getAnalytics();
  });

  ipcMain.handle(IPC.BUSINESS_STATS, async () => {
    return businessOS.getStats();
  });
}

