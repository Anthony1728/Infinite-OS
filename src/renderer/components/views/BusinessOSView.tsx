import { useCallback, useState, useEffect } from 'react';
import {
  DollarSign, Users, Handshake, ListTodo, TrendingUp, TrendingDown,
  Plus, Search, X, Send, Mail, Phone, Building2, Tag,
  CheckCircle2, Circle, Clock, FileText,
  ArrowUpRight, Calendar,
  Trash2, StickyNote
} from 'lucide-react';
import { InputModal, type InputModalField } from '../modals/InputModal';
import { AppIcon, BRAND_GRADIENT } from '../brand/AppIcon';

type Tab = 'overview' | 'crm' | 'leads' | 'email' | 'analytics' | 'tasks' | 'invoices';

/** The lead pipeline, in order. Shared by the list and the status dropdown. */
const LEAD_STATUSES: Lead['status'][] = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  tags: string[];
  notes: string;
  createdAt: number;
}

interface Deal {
  id: string;
  contactId: string;
  title: string;
  value: number;
  /**
 * Matches the store's stage union exactly.
 *
 * It used to be `lead | contact | proposal | negotiation | won | lost`, which
 * is not a subset of what the store can hold — it only ever writes `discovery`,
 * `proposal`, `negotiation`, `closed_won` and `closed_lost`. A type that is
 * wider than reality is worse than no type: it let the board declare columns
 * that could never be filled, and comparisons against `won`/`lost` silently
 * never matched.
 */
  stage: 'discovery' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  createdAt: number;
}

interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  preview: string;
  time: number;
  read: boolean;
}

interface Task {
  id: string;
  title: string;
  description: string;
  assignee: string;
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  status: 'todo' | 'in_progress' | 'done';
  createdAt: number;
}

/**
 * Mirrors the record `BusinessOS.createInvoice` actually returns.
 *
 * This interface used to declare `client` and `createdAt`, neither of which the
 * store produces — it returns `contactId`, `issuedAt`, `dueAt` and `paidAt`. So
 * every invoice in the list rendered a blank client name and
 * "Invalid Date" from `new Date(undefined)`. The client name is now derived from
 * the contact instead of being read off a field that does not exist.
 */
interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Invoice {
  id: string;
  number: string;
  contactId: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  issuedAt: number;
  dueAt: number;
  paidAt?: number;
  notes: string;
}

/**
 * A lead.
 *
 * This type existed only in the store. The agent could list, create and change
 * leads, and this screen had no idea leads existed — it loaded them and never
 * rendered them — so a whole record type could be operated by the AI and was
 * invisible and unusable by the person it belonged to.
 */
