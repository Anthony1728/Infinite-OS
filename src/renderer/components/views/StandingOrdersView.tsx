import { useState, useEffect } from 'react';

interface StandingOrder {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  category: 'behavior' | 'safety' | 'workflow' | 'communication';
  createdAt: number;
  updatedAt: number;
}

const CATEGORIES = [
  { id: 'behavior', label: 'Behavior', color: 'text-indigo-400', bg: 'bg-indigo-500/15' },
  { id: 'safety', label: 'Safety', color: 'text-red-400', bg: 'bg-red-500/15' },
  { id: 'workflow', label: 'Workflow', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  { id: 'communication', label: 'Communication', color: 'text-amber-400', bg: 'bg-amber-500/15' },
];

const DEFAULT_ORDERS: StandingOrder[] = [
  {
    id: 'default-1',
    name: 'Always verify before committing',
    content: 'Before writing any code, always inspect the codebase for existing patterns, libraries, and conventions. Never assume a library is available without checking package.json or equivalent first.',
    enabled: true,
    category: 'workflow',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'default-2',
    name: 'No secrets in code',
    content: 'Never commit API keys, passwords, tokens, or other secrets. If a secret is found in code, flag it immediately and suggest moving it to a .env file or secrets manager.',
    enabled: true,
    category: 'safety',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'default-3',
    name: 'Concise responses',
    content: 'Keep responses short and direct. Avoid unnecessary preamble or explanation unless the user asks for detail. One word answers are best when possible.',
    enabled: true,
    category: 'communication',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

export function StandingOrdersView() {
  const [orders, setOrders] = useState<StandingOrder[]>(DEFAULT_ORDERS);
  const [showCreate, setShowCreate] = useState(false);
  const [newOrder, setNewOrder] = useState({ name: '', content: '', category: 'workflow' as const });
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('infinite-standing-orders');
    if (stored) {
      try { setOrders(JSON.parse(stored)); } catch { /* use defaults */ }
    }
  }, []);

  const saveOrders = (updated: StandingOrder[]) => {
    setOrders(updated);
    localStorage.setItem('infinite-standing-orders', JSON.stringify(updated));
  };

  const createOrder = () => {
    if (!newOrder.name.trim() || !newOrder.content.trim()) return;
    const order: StandingOrder = {
      id: `order-${Date.now()}`,
      name: newOrder.name,
      content: newOrder.content,
      enabled: true,
      category: newOrder.category,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveOrders([...orders, order]);
    setNewOrder({ name: '', content: '', category: 'workflow' });
    setShowCreate(false);
  };

  const toggleOrder = (id: string) => {
    saveOrders(orders.map((o) => o.id === id ? { ...o, enabled: !o.enabled, updatedAt: Date.now() } : o));
  };

  const deleteOrder = (id: string) => {
    saveOrders(orders.filter((o) => o.id !== id));
  };

  const updateOrder = (id: string, content: string) => {
    saveOrders(orders.map((o) => o.id === id ? { ...o, content, updatedAt: Date.now() } : o));
    setEditingId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-textMain flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
            </div>
            Standing Orders
          </h1>
          <p className="text-textMuted text-sm mt-1">Persistent instructions injected into every agent session.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-xl text-sm font-medium hover:from-purple-600 hover:to-pink-600 transition-all shadow-lg shadow-purple-500/25 flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
          New Order
        </button>
      </div>

      {/* How it works */}
      <div className="bg-gradient-to-r from-purple-500/[0.06] to-pink-500/[0.06] border border-purple-500/20 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 rounded-md bg-purple-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" /></svg>
          </div>
          <div>
            <div className="text-xs font-semibold text-purple-300 mb-1">How Standing Orders Work</div>
            <div className="text-[10px] text-textMuted leading-relaxed">
              Enabled orders are automatically injected into every new session as part of the system prompt.
              The agent reads these instructions before generating any response. Use them for safety rules,
              behavioral guidelines, workflow requirements, and communication style preferences.
            </div>
          </div>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-[#0c1018] border border-purple-500/30 rounded-xl p-5 mb-6 shadow-lg shadow-purple-500/10">
          <h3 className="text-sm font-semibold text-textMain mb-4">Create Standing Order</h3>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Order Name *</label>
            <input
              type="text"
              value={newOrder.name}
              onChange={(e) => setNewOrder((p) => ({ ...p, name: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted focus:outline-none focus:border-purple-500/50"
              placeholder="e.g. Always verify before committing"
            />
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Instructions *</label>
            <textarea
              value={newOrder.content}
              onChange={(e) => setNewOrder((p) => ({ ...p, content: e.target.value }))}
              className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-sm text-textMain placeholder-textMuted h-24 resize-none focus:outline-none focus:border-purple-500/50"
              placeholder="What should the agent always do, never do, or always remember?"
            />
          </div>
          <div className="mb-4">
            <label className="text-xs text-textMuted mb-1.5 block">Category</label>
            <div className="flex gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setNewOrder((p) => ({ ...p, category: cat.id as typeof newOrder.category }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    newOrder.category === cat.id
                      ? `${cat.bg} ${cat.color} border border-current/20`
                      : 'bg-bgCard text-textMuted border border-borderSubtle'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-textMuted hover:text-textMain text-sm rounded-lg transition-colors">Cancel</button>
            <button
              onClick={createOrder}
              disabled={!newOrder.name.trim() || !newOrder.content.trim()}
              className="px-5 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:from-purple-600 hover:to-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/20"
            >
              Create Order
            </button>
          </div>
        </div>
      )}

      {/* Orders list */}
      <div className="space-y-3">
        {orders.map((order, i) => {
          const cat = CATEGORIES.find((c) => c.id === order.category) || CATEGORIES[3];
          return (
            <div key={order.id} className="bg-[#0c1018] border border-white/[0.06] rounded-xl p-4 hover:border-purple-500/20 transition-all animate-slide-up" style={{ animationDelay: `${i * 25}ms` }}>
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg ${cat.bg} flex items-center justify-center flex-shrink-0`}>
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-textMain text-sm">{order.name}</div>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${cat.bg} ${cat.color}`}>{cat.label}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${order.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-500/15 text-gray-400'}`}>
                      {order.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  {editingId === order.id ? (
                    <div className="mt-2">
                      <textarea
                        defaultValue={order.content}
                        id={`edit-${order.id}`}
                        className="w-full bg-bgInput border border-borderSubtle rounded-lg px-3 py-2 text-xs text-textMain placeholder-textMuted h-20 resize-none focus:outline-none focus:border-purple-500/50"
                        autoFocus
                      />
                      <div className="flex gap-2 mt-1.5">
                        <button onClick={() => setEditingId(null)} className="px-2 py-1 text-[10px] text-textMuted hover:text-textMain rounded transition-colors">Cancel</button>
                        <button onClick={() => {
                          const el = document.getElementById(`edit-${order.id}`) as HTMLTextAreaElement;
                          if (el) updateOrder(order.id, el.value);
                        }} className="px-2 py-1 text-[10px] bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30 transition-colors">Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-textMuted mt-1 leading-relaxed">{order.content}</div>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => toggleOrder(order.id)} className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${order.enabled ? 'bg-green-500/15 text-green-400' : 'bg-gray-500/15 text-gray-400'}`}>
                    {order.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => setEditingId(editingId === order.id ? null : order.id)} className="px-2.5 py-1 bg-indigo-500/15 text-indigo-400 rounded-lg text-[10px] font-medium hover:bg-indigo-500/25 transition-all">
                    Edit
                  </button>
                  <button onClick={() => deleteOrder(order.id)} className="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[10px] font-medium hover:bg-red-500/20 transition-all">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
