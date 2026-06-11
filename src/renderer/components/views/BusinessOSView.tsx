import { useEffect, useState } from 'react';
import { useBusinessStore } from '../../../renderer/stores/business';
import { useNotificationStore } from '../../../renderer/stores/notifications';

export function BusinessOSView() {
  const { contacts, leads, invoices, deals, analytics, stats, loadContacts, loadLeads, loadInvoices, loadDeals, loadAnalytics, loadStats, createContact, createLead, createInvoice, createDeal } = useBusinessStore();
  const addToast = useNotificationStore((s) => s.addToast);
  const [tab, setTab] = useState<'dashboard' | 'contacts' | 'leads' | 'invoices' | 'deals'>('dashboard');
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<'contact' | 'lead' | 'invoice' | 'deal'>('contact');
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', company: '', value: '', status: 'new', amount: '' });

  useEffect(() => { loadContacts(); loadLeads(); loadInvoices(); loadDeals(); loadAnalytics(); loadStats(); }, []);

  const handleCreate = async () => {
    if (createType === 'contact') { await createContact({ name: formData.name, email: formData.email, phone: formData.phone, company: formData.company, tags: [], role: '' }); }
    else if (createType === 'lead') { await createLead({ name: formData.name, email: formData.email, status: 'new', value: Number(formData.value) || 0, source: 'manual', notes: '' }); }
    else if (createType === 'invoice') { await createInvoice({ number: `INV-${Date.now()}`, contactId: '', contactName: formData.name, amount: Number(formData.amount) || 0, status: 'draft', items: [{ description: 'Service', amount: Number(formData.amount) || 0 }] }); }
    else if (createType === 'deal') { await createDeal({ name: formData.name, contactId: '', contactName: formData.name, value: Number(formData.value) || 0, stage: 'lead', probability: 50 }); }
    setFormData({ name: '', email: '', phone: '', company: '', value: '', status: 'new', amount: '' }); setShowCreate(false);
    addToast({ type: 'success', title: `${createType} created` });
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard' }, { id: 'contacts', label: 'Contacts' },
    { id: 'leads', label: 'Leads' }, { id: 'invoices', label: 'Invoices' }, { id: 'deals', label: 'Deals' },
  ] as const;

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18-2.087.277-4.216.42-6.378.42s-4.291-.143-6.378-.42c-1.085-.144-1.872-1.086-1.872-2.18v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.114 48.114 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
            </div>
            Business OS
          </h1>
          <p className="text-textMuted text-sm mt-1">Manage contacts, leads, invoices, and deals.</p>
        </div>
        <button onClick={() => { setCreateType(tab === 'dashboard' ? 'contact' : tab === 'contacts' ? 'contact' : tab === 'leads' ? 'lead' : tab === 'invoices' ? 'invoice' : 'deal'); setShowCreate(true); }} className="btn-premium flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
          New {tab === 'dashboard' ? 'Item' : tab.slice(0, -1).charAt(0).toUpperCase() + tab.slice(1).slice(0, -1)}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-bgPanel p-1 rounded-xl w-max mb-6 border border-borderSubtle">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${tab === t.id ? 'bg-bgCard text-textMain border border-white/[0.03] shadow-sm' : 'text-textMuted hover:text-textMain'}`}>{t.label}</button>
        ))}
      </div>

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <div className="animate-fade-in">
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Contacts', value: stats?.contacts ?? contacts.length, color: 'from-blue-500 to-indigo-500' },
              { label: 'Leads', value: stats?.leads ?? leads.length, color: 'from-amber-500 to-orange-500' },
              { label: 'Invoices', value: stats?.invoices ?? invoices.length, color: 'from-purple-500 to-pink-500' },
              { label: 'Deals', value: stats?.deals ?? deals.length, color: 'from-green-500 to-emerald-500' },
            ].map((stat, i) => (
              <div key={i} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
                <div className="text-xs text-textMuted mb-1">{stat.label}</div>
                <div className="text-2xl font-bold text-textMain">{stat.value}</div>
              </div>
            ))}
          </div>
          {analytics && (
            <div className="grid grid-cols-3 gap-4">
              <div className="card-premium"><div className="text-xs text-textMuted mb-1">Total Revenue</div><div className="text-xl font-bold text-brandGreen">${analytics.totalRevenue.toLocaleString()}</div></div>
              <div className="card-premium"><div className="text-xs text-textMuted mb-1">Avg Deal Size</div><div className="text-xl font-bold text-textMain">${analytics.avgDealSize.toLocaleString()}</div></div>
              <div className="card-premium"><div className="text-xs text-textMuted mb-1">Conversion Rate</div><div className="text-xl font-bold text-indigo-400">{analytics.conversionRate}%</div></div>
            </div>
          )}
        </div>
      )}

      {/* Contacts */}
      {tab === 'contacts' && (
        <div className="space-y-2 animate-fade-in">
          {contacts.length === 0 ? <div className="text-center py-12 text-textMuted">No contacts yet</div> : contacts.map((c, i) => (
            <div key={c.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 15}ms` }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-bold text-sm">{c.name.charAt(0)}</div>
                <div className="flex-1"><div className="font-medium text-textMain">{c.name}</div><div className="text-xs text-textMuted">{c.email} {c.company ? `· ${c.company}` : ''}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Leads */}
      {tab === 'leads' && (
        <div className="space-y-2 animate-fade-in">
          {leads.length === 0 ? <div className="text-center py-12 text-textMuted">No leads yet</div> : leads.map((l, i) => (
            <div key={l.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 15}ms` }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white font-bold text-sm">{l.name.charAt(0)}</div>
                  <div><div className="font-medium text-textMain">{l.name}</div><div className="text-xs text-textMuted">${l.value.toLocaleString()}</div></div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${l.status === 'won' ? 'bg-green-500/15 text-green-400' : l.status === 'lost' ? 'bg-red-500/15 text-red-400' : 'bg-amber-500/15 text-amber-400'}`}>{l.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invoices */}
      {tab === 'invoices' && (
        <div className="space-y-2 animate-fade-in">
          {invoices.length === 0 ? <div className="text-center py-12 text-textMuted">No invoices yet</div> : invoices.map((inv, i) => (
            <div key={inv.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 15}ms` }}>
              <div className="flex items-center justify-between">
                <div><div className="font-medium text-textMain">{inv.number}</div><div className="text-xs text-textMuted">{inv.contactName}</div></div>
                <div className="text-right"><div className="font-bold text-textMain">${inv.amount.toLocaleString()}</div><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${inv.status === 'paid' ? 'bg-green-500/15 text-green-400' : inv.status === 'overdue' ? 'bg-red-500/15 text-red-400' : 'bg-gray-500/15 text-gray-400'}`}>{inv.status}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deals */}
      {tab === 'deals' && (
        <div className="space-y-2 animate-fade-in">
          {deals.length === 0 ? <div className="text-center py-12 text-textMuted">No deals yet</div> : deals.map((d, i) => (
            <div key={d.id} className="card-premium animate-slide-up" style={{ animationDelay: `${i * 15}ms` }}>
              <div className="flex items-center justify-between">
                <div><div className="font-medium text-textMain">{d.name}</div><div className="text-xs text-textMuted">${d.value.toLocaleString()} · {d.probability}% probability</div></div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-500/15 text-indigo-400">{d.stage}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="card-premium w-full max-w-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-textMain mb-3">Create {createType.charAt(0).toUpperCase() + createType.slice(1)}</h3>
            <div className="space-y-3 mb-4">
              <input value={formData.name} onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="input-premium w-full" />
              {(createType === 'contact' || createType === 'lead') && <input value={formData.email} onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))} placeholder="Email" className="input-premium w-full" />}
              {createType === 'contact' && <input value={formData.company} onChange={(e) => setFormData((p) => ({ ...p, company: e.target.value }))} placeholder="Company" className="input-premium w-full" />}
              {(createType === 'lead' || createType === 'deal') && <input value={formData.value} onChange={(e) => setFormData((p) => ({ ...p, value: e.target.value }))} placeholder="Value" type="number" className="input-premium w-full" />}
              {createType === 'invoice' && <input value={formData.amount} onChange={(e) => setFormData((p) => ({ ...p, amount: e.target.value }))} placeholder="Amount" type="number" className="input-premium w-full" />}
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-textMuted hover:text-textMain text-xs">Cancel</button>
              <button onClick={handleCreate} className="btn-premium text-xs">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
