import { useState, useEffect } from 'react';
import {
  DollarSign, Users, Handshake, ListTodo, TrendingUp, TrendingDown,
  Plus, Search, X, Send, Mail, Phone, Building2, Tag,
  CheckCircle2, Circle, Clock, FileText,
  BarChart3, ArrowUpRight, Calendar,
  Trash2, StickyNote
} from 'lucide-react';

type Tab = 'overview' | 'crm' | 'email' | 'analytics' | 'tasks' | 'invoices';

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
  stage: 'lead' | 'contact' | 'proposal' | 'negotiation' | 'won' | 'lost';
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

interface InvoiceItem {
  description: string;
  qty: number;
  rate: number;
}

interface Invoice {
  id: string;
  contactId: string;
  client: string;
  items: InvoiceItem[];
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  createdAt: number;
  dueDate: number;
}

interface Activity {
  id: string;
  text: string;
  time: number;
  type: string;
}

const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

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
  getAnalytics: () => window.api.businessAnalytics(),
  getStats: () => window.api.businessStats(),
  listEmails: () => window.api.businessListEmails(),
  saveEmail: (data: Record<string, unknown>) => window.api.businessSaveEmail(data),
  deleteEmail: (id: string) => window.api.businessDeleteEmail({ id }),
};

export function BusinessOSView() {
  const [tab, setTab] = useState<Tab>('overview');

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);

  const [contactSearch, setContactSearch] = useState('');
  const [contactTagFilter, setContactTagFilter] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', email: '', company: '', phone: '', tags: '', notes: '' });
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

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
  const [newInvoiceItems, setNewInvoiceItems] = useState<InvoiceItem[]>([{ description: '', qty: 1, rate: 0 }]);

  // Load data from backend on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        const [contactsData, invoicesData, dealsData, emailsData] = await Promise.all([
          api.listContacts(),
          api.listInvoices(),
          api.listDeals(),
          api.listEmails().catch(() => null),
        ]);
        if (contactsData) setContacts(contactsData);
        if (invoicesData) setInvoices(invoicesData);
        if (dealsData) setDeals(dealsData);
        if (emailsData) setEmails(emailsData);
      } catch (e) {
        console.error('Failed to load business data:', e);
      }
    };
    loadData();
  }, []);

  const addActivity = (text: string, type: string) => {
    setActivities(prev => [{ id: uid(), text, time: now(), type }, ...prev]);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'crm', label: 'CRM' },
    { id: 'email', label: 'Email' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'invoices', label: 'Invoices' },
  ];

  const revenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.total, 0);
  const activeDeals = deals.filter(d => !['won', 'lost'].includes(d.stage)).length;
  const pendingTasks = tasks.filter(t => t.status !== 'done').length;

  const filteredContacts = contacts.filter(c => {
    const matchSearch = !contactSearch || c.name.toLowerCase().includes(contactSearch.toLowerCase()) || c.email.toLowerCase().includes(contactSearch.toLowerCase()) || c.company.toLowerCase().includes(contactSearch.toLowerCase());
    const matchTag = !contactTagFilter || c.tags.some(t => t.toLowerCase().includes(contactTagFilter.toLowerCase()));
    return matchSearch && matchTag;
  });

  const pipelineStages: { id: Deal['stage']; label: string; color: string }[] = [
    { id: 'lead', label: 'Lead', color: 'from-slate-500 to-slate-600' },
    { id: 'contact', label: 'Contact', color: 'from-blue-500 to-blue-600' },
    { id: 'proposal', label: 'Proposal', color: 'from-amber-500 to-amber-600' },
    { id: 'negotiation', label: 'Negotiation', color: 'from-purple-500 to-purple-600' },
    { id: 'won', label: 'Won', color: 'from-green-500 to-emerald-600' },
    { id: 'lost', label: 'Lost', color: 'from-red-500 to-red-600' },
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

  const sendEmail = async () => {
    if (!emailTo || !emailSubject) return;
    try {
      const saved = (await api.saveEmail({ from: 'me', to: emailTo, subject: emailSubject, body: emailBody })) as Email;
      setEmails(prev => [saved, ...prev.filter(e => e.id !== saved.id)]);
    } catch (e) {
      console.error('Failed to save email:', e);
      const fallback: Email = {
        id: uid(), from: 'me', to: emailTo, subject: emailSubject,
        body: emailBody, preview: emailBody.slice(0, 80), time: now(), read: true,
      };
      setEmails(prev => [fallback, ...prev]);
    }
    setEmailTo(''); setEmailSubject(''); setEmailBody('');
    addActivity(`Email sent to ${emailTo}`, 'email');
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

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== id) return t;
      const next = t.status === 'done' ? 'todo' : 'done';
      return { ...t, status: next };
    }));
  };

  const addTask = () => {
    if (!newTask.title) return;
    const t: Task = {
      id: uid(), title: newTask.title, description: newTask.description,
      assignee: newTask.assignee, dueDate: newTask.dueDate,
      priority: newTask.priority, status: 'todo', createdAt: now(),
    };
    setTasks(prev => [...prev, t]);
    setNewTask({ title: '', description: '', assignee: '', dueDate: '', priority: 'medium' });
    setShowAddTask(false);
    addActivity(`Task created: ${t.title}`, 'task');
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
      addActivity(`Invoice created for ${inv.client}`, 'invoice');
    } catch (e) {
      console.error('Failed to create invoice:', e);
    }
  };

  const markInvoicePaid = async (id: string) => {
    try {
      await api.updateInvoiceStatus(id, 'paid');
      setInvoices(prev => prev.map(i => i.id === id ? { ...i, status: 'paid' as const } : i));
    } catch (e) {
      console.error('Failed to update invoice:', e);
    }
  };

  const addInvoiceItemRow = () => {
    setNewInvoiceItems(prev => [...prev, { description: '', qty: 1, rate: 0 }]);
  };

  const updateInvoiceItem = (idx: number, field: keyof InvoiceItem, val: string | number) => {
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

  const revenueData = barData(Array.from({ length: 6 }, () => Math.floor(revenue / 6)));
  const customerData = barData(Array.from({ length: 6 }, () => Math.floor(contacts.length / 6)));
  const dealConvData = barData([
    deals.filter(d => d.stage === 'lead').length,
    deals.filter(d => d.stage === 'contact').length,
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
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      <div className="flex-shrink-0 p-4 border-b border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center">
              <BarChart3 size={18} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-white">Business Command Center</h1>
          </div>
        </div>
        <div className="flex gap-1 bg-[#14141a] p-1 rounded-xl w-max border border-white/10">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === t.id ? 'bg-[#0a0a0f] text-white border border-white/5 shadow-sm' : 'text-white/50 hover:text-white/80'}`}>
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
                { label: 'Revenue', value: `$${revenue.toLocaleString()}`, icon: DollarSign, gradient: 'from-emerald-500 to-teal-500', trend: 'up' },
                { label: 'Customers', value: String(contacts.length), icon: Users, gradient: 'from-blue-500 to-indigo-500', trend: 'up' },
                { label: 'Active Deals', value: String(activeDeals), icon: Handshake, gradient: 'from-amber-500 to-orange-500', trend: 'neutral' },
                { label: 'Pending Tasks', value: String(pendingTasks), icon: ListTodo, gradient: 'from-purple-500 to-pink-500', trend: 'down' },
              ].map((kpi, i) => (
                <div key={i} className="bg-[#14141a] border border-white/10 rounded-2xl p-4 transition-all duration-300 hover:border-indigo-500/30 hover:shadow-lg hover:shadow-black/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${kpi.gradient} flex items-center justify-center`}>
                      <kpi.icon size={14} className="text-white" />
                    </div>
                    {kpi.trend === 'up' && <TrendingUp size={14} className="text-green-400" />}
                    {kpi.trend === 'down' && <TrendingDown size={14} className="text-red-400" />}
                    {kpi.trend === 'neutral' && <ArrowUpRight size={14} className="text-amber-400" />}
                  </div>
                  <div className="text-xl font-bold text-white">{kpi.value}</div>
                  <div className="text-[11px] text-white/40">{kpi.label}</div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4">
                <h3 className="text-sm font-medium text-white/70 mb-3">Recent Activity</h3>
                {activities.length === 0 ? (
                  <div className="text-center py-8 text-white/30 text-xs">No activity yet</div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {activities.slice(0, 10).map(a => (
                      <div key={a.id} className="flex items-center gap-2 text-xs">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        <span className="text-white/60 flex-1">{a.text}</span>
                        <span className="text-white/25">{new Date(a.time).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4">
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
              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-white/70">Contacts</span>
                  <button onClick={() => setShowAddContact(true)} className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center hover:bg-indigo-500/30 transition-all">
                    <Plus size={12} />
                  </button>
                </div>
                <div className="relative mb-2">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
                  <input value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Search contacts..."
                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                </div>
                <input value={contactTagFilter} onChange={e => setContactTagFilter(e.target.value)} placeholder="Filter by tag..."
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 mb-2" />
                <div className="space-y-1 max-h-[calc(100vh-320px)] overflow-y-auto">
                  {filteredContacts.map(c => (
                    <button key={c.id} onClick={() => setSelectedContact(c)}
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
                <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4">
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
                    <button onClick={() => setSelectedContact(null)} className="text-white/30 hover:text-white/60">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="flex items-center gap-2 text-xs"><Mail size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.email || 'â€”'}</span></div>
                    <div className="flex items-center gap-2 text-xs"><Phone size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.phone || 'â€”'}</span></div>
                    <div className="flex items-center gap-2 text-xs"><Building2 size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.company || 'â€”'}</span></div>
                    <div className="flex items-center gap-2 text-xs"><Tag size={12} className="text-white/30" /><span className="text-white/60">{selectedContact.tags.join(', ') || 'â€”'}</span></div>
                  </div>
                  <div className="border-t border-white/5 pt-3">
                    <div className="flex items-center gap-1.5 mb-1"><StickyNote size={12} className="text-white/30" /><span className="text-xs text-white/40">Notes</span></div>
                    <p className="text-xs text-white/50">{selectedContact.notes || 'No notes'}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4 flex items-center justify-center text-white/20 text-xs h-24">
                  Select a contact to view details
                </div>
              )}

              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4 flex-1">
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
                            className="p-2 rounded-lg bg-[#0a0a0f] border border-white/5 cursor-grab hover:border-white/15 transition-all text-xs">
                            <div className="font-medium text-white truncate">{d.title}</div>
                            <div className="text-[10px] text-white/30">${d.value.toLocaleString()}</div>
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
              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-3 flex-1">
                <div className="text-xs font-medium text-white/70 mb-2">Inbox</div>
                <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {emails.map(e => (
                    <button key={e.id} onClick={() => { setSelectedEmail({ ...e, read: true }); setEmails(prev => prev.map(em => em.id === e.id ? { ...em, read: true } : em)); void api.saveEmail({ id: e.id, from: e.from, to: e.to, subject: e.subject, body: e.body, read: true }).catch(() => undefined); }}
                      className={`w-full text-left p-2 rounded-xl transition-all ${selectedEmail?.id === e.id ? 'bg-indigo-500/15 border border-indigo-500/30' : 'hover:bg-white/5 border border-transparent'}`}>
                      <div className="flex items-center gap-1.5">
                        {!e.read && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />}
                        <span className="text-xs font-medium text-white truncate">{e.from}</span>
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
              <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4">
                <div className="text-xs font-medium text-white/70 mb-3">Compose</div>
                <div className="space-y-2">
                  <input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="To"
                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                  <input value={emailSubject} onChange={e => setEmailSubject(e.target.value)} placeholder="Subject"
                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                  <textarea value={emailBody} onChange={e => setEmailBody(e.target.value)} placeholder="Body" rows={4}
                    className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none" />
                  <button onClick={sendEmail} className="btn-premium flex items-center gap-1.5 text-xs px-4 py-2">
                    <Send size={12} /> Send
                  </button>
                </div>
              </div>

              {selectedEmail && (
                <div className="bg-[#14141a] border border-white/10 rounded-2xl p-4 flex-1">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{selectedEmail.subject}</div>
                      <div className="text-[10px] text-white/30 mt-0.5">From: {selectedEmail.from} Â· To: {selectedEmail.to}</div>
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
            <div className="flex gap-1 bg-[#14141a] p-1 rounded-xl w-max border border-white/10">
              {(['7d', '30d', '90d', '1y'] as const).map(r => (
                <button key={r} onClick={() => setAnalyticsRange(r)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-medium ${analyticsRange === r ? 'bg-[#0a0a0f] text-white' : 'text-white/40 hover:text-white/60'}`}>
                  {r.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { title: 'Revenue Over Time', data: revenueData, color: 'bg-emerald-500', labels: ['6m ago','5m','4m','3m','2m','Now'] },
                { title: 'Customer Growth', data: customerData, color: 'bg-blue-500', labels: ['6m ago','5m','4m','3m','2m','Now'] },
                { title: 'Deal Conversion', data: dealConvData, color: 'bg-amber-500', labels: ['Lead','Contact','Proposal','Negotiation'] },
                { title: 'Task Completion', data: taskCompData, color: 'bg-purple-500', labels: ['Done','In Progress','Todo'] },
              ].map((chart, ci) => (
                <div key={ci} className="bg-[#14141a] border border-white/10 rounded-2xl p-4">
                  <div className="text-xs font-medium text-white/70 mb-3">{chart.title}</div>
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
                </div>
              ))}
            </div>
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
                <div key={t.id} className="bg-[#14141a] border border-white/10 rounded-2xl p-3 flex items-center gap-3 transition-all hover:border-indigo-500/30">
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
                </div>
              ))}
              {filteredTasks.length === 0 && <div className="text-center py-12 text-white/20 text-xs">No tasks</div>}
            </div>

            {showAddTask && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddTask(false)}>
                <div className="bg-[#14141a] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-white mb-3">Add Task</h3>
                  <div className="space-y-2">
                    <input value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} placeholder="Title"
                      className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                    <textarea value={newTask.description} onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))} placeholder="Description" rows={2}
                      className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none" />
                    <div className="grid grid-cols-3 gap-2">
                      <input value={newTask.assignee} onChange={e => setNewTask(p => ({ ...p, assignee: e.target.value }))} placeholder="Assignee"
                        className="bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                      <input type="date" value={newTask.dueDate} onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                        className="bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50" />
                      <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value as 'low' | 'medium' | 'high' }))}
                        className="bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50">
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
                <div key={inv.id} className="bg-[#14141a] border border-white/10 rounded-2xl p-3 flex items-center gap-3 transition-all hover:border-indigo-500/30">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <FileText size={14} className="text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white">{inv.client}</div>
                    <div className="text-[10px] text-white/30">{inv.items.length} item{inv.items.length !== 1 ? 's' : ''} Â· {new Date(inv.createdAt).toLocaleDateString()}</div>
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
                </div>
              ))}
              {invoices.length === 0 && <div className="text-center py-12 text-white/20 text-xs">No invoices</div>}
            </div>

            {showAddInvoice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddInvoice(false)}>
                <div className="bg-[#14141a] border border-white/10 rounded-2xl w-full max-w-lg p-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h3 className="text-sm font-semibold text-white mb-3">Create Invoice</h3>
                  <div className="space-y-3">
                    <input value={newInvoiceClient} onChange={e => setNewInvoiceClient(e.target.value)} placeholder="Client name"
                      className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />

                    <div className="space-y-2">
                      <div className="text-[10px] text-white/40">Line Items</div>
                      {newInvoiceItems.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-end">
                          <input value={item.description} onChange={e => updateInvoiceItem(idx, 'description', e.target.value)} placeholder="Description"
                            className="flex-1 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                          <input type="number" value={item.qty} onChange={e => updateInvoiceItem(idx, 'qty', Number(e.target.value))} placeholder="Qty" min={1}
                            className="w-16 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50" />
                          <input type="number" value={item.rate} onChange={e => updateInvoiceItem(idx, 'rate', Number(e.target.value))} placeholder="Rate" min={0}
                            className="w-24 bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50" />
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
            <div className="bg-[#14141a] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-white mb-3">Add Contact</h3>
              <div className="space-y-2">
                <input value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} placeholder="Name"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} placeholder="Email"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.company} onChange={e => setNewContact(p => ({ ...p, company: e.target.value }))} placeholder="Company"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} placeholder="Phone"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input value={newContact.tags} onChange={e => setNewContact(p => ({ ...p, tags: e.target.value }))} placeholder="Tags (comma separated)"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <textarea value={newContact.notes} onChange={e => setNewContact(p => ({ ...p, notes: e.target.value }))} placeholder="Notes" rows={2}
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50 resize-none" />
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
            <div className="bg-[#14141a] border border-white/10 rounded-2xl w-full max-w-md p-4" onClick={e => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-white mb-3">Add Deal</h3>
              <div className="space-y-2">
                <input value={newDeal.title} onChange={e => setNewDeal(p => ({ ...p, title: e.target.value }))} placeholder="Deal title"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <input type="number" value={newDeal.value} onChange={e => setNewDeal(p => ({ ...p, value: e.target.value }))} placeholder="Value ($)"
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-indigo-500/50" />
                <select value={newDeal.contactId} onChange={e => setNewDeal(p => ({ ...p, contactId: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-indigo-500/50">
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
      </div>
    </div>
  );
}