interface Lead {
  id: string;
  contactId: string;
  status: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  value: number;
  source: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

interface Activity {
  id: string;
  text: string;
  at: number;
  type: string;
  entityId?: string;
  entityName?: string;
  actor?: 'user' | 'agent';
}

// Ids and timestamps now come from the store, not from the renderer, so this
// screen cannot invent one.

// Backend API calls
const api = {
  listContacts: () => window.api.businessListContacts(),
  createContact: (data: Record<string, unknown>) => window.api.businessCreateContact(data),
  updateContact: (id: string, updates: Record<string, unknown>) => window.api.businessUpdateContact({ id, updates }),
  deleteContact: (id: string) => window.api.businessDeleteContact({ id }),
  listLeads: () => window.api.businessListLeads(),
  createLead: (data: Record<string, unknown>) => window.api.businessCreateLead(data),
  updateLeadStatus: (id: string, status: string) => window.api.businessUpdateLeadStatus({ id, status }),
  listInvoices: () => window.api.businessListInvoices(),
  createInvoice: (data: Record<string, unknown>) => window.api.businessCreateInvoice(data),
  updateInvoiceStatus: (id: string, status: string) => window.api.businessUpdateInvoiceStatus({ id, status }),
  listDeals: () => window.api.businessListDeals(),
  createDeal: (data: Record<string, unknown>) => window.api.businessCreateDeal(data),
  updateDealStage: (id: string, stage: string) => window.api.businessUpdateDealStage({ id, stage }),
  listEmails: () => window.api.businessListEmails(),
  saveEmail: (data: Record<string, unknown>) => window.api.businessSaveEmail(data),
  // The real transport. Without these the compose button has no way to actually
  // send anything and can only pretend.
  emailHasConfig: () => window.api.emailHasConfig(),
  emailSend: (args: { to: string; subject: string; text: string }) => window.api.emailSend(args),
  deleteEmail: (id: string) => window.api.businessDeleteEmail({ id }),
};

export function BusinessOSView() {
  const [tab, setTab] = useState<Tab>('overview');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  /**
   * Leads.
   *
   * Loaded from the store and now actually shown. The agent has always been
   * able to read and change these; until now this screen loaded the list and
   * threw it away, so the user could neither see a lead the AI had created nor
   * create one themselves.
   */
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showAddLead, setShowAddLead] = useState(false);
  const [newLead, setNewLead] = useState({ contactId: '', value: '', source: '' });
  const [emails, setEmails] = useState<Email[]>([]);
  // Surfaced when a send fails, so the user is told instead of the compose box
  // silently emptying.
  const [emailError, setEmailError] = useState('');
  /**
   * Errors from record changes, not from email.
   *
   * Failures used to be swallowed: a delete that failed still removed the row
   * from the screen, so the list disagreed with what was on disk and the user
   * had no way to know the change had not happened.
   */
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [contactSearch, setContactSearch] = useState('');
  /** The one search box that looks in every record type, not just contacts. */
  const [globalSearch, setGlobalSearch] = useState('');
  const [contactTagFilter, setContactTagFilter] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '', phone: '', tags: '', notes: '' });
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  /**
   * Everything connected to the selected contact.
   *
   * Read from the store's join rather than filtering the five lists here, so
   * the screen and the agent are looking at the same thing and neither can
   * quietly disagree with the other.
   */
  const [contactDetail, setContactDetail] = useState<{
    deals: Deal[]; invoices: Invoice[]; tasks: Task[];
    totals: { openDeals: number; pipelineValue: number; billed: number; collected: number; outstanding: number; openTasks: number; overdueTasks: number };
  } | null>(null);

  const loadContactDetail = useCallback((id: string) => {
    void window.api
      .businessContactDetail({ id })
      .then((detail: unknown) => {
        if (detail && typeof detail === 'object') setContactDetail(detail as never);
        else setContactDetail(null);
      })
      .catch(() => setContactDetail(null));
  }, []);

  /** Add a note to a record's history — the same action the agent has. */
  const addNoteFor = (entityId: string, entityName: string) => {
    setFormModal({
      title: `Add a note about ${entityName}`,
      fields: [{ key: 'text', label: 'Note', placeholder: 'What should be remembered about them?', multiline: true }],
      submitLabel: 'Add note',
      run: async (values) => {
        const text = values.text?.trim();
        if (!text) return;
        await window.api.businessAddNote({ text, entityId, entityName });
        loadContactDetail(entityId);
        loadActivity();
      },
    });
  };

  // The one shared prompted-form — replaces the chained window.prompt calls
  // the old edit flows used (native prompts were unthemed and blocked paint).
  const [formModal, setFormModal] = useState<{
    title: string;
    subtitle?: string;
    fields: InputModalField[];
    submitLabel?: string;
    run: (values: Record<string, string>) => Promise<void>;
  } | null>(null);

  const [dealDragId, setDealDragId] = useState<string | null>(null);
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [newDeal, setNewDeal] = useState({ title: '', value: '', contactId: '' });

  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  const [analyticsRange, setAnalyticsRange] = useState<'7d' | '30d' | '90d' | '1y'>('30d');

  const [taskFilter, setTaskFilter] = useState<'all' | 'todo' | 'in_progress' | 'done'>('all');
  const [taskSort, setTaskSort] = useState<'date' | 'priority'>('date');
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', assignee: '', dueDate: '', priority: 'medium' as 'low' | 'medium' | 'high' });

  const [showAddInvoice, setShowAddInvoice] = useState(false);
  const [newInvoiceClient, setNewInvoiceClient] = useState('');
  // Line items are shaped for the FORM (qty/rate are what a person types). The
  // store normalises them on the way in — see BusinessOS.createInvoice.
  const [newInvoiceItems, setNewInvoiceItems] = useState<Array<{ description: string; qty: number; rate: number }>>([{ description: '', qty: 1, rate: 0 }]);

  // Load data from backend on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [contactsData, invoicesData, dealsData, emailsData, tasksData, leadsData] = await Promise.all([
          api.listContacts(),
          api.listInvoices(),
          api.listDeals(),
          api.listEmails().catch(() => null),
          window.api.businessListTasks().catch(() => []),
          // Each load is individually guarded so one failing call cannot empty
          // the whole section. Before, a single rejection meant nothing
          // rendered at all and the tab looked like an empty business.
          api.listLeads().catch(() => []),
        ]);
        if (contactsData) setContacts(contactsData);
        if (invoicesData) setInvoices(invoicesData);
        if (dealsData) setDeals(dealsData);
        if (emailsData) setEmails(emailsData);
        // Tasks were previously `useState` only — never written to disk, so they
        // vanished on every reload and the agent could not see them. They are
        // now real records, loaded here like everything else.
        if (Array.isArray(tasksData)) setTasks(tasksData as Task[]);
        if (Array.isArray(leadsData)) setLeads(leadsData as Lead[]);
      } catch (e) {
        console.error('Failed to load business data:', e);
      }
    };
    loadData();
  }, []);

  /**
   * The activity feed is the store's, not this screen's.
   *
   * It used to be built here with `useState`, so "Recent Activity" was wiped on
   * every reload — it looked like a history of the business and was not one.
   * Now it is read from the store, which records an entry whenever a record
   * actually changes, whether the change came from this screen or from the agent.
   */
  const addActivity = (_text: string, _type: string) => {
    // The store records history itself now. Writing here as well would duplicate
    // every entry, so this only triggers a refresh.
    void window.api.businessActivities({ limit: 200 }).then((list: unknown) => {
      if (Array.isArray(list)) setActivities(list as Activity[]);
    }).catch(() => undefined);
  };

  const loadActivity = useCallback(() => {
    void window.api
      .businessActivities({ limit: 200 })
      .then((list: unknown) => {
        if (Array.isArray(list)) setActivities(list as Activity[]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => { loadActivity(); }, [loadActivity]);

  /** What is late, computed from real dates rather than a manual reminders list. */
  const [attention, setAttention] = useState<Array<{ id: string; kind: string; label: string; who: string; amount?: number }>>([]);
  const loadAttention = useCallback(() => {
    void window.api
      .businessAttention()
      .then((items: unknown) => {
        if (Array.isArray(items)) setAttention(items);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => { loadAttention(); }, [loadAttention]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'crm', label: 'CRM' },
    // Leads are a real record type the store has always kept, but this section
    // had no tab for them, so they were only reachable by the AI.
    { id: 'leads', label: 'Leads' },
    { id: 'email', label: 'Email' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'invoices', label: 'Invoices' },
  ];

  const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  // Was `!['won', 'lost'].includes(d.stage)`, which never matched anything — the
  // store writes `closed_won`/`closed_lost` — so every won and lost deal was
  // still counted as active, inflating the headline number with closed deals.
  const activeDeals = deals.filter(d => d.stage !== 'closed_won' && d.stage !== 'closed_lost').length;
  const pendingTasks = tasks.filter(t => t.status !== 'done').length;

  const filteredContacts = contacts.filter(c => {
    const matchSearch = !contactSearch || c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.email.toLowerCase().includes(contactSearch.toLowerCase()) || c.company.toLowerCase().includes(contactSearch.toLowerCase());
    const matchTag = !contactTagFilter || c.tags.some(t => t.toLowerCase().includes(contactTagFilter.toLowerCase()));
    return matchSearch && matchTag;
  });

  /**
   * The pipeline board.
   *
   * The columns were labelled `lead`, `contact`, `proposal`, `negotiation`,
   * `won` and `lost`, but the store only ever holds `discovery`, `proposal`,
   * `negotiation`, `closed_won` and `closed_lost` — it normalises everything
   * else into those five on write. So four of the six columns could never
   * contain a deal: Lead and Contact were always empty, and a deal dragged to
   * Won was written as `closed_won` and disappeared from every column.
   *
   * The columns now use the values the store actually has, and are labelled in
   * the words people use, so the board shows the same five stages the agent
   * sees and the forecast is built from.
   */
  const pipelineStages: { id: Deal['stage']; label: string; color: string }[] = [
    { id: 'discovery', label: 'Discovery', color: 'from-slate-500 to-slate-600' },
    { id: 'proposal', label: 'Proposal', color: 'from-amber-500 to-amber-600' },
    { id: 'negotiation', label: 'Negotiation', color: 'from-purple-500 to-purple-600' },
    { id: 'closed_won', label: 'Won', color: 'from-green-500 to-emerald-600' },
    { id: 'closed_lost', label: 'Lost', color: 'from-red-500 to-red-600' },
  ];

  const dealsByStage = (stage:Deal['stage']) => deals.filter(d => d.stage === stage);

  const moveDealToStage = async (dealId: string, stage: Deal['stage']) => {
    try {
      await api.updateDealStage(dealId, stage);
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, stage } : d));
    } catch (e) {
      console.error('Failed to update deal stage:', e);
    }
  };

  const filteredTasks = tasks
    .filter(t => taskFilter === 'all' || t.status === taskFilter)
    .sort((a, b) => {
      if (taskSort === 'priority') {
        const p = { high: 0, medium: 1, low: 2 };
        return p[a.priority] - p[b.priority];
      }
      return b.createdAt - a.createdAt;
    });

  const addContact = async () => {
    if (!newContact.name) return;
    try {
      const c = await api.createContact({
        name: newContact.name,
        email: newContact.email,
        company: newContact.company,
        phone: newContact.phone,
        tags: newContact.tags.split(',').map(t => t.trim()).filter(Boolean),
        notes: newContact.notes,
      });
      setContacts(prev => [...prev, c]);
      setNewContact({ name: '', email: '', company: '', phone: '', tags: '', notes: '' });
      setShowAddContact(false);
      addActivity(`Contact added: ${c.name}`, 'contact');
    } catch (e) {
      console.error('Failed to create contact:', e);
    }
  };

  const addDeal = async () => {
    if (!newDeal.title) return;
    try {
      const d = await api.createDeal({
        title: newDeal.title,
        value: Number(newDeal.value) || 0,
        contactId: newDeal.contactId,
      });
      setDeals(prev => [...prev, d]);
      setNewDeal({ title: '', value: '', contactId: '' });
      setShowAddDeal(false);
      addActivity(`Deal created: ${d.title}`, 'deal');
    } catch (e) {
      console.error('Failed to create deal:', e);
    }
  };

  /**
   * Compose → actually send, or say why not.
   *
   * This used to write the message into a local JSON file via `saveEmail`, clear
   * the compose box, and log "Email sent to …" — with no transport involved at
   * all. Worse, the catch block inserted a local row anyway, so the send appeared
   * to succeed even when saving failed. The app already ships a real SMTP sender
   * (`emailSend`), so the button now uses it: with no mail account configured it
   * keeps the draft, says so, and logs nothing, rather than destroying the user's
   * text and claiming a message went out.
   */
  const sendEmail = async () => {
    if (!emailTo || !emailSubject) return;
    const to = emailTo;
    const subject = emailSubject;
    const body = emailBody;

    try {
      const configured = await api.emailHasConfig();
      if (!configured) {
        setEmailError('No mail account is set up, so nothing was sent and your draft is still here. Add one in Settings → Email.');
        return;
      }
      const result = await api.emailSend({ to, subject, text: body });
      if (!result?.ok) {
        setEmailError(`Sending failed: ${result?.error ?? 'unknown error'}. Your draft is still here.`);
        return;
      }
    } catch (e) {
      setEmailError(`Sending failed: ${e instanceof Error ? e.message : String(e)}. Your draft is still here.`);
      return;
    }

    // Only now, having really sent, record it in the local log and clear the form.
    try {
      const saved = (await api.saveEmail({ from: 'me', to, subject, body })) as Email;
      setEmails(prev => [saved, ...prev.filter(e => e.id !== saved.id)]);
    } catch {
      // The mail went out; failing to log it locally is not a send failure.
    }
    setEmailError('');
    setEmailTo(''); setEmailSubject(''); setEmailBody('');
    addActivity(`Email sent to ${to}`, 'email');
  };

  const removeEmail = async (id: string) => {
    try {
      await api.deleteEmail(id);
    } catch (e) {
      console.error('Failed to delete email:', e);
    }
    setEmails(prev => prev.filter(e => e.id !== id));
    if (selectedEmail?.id === id) setSelectedEmail(null);
  };

  // Both of these write through to the store. Previously they only changed local
  // state, so ticking a task off was undone by a reload and the agent could
  // never see the list at all.
  /**
 * Edit a task's details, not just its status.
 *
 * Writes through to the store on every field, so an edited due date is the same
 * fact to the screen and to the agent. A save that changes nothing is not
 * written, which keeps the activity history free of no-op entries.
 */
const editTask = (id: string) => {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  setFormModal({
    title: 'Edit task',
    subtitle: task.title,
    fields: [
      { key: 'title', label: 'Title', initial: task.title, required: true },
      { key: 'due', label: 'Due date (YYYY-MM-DD, blank for none)', initial: task.dueDate?.slice(0, 10) ?? '' },
      { key: 'assignee', label: 'Assigned to', initial: task.assignee ?? '' },
      { key: 'priority', label: 'Priority — low, normal or high', initial: task.priority },
    ],
    submitLabel: 'Save task',
    run: async (values) => {
      const trimmed = values.title?.trim() ?? '';
      if (!trimmed) { setError('A task needs a title.'); return; }
      const priority = (['low', 'normal', 'high'] as const).find(p => p === (values.priority ?? '').trim().toLowerCase())
        ?? task.priority;
      const trimmedDue = (values.due ?? '').trim();
      const updates: Record<string, unknown> = { title: trimmed, priority };
      updates.assignee = (values.assignee ?? '').trim();
      updates.dueDate = trimmedDue ? new Date(trimmedDue).toISOString() : undefined;

      try {
        const saved = await window.api.businessUpdateTask({ id, updates });
        if (saved && typeof saved === 'object' && 'id' in saved) {
          setTasks(prev => prev.map(t => (t.id === id ? (saved as Task) : t)));
        }
        addActivity(`Task updated: ${trimmed}`, 'task');
      } catch {
        setError('Could not save that change. Nothing was changed.');
      }
    },
  });
};

/** Delete a task, after asking — it cannot be undone from here. */
const deleteTask = async (id: string, title: string) => {
  if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
  try {
    const ok = await window.api.businessDeleteTask({ id });
    if (ok === false) {
      setError('That task no longer exists.');
      return;
    }
    setTasks(prev => prev.filter(t => t.id !== id));
    addActivity(`Task deleted: ${title}`, 'task');
  } catch {
    setError('Could not delete that task. Nothing was changed.');
  }
};

const toggleTask = (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    const next = task.status === 'done' ? 'todo' : 'done';
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, status: next } : t)));
    void window.api
      .businessUpdateTask({ id, updates: { status: next } })
      .then((saved: unknown) => {
        // Use the stored record, so the id matches what the agent will be given.
        if (saved && typeof saved === 'object' && 'id' in saved) {
          setTasks(prev => prev.map(t => (t.id === id ? (saved as Task) : t)));
        }
      })
      .catch(() => undefined);
  };

  const addTask = async () => {
    if (!newTask.title) return;
    try {
      const created = await window.api.businessCreateTask({
        title: newTask.title,
        description: newTask.description,
        assignee: newTask.assignee,
        dueDate: newTask.dueDate,
        priority: newTask.priority,
        status: 'todo',
      });
      if (created) setTasks(prev => [...prev, created as Task]);
      setNewTask({ title: '', description: '', assignee: '', dueDate: '', priority: 'medium' });
      setShowAddTask(false);
      addActivity(`Task created: ${newTask.title}`, 'task');
    } catch (e) {
      console.error('Failed to create task:', e);
    }
  };

  const addInvoice = async () => {
    if (!newInvoiceClient) return;
    try {
      const inv = await api.createInvoice({
        client: newInvoiceClient,
        items: [...newInvoiceItems],
        contactId: '',
      });
      setInvoices(prev => [...prev, inv]);
      setNewInvoiceClient('');
      setNewInvoiceItems([{ description: '', qty: 1, rate: 0 }]);
      setShowAddInvoice(false);
      addActivity(`Invoice created for ${contacts.find(c => c.id === inv.contactId)?.name ?? 'a contact'}`, 'invoice');
    } catch (e) {
      console.error('Failed to create invoice:', e);
    }
  };

  const markInvoicePaid = async (id: string) => {
    try {
      await api.updateInvoiceStatus(id, 'paid');
      setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: 'paid' as const } : i));
      addActivity('Invoice marked paid', 'invoice');
    } catch (e) {
      // Previously logged to the console and dropped: the row stayed unpaid on
      // screen with no explanation, so it looked like the click did nothing.
      setError(`Could not mark that invoice paid: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
    }
  };

  /**
   * Delete a record, and only take it off the screen if the store agrees.
   *
   * The row is removed from local state only after the store confirms the
   * delete. Removing it first and then discovering the write failed leaves the
   * screen showing something the disk does not have, which is the worst
   * possible outcome for a business record.
   */
  const confirmDelete = async (
    label: string,
    run: () => Promise<boolean>,
    onDeleted: () => void,
  ) => {
    if (!window.confirm(`${label}\n\nThis cannot be undone.`)) return;
    try {
      const deleted = await run();
      // A `false` means the record was not there — the goal state is already
      // true, so drop it from the screen rather than reporting a failure.
      if (deleted === false) {
        onDeleted();
        return;
      }
      onDeleted();
      addActivity(`${label}`, 'delete');
      loadActivity();
    } catch (e) {
      setError(`Could not delete that. Nothing was changed. (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const deleteDeal = (id: string, title: string) =>
    confirmDelete(`Delete the deal "${title}"?`, () => window.api.businessDeleteDeal({ id }), () =>
      setDeals(prev => prev.filter(d => d.id !== id)));

  const deleteInvoice = (id: string, number: string) =>
    confirmDelete(`Delete invoice ${number}?`, () => window.api.businessDeleteInvoice({ id }), () =>
      setInvoices(prev => prev.filter(i => i.id !== id)));

  const deleteLead = (id: string, who: string) =>
    confirmDelete(`Delete the lead for ${who}?`, () => window.api.businessDeleteLead({ id }), () =>
      setLeads(prev => prev.filter(l => l.id !== id)));

  /**
   * Edit a contact's details in one themed form.
   *
   * Every field is prefilled and submitted together — a cancelled modal changes
   * nothing, and the store's copy is what lands on screen, so the id is always
   * the real one.
   */
  const editContact = (contact: Contact) => {
    setFormModal({
      title: 'Edit contact',
      subtitle: contact.name,
      fields: [
        { key: 'name', label: 'Name', initial: contact.name, required: true },
        { key: 'email', label: 'Email', initial: contact.email },
        { key: 'phone', label: 'Phone', initial: contact.phone },
        { key: 'company', label: 'Company', initial: contact.company },
        { key: 'tags', label: 'Tags, comma separated', initial: contact.tags.join(', ') },
        { key: 'notes', label: 'Notes', initial: contact.notes, multiline: true },
      ],
      submitLabel: 'Save contact',
      run: async (values) => {
        const name = (values.name ?? '').trim();
        if (!name) { setError('A contact needs a name.'); return; }
        try {
          const updated = await api.updateContact(contact.id, {
            name,
            email: (values.email ?? '').trim(),
            phone: (values.phone ?? '').trim(),
            company: (values.company ?? '').trim(),
            // Split here rather than in the store, so the same string the tags
            // were displayed as is what gets stored — "vip, wholesale" and
            // ["vip","wholesale"] cannot disagree.
            tags: (values.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
            notes: (values.notes ?? '').trim(),
          });
          if (updated && typeof updated === 'object' && 'id' in updated) {
            const saved = updated as Contact;
            setContacts(prev => prev.map(c => (c.id === saved.id ? saved : c)));
            setSelectedContact(saved);
            loadContactDetail(saved.id);
          }
          setError('');
          loadActivity();
        } catch (e) {
          setError(`Could not save that contact: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
        }
      },
    });
  };

  /**
   * Delete a contact.
   *
   * Says exactly what goes with it. Deleting a contact takes their deals,
   * invoices, leads and tasks with it — otherwise invoices would sit in the
   * totals owed by a customer who no longer exists — so the confirmation names
   * the records rather than quietly dropping them.
   */
  const deleteContact = async (contact: Contact) => {
    const detail = contactDetail;
    const attached = detail
      ? detail.deals.length + detail.invoices.length + detail.tasks.length
      : null;
    const warning = attached
      ? `\n\nThis also removes ${attached} connected record${attached === 1 ? '' : 's'} (deals, invoices and tasks). It cannot be undone.`
      : '\n\nThis cannot be undone.';
    if (!window.confirm(`Delete ${contact.name}?${warning}`)) return;
    try {
      const deleted = await api.deleteContact(contact.id);
      if (deleted !== false) {
        setContacts(prev => prev.filter(c => c.id !== contact.id));
        // Clear the panel, or it shows a customer who is gone.
        setSelectedContact(null);
        setContactDetail(null);
        loadActivity();
        loadAttention();
      }
      setError('');
    } catch (e) {
      setError(`Could not delete that contact: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
    }
  };

  /** Create a lead against a contact, exactly as the agent would. */
  const addLead = async () => {
    if (!newLead.contactId) { setError('Pick the contact this lead belongs to.'); return; }
    const value = Number(newLead.value);
    if (!Number.isFinite(value) || value < 0) { setError('Enter the lead value as a number.'); return; }
    if (!newLead.source.trim()) { setError('Say where this lead came from, so the source is useful later.'); return; }
    try {
      const created = await api.createLead({
        contactId: newLead.contactId,
        value,
        source: newLead.source.trim(),
      });
      if (created && typeof created === 'object' && 'id' in created) {
        setLeads(prev => [created as Lead, ...prev]);
      }
      setNewLead({ contactId: '', value: '', source: '' });
      setShowAddLead(false);
      setError('');
      loadActivity();
      loadAttention();
    } catch (e) {
      setError(`Could not create that lead: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Move a lead along its pipeline, the same transition the agent makes. */
  const moveLead = async (id: string, status: Lead['status']) => {
    const previous = leads;
    // Optimistic, then reconciled: the store's copy wins, so the id here is
    // always the id the agent will be given.
    setLeads(prev => prev.map(l => (l.id === id ? { ...l, status } : l)));
    try {
      const saved = await api.updateLeadStatus(id, status);
      if (saved && typeof saved === 'object' && 'id' in saved) {
        setLeads(prev => prev.map(l => (l.id === id ? (saved as Lead) : l)));
      }
      loadActivity();
      loadAttention();
    } catch (e) {
      // Put the row back. Leaving a rejected change on screen would show a
      // pipeline state that does not exist.
      setLeads(previous);
      setError(`Could not move that lead: ${e instanceof Error ? e.message : String(e)}. Nothing was changed.`);
    }
  };

  const addInvoiceItemRow = () => {
    setNewInvoiceItems(prev => [...prev, { description: '', qty: 1, rate: 0 }]);
  };

  // The form edits qty/rate; the store normalises them to quantity/unitPrice.
  type InvoiceItemField = 'description' | 'qty' | 'rate';
  const updateInvoiceItem = (idx: number, field: InvoiceItemField, val: string | number) => {
    setNewInvoiceItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
  };

  const removeInvoiceItem = (idx: number) => {
    setNewInvoiceItems(prev => prev.filter((_, i) => i !== idx));
  };

  const barHeight = (val: number, max: number) => max > 0 ? Math.max(2, (val / max) * 100) : 2;

  const barData = (data: number[]) => {
    const max = Math.max(...data, 1);
    return data.map(v => ({ value: v, pct: barHeight(v, max) }));
  };

  /**
   * Real month-by-month series, built from real timestamps.
   *
   * These two charts used to be invented: `Array.from({ length: 6 }, () =>
   * Math.floor(revenue / 6))` produced six identical bars whose sum happened to
   * equal the total, so the picture said "steady six-month revenue" for a
   * business that might have earned it all last Tuesday. Customers were the
   * same trick with a different divisor. Only real history can answer "is this
   * going up?", so that is what is plotted — and where there is no history, the
   * empty state says so rather than drawing a flat lie.
   */
  const monthCounts = (timestamps: number[]): number[] => {
    const now = new Date();
    const buckets = new Array(6).fill(0) as number[];
    for (const at of timestamps) {
      // Skip rows with no timestamp rather than filing them under "now" — that
      // would invent a month of activity that never happened.
      if (!Number.isFinite(at) || at <= 0) continue;
      const when = new Date(at);
      const age = (now.getFullYear() - when.getFullYear()) * 12 + (now.getMonth() - when.getMonth());
      if (age >= 0 && age < 6) buckets[5 - age] += 1;
    }
    return buckets;
  };

  const monthLabels = (() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const when = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return when.toLocaleDateString(undefined, { month: 'short' });
    });
  })();

  // Revenue is counted when the invoice was actually PAID, not when it was
  // written — a draft invoice is not money in the bank.
  const revenueSeries = (() => {
    const now = new Date();
    const buckets = new Array(6).fill(0) as number[];
    for (const invoice of invoices) {
      if (invoice.status !== 'paid') continue;
      const at = invoice.paidAt ?? invoice.issuedAt;
      if (!Number.isFinite(at) || at <= 0) continue;
      const when = new Date(at);
      const age = (now.getFullYear() - when.getFullYear()) * 12 + (now.getMonth() - when.getMonth());
      if (age >= 0 && age < 6) buckets[5 - age] += invoice.total;
    }
    return buckets;
  })();

  const customerSeries = monthCounts(contacts.map((c) => c.createdAt));
  const revenueData = barData(revenueSeries);
  const hasRevenueHistory = revenueSeries.some(v => v > 0);
  const customerData = barData(customerSeries);
  const hasCustomerHistory = customerSeries.some(v => v > 0);

  // Real direction, from the last two periods. Returns null when it cannot be
  // known — which is different from "flat", and must not be drawn as a green
  // arrow.
  const realTrend = (series: number[]): 'up' | 'down' | 'flat' | null => {
    if (series.length < 2) return null;
    const previous = series[series.length - 2];
    const current = series[series.length - 1];
    if (previous === 0 && current === 0) return null;
    if (previous === 0) return current > 0 ? 'up' : null;
    const change = (current - previous) / previous;
    if (change > 0.05) return 'up';
    if (change < -0.05) return 'down';
    return 'flat';
  };
  const revenueTrend = realTrend(revenueSeries);
  const customerTrend = realTrend(customerSeries);

  // The funnel counts the three open stages the store can actually hold. It
  // previously counted `lead` and `contact` as well, which are never stored, so
  // the first two bars of a "deal conversion" chart were always zero — a chart
  // of a funnel that could not be walked.
  const dealConvData = barData([
    deals.filter(d => d.stage === 'discovery').length,
    deals.filter(d => d.stage === 'proposal').length,
    deals.filter(d => d.stage === 'negotiation').length,
  ]);
  const taskCompData = barData([
    tasks.filter(t => t.status === 'done').length,
    tasks.filter(t => t.status === 'in_progress').length,
    tasks.filter(t => t.status === 'todo').length,
  ]);

  const priorityColor = (p: string) => {
    if (p === 'high') return 'text-red-400 bg-red-500/15';
    if (p === 'medium') return 'text-amber-400 bg-amber-500/15';
    return 'text-blue-400 bg-blue-500/15';
  };

  /**
   * One search box over everything.
   *
   * The agent could search across contacts, leads, deals, invoices and tasks in
   * a single call; this section only filtered the contact list. So "find me
   * anything to do with Acme" meant asking the AI rather than looking, which is
   * the wrong way round.
   *
   * It searches the loaded records directly rather than round-tripping to the
   * store, so typing is instant and there is no request per keystroke.
   */
  const globalSearchResults = (() => {
    const q = globalSearch.trim().toLowerCase();
    if (q.length < 2) return null;
    const nameOf = (contactId: string) => contacts.find(c => c.id === contactId)?.name ?? '';
    return {
      contacts: contacts.filter(c =>
        c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)),
      deals: deals.filter(d => d.title.toLowerCase().includes(q) || nameOf(d.contactId).toLowerCase().includes(q)),
      invoices: invoices.filter(i =>
        i.number.toLowerCase().includes(q) || nameOf(i.contactId).toLowerCase().includes(q)),
      leads: leads.filter(l => nameOf(l.contactId).toLowerCase().includes(q) || l.source.toLowerCase().includes(q)),
      tasks: tasks.filter(t =>
        t.title.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)),
      emails: emails.filter(e =>
        e.subject.toLowerCase().includes(q) || e.to.toLowerCase().includes(q) || e.body.toLowerCase().includes(q)),
    };
  })();

  const globalSearchTotal = globalSearchResults
    ? Object.values(globalSearchResults).reduce((n, list) => n + list.length, 0)
    : 0;

  /**
   * The same results, flattened for display.
   *
   * Each record type renders differently — a deal shows its value, a task shows
   * who it belongs to — so the label is built here, once, rather than in the
   * markup where six different shapes would have to be handled.
   */
  const searchGroups = globalSearchResults
    ? ([
        { label: 'Contacts', rows: globalSearchResults.contacts.map(c => ({ id: c.id, label: c.name })) },
        {
          label: 'Leads',
          rows: globalSearchResults.leads.map(l => ({
            id: l.id,
            label: `${contacts.find(c => c.id === l.contactId)?.name ?? 'Unknown contact'} · $${l.value.toLocaleString()}`,
          })),
        },
        {
          label: 'Deals',
          rows: globalSearchResults.deals.map(d => ({ id: d.id, label: `${d.title} · $${d.value.toLocaleString()}` })),
        },
        {
          label: 'Invoices',
          rows: globalSearchResults.invoices.map(i => ({ id: i.id, label: `${i.number} · $${i.total.toLocaleString()}` })),
        },
        {
          label: 'Tasks',
          rows: globalSearchResults.tasks.map(t => ({
            id: t.id,
            label: t.status === 'done' ? `${t.title} ✓` : t.title,
          })),
        },
        {
          label: 'Email',
          rows: globalSearchResults.emails.map(e => ({ id: e.id, label: `${e.subject} — to ${e.to}` })),
        },
      ])
    : [];

  const invoiceStatusColor = (s: string) => {
    if (s === 'paid') return 'text-green-400 bg-green-500/15';
    if (s === 'overdue') return 'text-red-400 bg-red-500/15';
    if (s === 'sent') return 'text-blue-400 bg-blue-500/15';
    return 'text-slate-400 bg-slate-500/15';
  };

  const taskStatusIcon = (s: string) => {
    if (s === 'done') return <CheckCircle2 size={16} className="text-green-400 cursor-pointer" />;
    if (s === 'in_progress') return <Clock size={16} className="text-amber-400 cursor-pointer" />;
    return <Circle size={16} className="text-slate-400 cursor-pointer" />;
  };

  return (
    <div className="h-full flex flex-col bg-[var(--os-surface)]">
      {/* Above the tabs, so a failure is visible wherever the user is when it
          happens — not buried under the email composer that already had one. */}
      {error && (
        <div className="flex-shrink-0 flex items-start gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/25">
          <p className="text-[11px] leading-relaxed text-red-200/90 flex-1">{error}</p>
          <button onClick={() => setError('')} className="text-red-200/60 hover:text-red-100/90" title="Dismiss">
            <X size={12} />
          </button>
        </div>
      )}
      <div className="flex-shrink-0 p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center flex-shrink-0">
              <AppIcon name="inf.chart" className="w-[18px] h-[18px]" gradient={BRAND_GRADIENT} />
            </div>
            <h1 className="text-lg font-semibold text-white">Business Command Center</h1>
          </div>
          {/* One box over every record type, rather than a filter that only
              looks at contacts. */}
          <div className="relative w-72">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
            <input
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Search everything..."
              className="w-full bg-[var(--os-surface-2)] border border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50"
            />
            {globalSearch && (
              <button
                onClick={() => setGlobalSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Results are grouped by record type and capped per group, so a broad
            term does not bury the screen in one kind of match. */}
        {globalSearchResults && (
          <div className="flex-shrink-0 mx-4 mb-3 rounded-2xl border border-white/10 bg-[var(--os-surface-2)] p-3">
            {globalSearchTotal === 0 ? (
              <p className="text-xs text-white/35">
                Nothing matches &quot;{globalSearch.trim()}&quot; in contacts, leads, deals, invoices, tasks or email.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {searchGroups.map(({ label, rows }) => (
                  <div key={label} className="min-w-0">
                    <div className="text-[9px] uppercase tracking-wide text-white/30 mb-1">
                      {label} ({rows.length})
                    </div>
                    {rows.length === 0 ? (
                      <div className="text-[10px] text-white/20">—</div>
                    ) : (
                      <div className="space-y-0.5 max-h-20 overflow-y-auto">
                        {rows.slice(0, 8).map(row => (
                          <div key={row.id} className="text-[11px] text-white/55 truncate">{row.label}</div>
                        ))}
                        {rows.length > 8 && (
                          <div className="text-[10px] text-white/25">and {rows.length - 8} more</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-1 bg-[var(--os-surface-2)] p-1 rounded-xl w-max border border-white/10">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t.id ? 'bg-[var(--os-surface)] text-white border border-white/5 shadow-sm' : 'text-white/50 hover:text-white/80'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Revenue', value: `$${revenue.toLocaleString()}`, icon: DollarSign, gradient: 'from-emerald-500 to-teal-500', trend: revenueTrend, note: 'paid invoices, all time' },
                { label: 'Customers', value: String(contacts.length), icon: Users, gradient: 'from-blue-500 to-indigo-500', trend: customerTrend, note: 'added this month' },
                { label: 'Active Deals', value: String(activeDeals), icon: Handshake, gradient: 'from-amber-500 to-orange-500', trend: null, note: 'still open' },
                { label: 'Pending Tasks', value: String(pendingTasks), icon: ListTodo, gradient: 'from-purple-500 to-pink-500', trend: null, note: 'not yet done' },
              ].map((kpi, i) => (
                <div key={i} className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4 transition-all duration-300 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-black/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${kpi.gradient} flex items-center justify-center`}>
                      <kpi.icon size={14} className="text-white" />
                    </div>
                    {/*
                      The arrow used to be a hard-coded literal — `trend: 'up'`
                      on Revenue and Customers, `'down'` on Pending Tasks — so a
                      green upward arrow sat next to revenue that nobody had
                      compared to anything. It now shows only when the last two
                      periods were actually compared, and says which way. No
                      arrow means "not enough history to say", which is honest.
                    */}
                    {(kpi.trend === 'up' || kpi.trend === 'down' || kpi.trend === 'flat') && (
                      <span
                        title={
                          kpi.trend === 'up' ? 'up vs last month'
                            : kpi.trend === 'down' ? 'down vs last month'
                            : 'about the same as last month'
                        }
                      >
                        {kpi.trend === 'up' && <TrendingUp size={14} className="text-green-400" />}
                        {kpi.trend === 'down' && <TrendingDown size={14} className="text-red-400" />}
                        {kpi.trend === 'flat' && <ArrowUpRight size={14} className="text-white/30" />}
                      </span>
                    )}
                  </div>
                  <div className="text-xl font-bold text-white">{kpi.value}</div>
                  <div className="text-[11px] text-white/40">{kpi.label}</div>
                  <div className="text-[10px] text-white/25 mt-0.5">{kpi.note}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/*
                Two panels side by side, replacing a "Recent Activity" box that
                was empty on every reload. Both read from the store: the history
                is what actually happened, and "Needs attention" is computed from
                real due dates rather than being a list somebody has to maintain.
              */}
              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4">
                <h3 className="text-sm font-medium text-white/70 mb-3">
                  Needs attention
                  {attention.length > 0 && (
                    <span className="ml-1.5 text-[10px] rounded-full bg-red-500/15 px-1.5 py-0.5 text-red-300">
                      {attention.length}
                    </span>
                  )}
                </h3>
                {attention.length === 0 ? (
                  <div className="text-center py-8 text-white/30 text-xs">
                    Nothing overdue, and nothing due in the next three days.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {attention.slice(0, 10).map(item => (
                      <div key={`${item.kind}-${item.id}-${item.label}`} className="flex items-start gap-2 text-xs">
                        <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                        <span className="text-white/70 flex-1">{item.label}</span>
                        <span className="text-white/30 text-[10px] flex-shrink-0">{item.who}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4">
                <h3 className="text-sm font-medium text-white/70 mb-3">Recent Activity</h3>
                {activities.length === 0 ? (
                  <div className="text-center py-8 text-white/30 text-xs">
                    Nothing has happened yet. Anything you or Infinite AI change is recorded here.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {activities.slice(0, 10).map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                        <span className="text-white/60 flex-1 truncate">{a.text}</span>
                        {/* Says who did it, so activity the agent produced is not
                            indistinguishable from what the user did. */}
                        {a.actor === 'agent' && (
                          <span className="text-[9px] rounded bg-violet-500/20 px-1 text-violet-300/90 flex-shrink-0">AI</span>
                        )}
                        <span className="text-white/25 flex-shrink-0">{new Date(a.at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4">
                <h3 className="text-sm font-medium text-white/70 mb-3">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'New Contact', icon: Users, action: () => { setTab('crm'); setTimeout(() => setShowAddContact(true), 100); } },
                    { label: 'Send Email', icon: Send, action: () => setTab('email') },
                    { label: 'Create Invoice', icon: FileText, action: () => { setTab('invoices'); setTimeout(() => setShowAddInvoice(true), 100); } },
                    { label: 'Start Campaign', icon: Mail, action: () => setTab('crm') },
                  ].map((qa, i) => (
                    <button key={i} onClick={qa.action}
                      className="flex items-center gap-2 p-2.5 rounded-xl bg-white/5 border border-white/5 text-xs text-white/60 hover:text-white hover:bg-white/10 hover:border-white/10 transition-all">
                      <qa.icon size={14} />
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'crm' && (
          <div className="flex gap-3 h-full">
            <div className="w-64 flex-shrink-0 flex flex-col gap-3">
              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-white/70">Contacts</span>
                  <button onClick={() => setShowAddContact(true)} className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center hover:bg-indigo-500/30 transition-all">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="relative mb-2">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Search contacts..."
                    className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                </div>
                <input value={contactTagFilter} onChange={e => setContactTagFilter(e.target.value)} placeholder="Filter by tag..."
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 mb-2" />
                <div className="space-y-1 max-h-[calc(100vh-320px)] overflow-y-auto">
                  {filteredContacts.map(c => (
                    <button key={c.id} onClick={() => { setSelectedContact(c); loadContactDetail(c.id); }}
                      className={`w-full text-left p-2 rounded-xl transition-all ${selectedContact?.id === c.id ? 'bg-indigo-500/15 border border-indigo-500/30' : 'hover:bg-white/5 border border-transparent'}`}>
                      <div className="text-xs font-medium text-white truncate">{c.name}</div>
                      <div className="text-[10px] text-white/30 truncate">{c.email}</div>
                    </button>
                  ))}
                  {filteredContacts.length === 0 && <div className="text-center py-4 text-white/20 text-xs">No contacts</div>}
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-3 min-w-0">
              {selectedContact ? (
                <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">
                        {selectedContact.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{selectedContact.name}</div>
                        <div className="text-xs text-white/40">{selectedContact.company}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Edit and delete.
                          Both IPC calls existed and were never wired to
                          anything, so from this screen a contact's details
                          were fixed at the moment it was created: a mistyped
                          email or a stale phone number could only be fixed by
                          deleting the contact and retyping it, losing
                          everything attached to it. */}
                      <button
                        onClick={() => void editContact(selectedContact)}
                        className="text-white/30 hover:text-white/60 text-[10px] px-1.5 py-0.5 rounded border border-white/10 hover:border-white/25"
                        title="Edit this contact"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteContact(selectedContact)}
                        className="text-white/20 hover:text-red-400/80"
                        title="Delete this contact"
                      >
                        <Trash2 size={13} />
                      </button>
                      <button onClick={() => setSelectedContact(null)} className="text-white/30 hover:text-white/60">
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center gap-2 text-xs"><Mail size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.email || '—'}</span></div>
                    <div className="flex items-center gap-2 text-xs"><Phone size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.phone || '—'}</span></div>
                    <div className="flex items-center gap-2 text-xs"><Building2 size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.company || '—'}</span></div>
                    <div className="flex items-center gap-2 text-xs"><Tag size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.tags.join(', ') || '—'}</span></div>
                  </div>
                  <div className="border-t border-white/5 pt-3">
                    <div className="flex items-center gap-1.5 mb-1"><StickyNote size={12} className="text-white/30" /><span className="text-xs text-white/40">Notes</span></div>
                    <p className="text-xs text-white/50">{selectedContact.notes || 'No notes'}</p>
                  </div>

                  {/*
                    Everything that hangs off this contact.

                    Monday's central idea is that a person is one item and the
                    deals, invoices and tasks hang off them. Without this the
                    section is five separate lists with no visible relationship
                    between them, and "what is this customer worth" cannot be
                    answered without adding three columns up by hand. All of it
                    comes from the store's own join, so it is the same data the
                    agent sees.
                  */}
                  <div className="border-t border-white/5 pt-3 mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40">Connected records</span>
                      <button
                        onClick={() => void addNoteFor(selectedContact.id, selectedContact.name)}
                        className="text-[10px] text-white/35 hover:text-white/70 flex items-center gap-1"
                        title="Add a note to this contact's history"
                      >
                        <Plus size={10} /> Note
                      </button>
                    </div>

                    <div className="grid grid-cols-4 gap-2 mb-3">
                      {[
                        { label: 'Open deals', value: contactDetail?.totals.openDeals ?? 0 },
                        { label: 'Pipeline', value: `$${(contactDetail?.totals.pipelineValue ?? 0).toLocaleString()}` },
                        { label: 'Owed', value: `$${(contactDetail?.totals.outstanding ?? 0).toLocaleString()}` },
                        { label: 'Open tasks', value: contactDetail?.totals.openTasks ?? 0 },
                      ].map(stat => (
                        <div key={stat.label} className="rounded-lg bg-white/[0.03] border border-white/5 px-2 py-1.5">
                          <div className="text-sm font-semibold text-white/85">{stat.value}</div>
                          <div className="text-[9px] text-white/35">{stat.label}</div>
                        </div>
                      ))}
                    </div>

                    {contactDetail && (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {contactDetail.deals.map(d => (
                          <div key={`d-${d.id}`} className="flex items-center gap-2 text-[11px]">
                            <Handshake size={10} className="text-amber-400/70 flex-shrink-0" />
                            <span className="text-white/60 flex-1 truncate">{d.title}</span>
                            <span className="text-white/30">${d.value.toLocaleString()}</span>
                          </div>
                        ))}
                        {contactDetail.invoices.map(i => (
                          <div key={`i-${i.id}`} className="flex items-center gap-2 text-[11px]">
                            <FileText size={10} className="text-purple-400/70 flex-shrink-0" />
                            <span className="text-white/60 flex-1 truncate">Invoice</span>
                            <span className="text-white/30">${i.total.toLocaleString()}</span>
                            <span className={`text-[9px] ${i.status === 'paid' ? 'text-emerald-400/80' : i.status === 'overdue' ? 'text-red-400/80' : 'text-white/30'}`}>{i.status}</span>
                          </div>
                        ))}
                        {contactDetail.tasks.map(t => (
                          <div key={`t-${t.id}`} className="flex items-center gap-2 text-[11px]">
                            {t.status === 'done'
                              ? <CheckCircle2 size={10} className="text-emerald-400/70 flex-shrink-0" />
                              : <Circle size={10} className="text-white/25 flex-shrink-0" />}
                            <span className={`flex-1 truncate ${t.status === 'done' ? 'text-white/30 line-through' : 'text-white/60'}`}>{t.title}</span>
                            {t.dueDate && <span className="text-[9px] text-white/30 flex-shrink-0">{t.dueDate.slice(0, 10)}</span>}
                          </div>
                        ))}
                        {contactDetail.deals.length + contactDetail.invoices.length + contactDetail.tasks.length === 0 && (
                          <p className="text-[11px] text-white/25">Nothing connected to this contact yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4 flex items-center justify-center text-white/20 text-xs h-24">
                  Select a contact to view details
                </div>
              )}

              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-white/70">Deal Pipeline</span>
                  <button onClick={() => setShowAddDeal(true)} className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center hover:bg-indigo-500/30 transition-all">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {pipelineStages.map(stage => (
                    <div key={stage.id} className="flex-1 min-w-[120px]"
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('bg-white/5'); }}
                      onDragLeave={e => { e.currentTarget.classList.remove('bg-white/5'); }}
                      onDrop={e => {
                        e.currentTarget.classList.remove('bg-white/5');
                        if (dealDragId) moveDealToStage(dealDragId, stage.id);
                        setDealDragId(null);
                      }}>
                      <div className="flex items-center gap-1.5 mb-2">
                        <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${stage.color}`} />
                        <span className="text-[10px] font-medium text-white/50">{stage.label}</span>
                        <span className="text-[10px] text-white/25">{dealsByStage(stage.id).length}</span>
                      </div>
                      <div className="space-y-1.5 min-h-[60px]">
                        {dealsByStage(stage.id).map(d => (
                          <div key={d.id} draggable
                            onDragStart={() => setDealDragId(d.id)}
                            className="p-2 rounded-lg bg-[var(--os-surface)] border border-white/5 cursor-grab hover:border-white/15 transition-all text-xs group">
                            <div className="flex items-start gap-1">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-white truncate">{d.title}</div>
                                <div className="text-[10px] text-white/30">${d.value.toLocaleString()}</div>
                              </div>
                              {/* Deletable. A deal that was created in error, or
                                  for a job that was cancelled, previously had no
                                  way out of the board except being dragged to a
                                  lost column, which then counted it as a lost
                                  deal in the forecast. */}
                              <button
                                onClick={() => void deleteDeal(d.id, d.title)}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-white/20 hover:text-red-400/80 flex-shrink-0"
                                title="Delete this deal"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'email' && (
          <div className="flex gap-3 h-full">
            <div className="w-72 flex-shrink-0 flex flex-col gap-3">
              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-3 flex-1">
                  {/*
                    Was titled "Inbox" while listing `emails`, which is only the
                    log of messages this app sent — every row reads `from: me`.
                    An inbox is mail arriving from other people, so the heading
                    was describing something the list was not. It now names what
                    it actually holds, and shows the recipient.
                  */}
                  <div className="text-xs font-medium text-white/70 mb-2">
                    Sent from Infinite OS
                    <span className="block text-[10px] font-normal text-white/25 mt-0.5">
                      Messages this app sent. Not your inbox.
                    </span>
                  </div>
                <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {emails.map(e => (
                    <button key={e.id} onClick={() => { setSelectedEmail({ ...e, read: true }); setEmails(prev => prev.map(em => em.id === e.id ? { ...em, read: true } : em)); void api.saveEmail({ id: e.id, from: e.from, to: e.to, subject: e.subject, body: e.body, read: true }).catch(() => undefined); }}
                      className={`w-full text-left p-2 rounded-xl transition-all ${selectedEmail?.id === e.id ? 'bg-indigo-500/15 border border-indigo-500/30' : 'hover:bg-white/5 border border-transparent'}`}>
                      <div className="flex items-center gap-1.5">
                        {!e.read && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
                        {/* The recipient is the useful part of a sent message —
                            "me" is the same for every row. */}
                        <span className="text-xs font-medium text-white truncate">to {e.to}</span>
                      </div>
                      <div className="text-[10px] text-white/50 truncate mt-0.5">{e.subject}</div>
                      <div className="text-[10px] text-white/25 truncate">{e.preview}</div>
                    </button>
                  ))}
                  {emails.length === 0 && <div className="text-center py-8 text-white/20 text-xs">No emails</div>}
                </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-3 min-w-0">
              <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4">
                <div className="text-xs font-medium text-white/70 mb-3">Compose</div>
                <div className="space-y-2">
                  <input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="To"
                    className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                  <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject"
                    className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                  <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder="Body" rows={4}
                    className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none" />
                  <button onClick={sendEmail} className="btn-premium flex items-center gap-1.5 text-xs px-4 py-2">
                    <Send size={12} /> Send
                  </button>
                  {emailError && (
                    <div className="text-[11px] leading-relaxed text-amber-300/90">{emailError}</div>
                  )}
                </div>
              </div>

              {selectedEmail && (
                <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4 flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{selectedEmail.subject}</div>
                      <div className="text-[10px] text-white/30 mt-0.5">From: {selectedEmail.from} · To: {selectedEmail.to}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void removeEmail(selectedEmail.id)} className="text-white/30 hover:text-red-400 text-[11px]">Delete</button>
                      <button onClick={() => setSelectedEmail(null)} className="text-white/30 hover:text-white/60"><X size={14} /></button>
                    </div>
                  </div>
                  <div className="text-xs text-white/60 whitespace-pre-wrap">{selectedEmail.body || 'No content'}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'analytics' && (
          <div className="space-y-4">
            <div className="flex gap-1 bg-[var(--os-surface-2)] p-1 rounded-xl w-max border border-white/10">
              {(['7d', '30d', '90d', '1y'] as const).map(r => (
                <button key={r} onClick={() => setAnalyticsRange(r)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-medium ${analyticsRange === r ? 'bg-[var(--os-surface)] text-white' : 'text-white/40 hover:text-white/60'}`}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                // Real history behind these two. `empty` means there is genuinely
                // nothing to plot, and the chart says so instead of drawing six
                // identical bars that imply a flat six months of trade.
                { title: 'Revenue Over Time', data: revenueData, color: 'bg-emerald-500', labels: monthLabels, empty: !hasRevenueHistory, emptyNote: 'No paid invoices in the last 6 months' },
                { title: 'Customer Growth', data: customerData, color: 'bg-blue-500', labels: monthLabels, empty: !hasCustomerHistory, emptyNote: 'No customers added in the last 6 months' },
                { title: 'Deal Conversion', data: dealConvData, color: 'bg-amber-500', labels: ['Discovery','Proposal','Negotiation'], empty: deals.length === 0, emptyNote: 'No deals yet' },
                { title: 'Task Completion', data: taskCompData, color: 'bg-purple-500', labels: ['Done','In Progress','Todo'], empty: tasks.length === 0, emptyNote: 'No tasks yet' },
              ].map((chart, ci) => (
                <div key={ci} className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-4">
                  <div className="text-xs font-medium text-white/70 mb-3">{chart.title}</div>
                  {chart.empty ? (
                    <div className="h-28 flex items-center justify-center text-center px-4">
                      <span className="text-[11px] text-white/25">{chart.emptyNote}</span>
                    </div>
                  ) : (
                    <div className="flex items-end gap-2 h-28">
                      {chart.data.map((d, di) => (
                        <div key={di} className="flex-1 flex flex-col items-center gap-1">
                          <div className="text-[9px] text-white/30">{typeof d.value === 'number' ? (d.value > 999 ? `$${(d.value/1000).toFixed(0)}k` : String(d.value)) : ''}</div>
                          <div className="w-full flex-1 flex items-end">
                            <div className={`w-full ${chart.color} rounded-t transition-all`} style={{ height: `${d.pct}%` }} />
                          </div>
                          <div className="text-[9px] text-white/25">{chart.labels[di] || ''}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'leads' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-white/40">
                {leads.length} lead{leads.length === 1 ? '' : 's'}
                {leads.filter(l => l.status === 'won').length > 0 && (
                  <span className="text-white/25"> · {leads.filter(l => l.status === 'won').length} won</span>
                )}
              </div>
              <button onClick={() => setShowAddLead(true)} className="btn-premium flex items-center gap-1.5 text-xs px-3 py-1.5">
                <Plus size={12} /> New Lead
              </button>
            </div>

            {leads.length === 0 ? (
              <div className="text-center py-12 text-white/20 text-xs">
                No leads yet. Add one, or ask Infinite AI to capture one.
              </div>
            ) : (
              <div className="space-y-2">
                {leads.map(l => {
                  const who = contacts.find(c => c.id === l.contactId);
                  return (
                    <div key={l.id} className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-3 flex items-center gap-3 transition-all hover:border-indigo-500/30">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {who?.name ?? 'Unknown contact'}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-white/30">
                          <span>${l.value.toLocaleString()}</span>
                          <span>·</span>
                          <span className="truncate">{l.source}</span>
                        </div>
                      </div>
                      {/* The same transitions the agent makes, so the pipeline is
                          not something only the AI can move. */}
                      <select
                        value={l.status}
                        onChange={e => void moveLead(l.id, e.target.value as Lead['status'])}
                        className="bg-[var(--os-surface)] border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white/70 outline-none focus:border-indigo-500/50"
                      >
                        {LEAD_STATUSES.map(s => (
                          <option key={s} value={s} className="bg-[var(--os-surface-2)]">{s}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => deleteLead(l.id, who?.name ?? 'this lead')}
                        className="text-white/20 hover:text-red-400/80 flex-shrink-0" title="Delete this lead"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'tasks' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => setTaskFilter('all')} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${taskFilter === 'all' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}>All</button>
                <button onClick={() => setTaskFilter('todo')} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${taskFilter === 'todo' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}>Todo</button>
                <button onClick={() => setTaskFilter('in_progress')} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${taskFilter === 'in_progress' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}>In Progress</button>
                <button onClick={() => setTaskFilter('done')} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${taskFilter === 'done' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}>Done</button>
                <div className="w-px h-4 bg-white/10 mx-1" />
                <button onClick={() => setTaskSort('date')} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${taskSort === 'date' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}>Sort by Date</button>
                <button onClick={() => setTaskSort('priority')} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium ${taskSort === 'priority' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/60'}`}>Sort by Priority</button>
              </div>
              <button onClick={() => setShowAddTask(true)} className="btn-premium flex items-center gap-1.5 text-xs px-3 py-1.5">
                <Plus size={12} /> Add Task
              </button>
            </div>

            <div className="space-y-2">
              {filteredTasks.map(t => (
                <div key={t.id} className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-3 flex items-center gap-3 transition-all hover:border-indigo-500/30">
                  <button onClick={() => toggleTask(t.id)}>{taskStatusIcon(t.status)}</button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-medium ${t.status === 'done' ? 'line-through text-white/30' : 'text-white'}`}>{t.title}</div>
                    {t.description && <div className="text-[10px] text-white/30 truncate mt-0.5">{t.description}</div>}
                    <div className="flex items-center gap-2 mt-1">
                      {t.assignee && <span className="text-[10px] text-white/25">{t.assignee}</span>}
                      {t.dueDate && <span className="text-[10px] text-white/25 flex items-center gap-0.5"><Calendar size={8} />{t.dueDate}</span>}
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium capitalize ${priorityColor(t.priority)}`}>{t.priority}</span>
                  {/* Edit and delete. The agent could set a task's title, due
                      date, assignee and priority and could delete it, but from
                      this screen the only control was ticking it off — so a
                      wrong due date could not be corrected without the AI. */}
                  <button
                    onClick={() => void editTask(t.id)}
                    className="text-white/25 hover:text-white/60 text-[10px] px-1"
                    title="Edit this task"
                  >
                    edit
                  </button>
                  <button
                    onClick={() => void deleteTask(t.id, t.title)}
                    className="text-white/20 hover:text-red-400/80 text-[10px] px-1"
                    title="Delete this task"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              {filteredTasks.length === 0 && <div className="text-center py-12 text-white/20 text-xs">No tasks</div>}
            </div>

            {showAddTask && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddTask(false)}>
                <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-white mb-3">Add Task</h3>
                  <div className="space-y-2">
                    <input value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Title"
                      className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                    <textarea value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder="Description" rows={2}
                      className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none" />
                    <div className="grid grid-cols-3 gap-2">
                      <input value={newTask.assignee} onChange={e => setNewTask(p => ({ ...p, assignee: e.target.value }))} placeholder="Assignee"
                        className="bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                      <input type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                        className="bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50" />
                      <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value as 'low' | 'medium' | 'high' }))}
                        className="bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end mt-3">
                    <button onClick={() => setShowAddTask(false)} className="px-3 py-1.5 text-white/40 hover:text-white/60 text-xs">Cancel</button>
                    <button onClick={addTask} className="btn-premium text-xs px-3 py-1.5">Create</button>
                  </div>
                </div>
              </div>
            )}

            {showAddLead && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddLead(false)}>
                <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-white mb-3">Add Lead</h3>
                  <div className="space-y-2">
                    {/* A lead has to belong to somebody. The contact list is the
                        real one from the store, so a lead cannot be filed
                        against a customer who does not exist. */}
                    <select value={newLead.contactId} onChange={e => setNewLead(p => ({ ...p, contactId: e.target.value }))}
                      className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50">
                      <option value="">Who is this lead for?</option>
                      {contacts.map(c => (
                        <option key={c.id} value={c.id} className="bg-[var(--os-surface-2)]">
                          {c.name}{c.company ? ` — ${c.company}` : ''}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min="0"
                        value={newLead.value}
                        onChange={e => setNewLead(p => ({ ...p, value: e.target.value }))}
                        placeholder="Value"
                        className="bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50"
                      />
                      <input value={newLead.source} onChange={e => setNewLead(p => ({ ...p, source: e.target.value }))}
                        placeholder="Source (referral, web...)"
                        className="bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                    </div>
                    {contacts.length === 0 && (
                      <p className="text-[10px] text-white/35">
                        Add a contact first — a lead needs someone to belong to.
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end mt-3">
                    <button onClick={() => setShowAddLead(false)} className="px-3 py-1.5 text-white/40 hover:text-white/60 text-xs">Cancel</button>
                    <button onClick={addLead} className="btn-premium text-xs px-3 py-1.5">Create</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'invoices' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/40">{invoices.length} invoices</span>
              <button onClick={() => setShowAddInvoice(true)} className="btn-premium flex items-center gap-1.5 text-xs px-3 py-1.5">
                <Plus size={12} /> Create Invoice
              </button>
            </div>

            <div className="space-y-2">
              {invoices.map(inv => (
                <div key={inv.id} className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl p-3 flex items-center gap-3 transition-all hover:border-indigo-500/30">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <FileText size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white">{inv.number ? `${inv.number} · ` : ''}{contacts.find(c => c.id === inv.contactId)?.name ?? 'Unknown contact'}</div>
                    <div className="text-[10px] text-white/30">{inv.items.length} item{inv.items.length !== 1 ? 's' : ''} · issued {Number.isFinite(inv.issuedAt) ? new Date(inv.issuedAt).toLocaleDateString() : 'date unknown'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-white">${inv.total.toLocaleString()}</div>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium capitalize ${invoiceStatusColor(inv.status)}`}>{inv.status}</span>
                  </div>
                  {inv.status !== 'paid' && (
                    <button onClick={() => markInvoicePaid(inv.id)}
                      className="px-2 py-1 rounded-lg bg-green-500/15 text-green-400 text-[10px] font-medium hover:bg-green-500/25 transition-all">
                      Mark Paid
                    </button>
                  )}
                  {/* A cancelled or mis-typed invoice previously could only be
                      hidden by setting its status, which then counted as money
                      still owed by the customer. */}
                  <button onClick={() => deleteInvoice(inv.id, inv.number)}
                    className="text-white/20 hover:text-red-400/80 flex-shrink-0" title="Delete this invoice">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {invoices.length === 0 && <div className="text-center py-12 text-white/20 text-xs">No invoices</div>}
            </div>

            {showAddInvoice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddInvoice(false)}>
                <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl w-full max-w-lg p-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-white mb-3">Create Invoice</h3>
                  <div className="space-y-3">
                    <input value={newInvoiceClient} onChange={e => setNewInvoiceClient(e.target.value)} placeholder="Client name"
                      className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />

                    <div className="space-y-2">
                      <div className="text-[10px] text-white/40">Line Items</div>
                      {newInvoiceItems.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-end">
                          <input value={item.description} onChange={e => updateInvoiceItem(idx, 'description', e.target.value)} placeholder="Description"
                            className="flex-1 bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                          <input type="number" value={item.qty} onChange={e => updateInvoiceItem(idx, 'qty', Number(e.target.value))} placeholder="Qty" min={1}
                            className="w-16 bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50" />
                          <input type="number" value={item.rate} onChange={e => updateInvoiceItem(idx, 'rate', Number(e.target.value))} placeholder="Rate" min={0}
                            className="w-24 bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50" />
                          <span className="text-[10px] text-white/30 w-16 text-right">${(item.qty * item.rate).toLocaleString()}</span>
                          {newInvoiceItems.length > 1 && (
                            <button onClick={() => removeInvoiceItem(idx)} className="text-red-400/50 hover:text-red-400"><Trash2 size={12} /></button>
                          )}
                        </div>
                      ))}
                      <button onClick={addInvoiceItemRow} className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                        <Plus size={10} /> Add item
                      </button>
                    </div>

                    <div className="border-t border-white/5 pt-2 flex items-center justify-between">
                      <span className="text-xs text-white/50">Total</span>
                      <span className="text-sm font-bold text-white">${newInvoiceItems.reduce((s, i) => s + i.qty * i.rate, 0).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end mt-3">
                    <button onClick={() => setShowAddInvoice(false)} className="px-3 py-1.5 text-white/40 hover:text-white/60 text-xs">Cancel</button>
                    <button onClick={addInvoice} className="btn-premium text-xs px-3 py-1.5">Create</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'crm' && showAddContact && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddContact(false)}>
            <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-white mb-3">Add Contact</h3>
              <div className="space-y-2">
                <input value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} placeholder="Name"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} placeholder="Email"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.company} onChange={e => setNewContact(p => ({ ...p, company: e.target.value }))} placeholder="Company"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} placeholder="Phone"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.tags} onChange={e => setNewContact(p => ({ ...p, tags: e.target.value }))} placeholder="Tags (comma separated)"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <textarea value={newContact.notes} onChange={e => setNewContact(p => ({ ...p, notes: e.target.value }))} placeholder="Notes" rows={2}
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none" />
              </div>
              <div className="flex gap-2 justify-end mt-3">
                <button onClick={() => setShowAddContact(false)} className="px-3 py-1.5 text-white/40 hover:text-white/60 text-xs">Cancel</button>
                <button onClick={addContact} className="btn-premium text-xs px-3 py-1.5">Add</button>
              </div>
            </div>
          </div>
        )}

        {tab === 'crm' && showAddDeal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddDeal(false)}>
            <div className="bg-[var(--os-surface-2)] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-white mb-3">Add Deal</h3>
              <div className="space-y-2">
                <input value={newDeal.title} onChange={e => setNewDeal(p => ({ ...p, title: e.target.value }))} placeholder="Deal title"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input type="number" value={newDeal.value} onChange={e => setNewDeal(p => ({ ...p, value: e.target.value }))} placeholder="Value ($)"
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <select value={newDeal.contactId} onChange={e => setNewDeal(p => ({ ...p, contactId: e.target.value }))}
                  className="w-full bg-[var(--os-surface)] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50">
                  <option value="">Link to contact (optional)</option>
                  {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex gap-2 justify-end mt-3">
                <button onClick={() => setShowAddDeal(false)} className="px-3 py-1.5 text-white/40 hover:text-white/60 text-xs">Cancel</button>
                <button onClick={addDeal} className="btn-premium text-xs px-3 py-1.5">Create</button>
              </div>
            </div>
          </div>
        )}

      {formModal && (
        <InputModal
          title={formModal.title}
          subtitle={formModal.subtitle}
          fields={formModal.fields}
          submitLabel={formModal.submitLabel}
          onSubmit={formModal.run}
          onClose={() => setFormModal(null)}
        />
      )}
      </div>
    </div>
  );
}


