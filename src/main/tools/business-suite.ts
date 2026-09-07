import type { Tool, ToolResult } from './base.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { randomUUID } from 'node:crypto';

interface Customer {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  notes: string;
  tags: string[];
  createdAt: number;
  lastContact?: number;
}

interface Invoice {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  createdAt: number;
  dueDate: number;
  paidAt?: number;
  notes?: string;
}

interface Expense {
  id: string;
  description: string;
  amount: number;
  category: string;
  date: number;
  receipt?: string;
  notes?: string;
}

interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'completed' | 'on-hold' | 'cancelled';
  tasks: Array<{ name: string; done: boolean }>;
  budget: number;
  spent: number;
  startDate: number;
  endDate?: number;
}

const DATA_DIR = join(infiniteHome(), 'business');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadJson<T>(file: string, fallback: T): T {
  ensureDir();
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return fallback; }
}

function saveJson(file: string, data: unknown): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

export const businessSuiteTool: Tool = {
  name: 'BusinessSuite',
  description:
    'Complete business management suite: CRM (customers, leads, deals), invoicing (create/send/track), expense tracking, project management, and financial reports. Manage your entire business from one tool.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      module: {
        type: 'string',
        enum: ['crm', 'invoices', 'expenses', 'projects', 'reports'],
        description: 'Business module to use',
      },
      action: {
        type: 'string',
        enum: ['create', 'list', 'get', 'update', 'delete', 'summary'],
        description: 'Action to perform',
      },
      data: {
        type: 'object',
        description: 'Data for create/update operations',
      },
      id: { type: 'string', description: 'Record ID for get/update/delete' },
      filter: { type: 'string', description: 'Filter criteria' },
      startDate: { type: 'string', description: 'Start date filter (YYYY-MM-DD)' },
      endDate: { type: 'string', description: 'End date filter (YYYY-MM-DD)' },
    },
    required: ['module', 'action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      module: string;
      action: string;
      data?: Record<string, unknown>;
      id?: string;
      filter?: string;
      startDate?: string;
      endDate?: string;
    };

    try {
      switch (input.module) {
        case 'crm': {
          const customers = loadJson<Customer[]>('customers.json', []);

          switch (input.action) {
            case 'create': {
              if (!input.data) return { content: 'data is required', is_error: true };
              const customer: Customer = {
                id: randomUUID(),
                name: String(input.data.name || ''),
                email: String(input.data.email || ''),
                phone: input.data.phone as string,
                company: input.data.company as string,
                notes: String(input.data.notes || ''),
                tags: (input.data.tags as string[]) || [],
                createdAt: Date.now(),
              };
              customers.push(customer);
              saveJson('customers.json', customers);
              return { content: `Customer created: ${customer.name} (ID: ${customer.id})` };
            }

            case 'list': {
              if (customers.length === 0) return { content: 'No customers yet. Use "create" to add one.' };
              const lines = [`=== Customers (${customers.length}) ===`, ''];
              for (const c of customers) {
                lines.push(`  ${c.name} (${c.email})`);
                lines.push(`    ID: ${c.id} | Company: ${c.company || 'N/A'} | Tags: ${c.tags.join(', ') || 'none'}`);
              }
              return { content: lines.join('\n') };
            }

            case 'get': {
              if (!input.id) return { content: 'id is required', is_error: true };
              const customer = customers.find((c) => c.id === input.id);
              if (!customer) return { content: `Customer not found: ${input.id}`, is_error: true };
              return {
                content: [
                  `=== ${customer.name} ===`,
                  `Email: ${customer.email}`,
                  `Phone: ${customer.phone || 'N/A'}`,
                  `Company: ${customer.company || 'N/A'}`,
                  `Tags: ${customer.tags.join(', ') || 'none'}`,
                  `Notes: ${customer.notes || 'none'}`,
                  `Created: ${new Date(customer.createdAt).toLocaleDateString()}`,
                ].join('\n'),
              };
            }

            case 'summary': {
              const totalCustomers = customers.length;
              const thisMonth = customers.filter((c) => {
                const d = new Date(c.createdAt);
                const now = new Date();
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
              }).length;
              return {
                content: [
                  '=== CRM Summary ===',
                  `Total Customers: ${totalCustomers}`,
                  `New This Month: ${thisMonth}`,
                ].join('\n'),
              };
            }

            default:
              return { content: `CRM action not implemented: ${input.action}`, is_error: true };
          }
        }

        case 'invoices': {
          const invoices = loadJson<Invoice[]>('invoices.json', []);

          switch (input.action) {
            case 'create': {
              if (!input.data) return { content: 'data is required', is_error: true };
              const items = (input.data.items as Array<{ description: string; quantity: number; unitPrice: number }>) || [];
              const invoiceItems = items.map((item) => ({
                ...item,
                total: item.quantity * item.unitPrice,
              }));
              const subtotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
              const tax = subtotal * (Number(input.data.taxRate || 0.1));
              const invoice: Invoice = {
                id: randomUUID(),
                number: `INV-${String(invoices.length + 1).padStart(4, '0')}`,
                customerId: String(input.data.customerId || ''),
                customerName: String(input.data.customerName || 'Unknown'),
                items: invoiceItems,
                subtotal,
                tax,
                total: subtotal + tax,
                status: 'draft',
                createdAt: Date.now(),
                dueDate: Date.now() + 30 * 24 * 60 * 60 * 1000,
                notes: input.data.notes as string,
              };
              invoices.push(invoice);
              saveJson('invoices.json', invoices);
              return {
                content: [
                  `Invoice created: ${invoice.number}`,
                  `Customer: ${invoice.customerName}`,
                  `Total: $${invoice.total.toFixed(2)}`,
                  `Status: ${invoice.status}`,
                ].join('\n'),
              };
            }

            case 'list': {
              if (invoices.length === 0) return { content: 'No invoices yet.' };
              const lines = [`=== Invoices (${invoices.length}) ===`, ''];
              for (const inv of invoices) {
                lines.push(`  ${inv.number}: $${inv.total.toFixed(2)} - ${inv.customerName} [${inv.status}]`);
              }
              return { content: lines.join('\n') };
            }

            case 'summary': {
              const total = invoices.reduce((sum, inv) => sum + inv.total, 0);
              const paid = invoices.filter((inv) => inv.status === 'paid').reduce((sum, inv) => sum + inv.total, 0);
              const pending = invoices.filter((inv) => inv.status === 'sent').reduce((sum, inv) => sum + inv.total, 0);
              const overdue = invoices.filter((inv) => inv.status === 'overdue').reduce((sum, inv) => sum + inv.total, 0);
              return {
                content: [
                  '=== Invoice Summary ===',
                  `Total Invoiced: $${total.toFixed(2)}`,
                  `Paid: $${paid.toFixed(2)}`,
                  `Pending: $${pending.toFixed(2)}`,
                  `Overdue: $${overdue.toFixed(2)}`,
                ].join('\n'),
              };
            }

            default:
              return { content: `Invoice action not implemented: ${input.action}`, is_error: true };
          }
        }

        case 'expenses': {
          const expenses = loadJson<Expense[]>('expenses.json', []);

          switch (input.action) {
            case 'create': {
              if (!input.data) return { content: 'data is required', is_error: true };
              const expense: Expense = {
                id: randomUUID(),
                description: String(input.data.description || ''),
                amount: Number(input.data.amount || 0),
                category: String(input.data.category || 'general'),
                date: input.data.date ? new Date(String(input.data.date)).getTime() : Date.now(),
                receipt: input.data.receipt as string,
                notes: input.data.notes as string,
              };
              expenses.push(expense);
              saveJson('expenses.json', expenses);
              return { content: `Expense recorded: $${expense.amount.toFixed(2)} - ${expense.description}` };
            }

            case 'list': {
              if (expenses.length === 0) return { content: 'No expenses recorded.' };
              const lines = [`=== Expenses (${expenses.length}) ===`, ''];
              for (const exp of expenses) {
                lines.push(`  $${exp.amount.toFixed(2)} - ${exp.description} [${exp.category}]`);
              }
              return { content: lines.join('\n') };
            }

            case 'summary': {
              const total = expenses.reduce((sum, exp) => sum + exp.amount, 0);
              const byCategory: Record<string, number> = {};
              for (const exp of expenses) {
                byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
              }
              return {
                content: [
                  '=== Expense Summary ===',
                  `Total Expenses: $${total.toFixed(2)}`,
                  '',
                  'By Category:',
                  ...Object.entries(byCategory).map(([cat, amt]) => `  ${cat}: $${amt.toFixed(2)}`),
                ].join('\n'),
              };
            }

            default:
              return { content: `Expense action not implemented: ${input.action}`, is_error: true };
          }
        }

        case 'projects': {
          const projects = loadJson<Project[]>('projects.json', []);

          switch (input.action) {
            case 'create': {
              if (!input.data) return { content: 'data is required', is_error: true };
              const project: Project = {
                id: randomUUID(),
                name: String(input.data.name || ''),
                description: String(input.data.description || ''),
                status: 'active',
                tasks: (input.data.tasks as Array<{ name: string; done: boolean }>) || [],
                budget: Number(input.data.budget || 0),
                spent: 0,
                startDate: Date.now(),
                endDate: input.data.endDate ? new Date(String(input.data.endDate)).getTime() : undefined,
              };
              projects.push(project);
              saveJson('projects.json', projects);
              return { content: `Project created: ${project.name} (ID: ${project.id})` };
            }

            case 'list': {
              if (projects.length === 0) return { content: 'No projects yet.' };
              const lines = [`=== Projects (${projects.length}) ===`, ''];
              for (const p of projects) {
                const progress = p.tasks.length > 0
                  ? `${Math.round((p.tasks.filter((t) => t.done).length / p.tasks.length) * 100)}%`
                  : '0%';
                lines.push(`  ${p.name} [${p.status}] - ${progress}`);
                lines.push(`    Budget: $${p.budget.toFixed(2)} | Spent: $${p.spent.toFixed(2)}`);
              }
              return { content: lines.join('\n') };
            }

            case 'summary': {
              const active = projects.filter((p) => p.status === 'active').length;
              const totalBudget = projects.reduce((sum, p) => sum + p.budget, 0);
              const totalSpent = projects.reduce((sum, p) => sum + p.spent, 0);
              return {
                content: [
                  '=== Project Summary ===',
                  `Total Projects: ${projects.length}`,
                  `Active: ${active}`,
                  `Total Budget: $${totalBudget.toFixed(2)}`,
                  `Total Spent: $${totalSpent.toFixed(2)}`,
                ].join('\n'),
              };
            }

            default:
              return { content: `Project action not implemented: ${input.action}`, is_error: true };
          }
        }

        case 'reports': {
          const invoices = loadJson<Invoice[]>('invoices.json', []);
          const expenses = loadJson<Expense[]>('expenses.json', []);
          const customers = loadJson<Customer[]>('customers.json', []);
          const projects = loadJson<Project[]>('projects.json', []);

          const totalRevenue = invoices.filter((inv) => inv.status === 'paid').reduce((sum, inv) => sum + inv.total, 0);
          const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
          const profit = totalRevenue - totalExpenses;

          return {
            content: [
              '=== Financial Report ===',
              '',
              'Revenue:',
              `  Total Invoiced: $${invoices.reduce((sum, inv) => sum + inv.total, 0).toFixed(2)}`,
              `  Total Paid: $${totalRevenue.toFixed(2)}`,
              `  Total Pending: $${invoices.filter((inv) => inv.status === 'sent').reduce((sum, inv) => sum + inv.total, 0).toFixed(2)}`,
              '',
              'Expenses:',
              `  Total: $${totalExpenses.toFixed(2)}`,
              '',
              `Net Profit: $${profit.toFixed(2)}`,
              '',
              'Metrics:',
              `  Customers: ${customers.length}`,
              `  Projects: ${projects.length} (${projects.filter((p) => p.status === 'active').length} active)`,
              `  Invoices: ${invoices.length}`,
              `  Expenses: ${expenses.length}`,
            ].join('\n'),
          };
        }

        default:
          return { content: `Unknown module: ${input.module}`, is_error: true };
      }
    } catch (error) {
      return { content: `BusinessSuite error: ${(error as Error).message}`, is_error: true };
    }
  },
};
