import { useState, useEffect } from 'react';
import { FolderOpen, Plus, Trash2, Download, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  lastActive: number;
}

interface TeamProject {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  members: string[];
  visibility: string;
}

export function EnterpriseView() {
  const [tab, setTab] = useState<'company' | 'members' | 'projects' | 'audit' | 'compliance'>('company');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<TeamProject[]>([]);
  const [auditLog, setAuditLog] = useState<Array<{ id: string; action: string; userId: string; timestamp: number; details?: string; resource?: string }>>([]);
  const [complianceRules, setComplianceRules] = useState<Array<{ id: string; name: string; description: string; category: string; severity: string; check: string; status?: string }>>([]);
  const [complianceStatus, setComplianceStatus] = useState({ total: 0, compliant: 0, nonCompliant: 0, unknown: 0 });
  const [showAddMember, setShowAddMember] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('developer');
  const [showAddProject, setShowAddProject] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [showAddRule, setShowAddRule] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleCategory, setRuleCategory] = useState('security');
  const [ruleSeverity, setRuleSeverity] = useState('medium');
  const [ruleCheck, setRuleCheck] = useState('');

  // Company board (shared with the agent's EnterpriseCompany tool)
  const [company, setCompany] = useState<{ name: string; industry: string; website: string; notes: Array<{ id: string; kind: string; text: string; by: string; createdAt: number }> }>({ name: '', industry: '', website: '', notes: [] });
  const [companyForm, setCompanyForm] = useState({ name: '', industry: '', website: '' });
  const [noteText, setNoteText] = useState('');
  const [noteKind, setNoteKind] = useState('note');

  const loadCompany = async () => {
    try {
      const c = await window.api.enterpriseCompanyGet();
      setCompany({ name: c.name ?? '', industry: c.industry ?? '', website: c.website ?? '', notes: Array.isArray(c.notes) ? c.notes : [] });
      setCompanyForm({ name: c.name ?? '', industry: c.industry ?? '', website: c.website ?? '' });
    } catch { /* board starts empty */ }
  };

  const saveCompany = async () => {
    await window.api.enterpriseCompanyUpdate(companyForm);
    loadCompany();
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    await window.api.enterpriseCompanyAddNote({ text: noteText.trim(), kind: noteKind });
    setNoteText('');
    loadCompany();
  };

  const removeNote = async (id: string) => {
    await window.api.enterpriseCompanyDeleteNote({ id });
    loadCompany();
  };

  useEffect(() => { loadAll(); loadCompany(); }, []);

  const loadAll = async () => {
    try { setMembers(await window.api.enterpriseListMembers()); } catch { /* silent */ }
    try { setProjects(await window.api.enterpriseListProjects()); } catch { /* silent */ }
    try { setAuditLog(await window.api.enterpriseAuditLog()); } catch { /* silent */ }
    try { setComplianceRules(await window.api.enterpriseComplianceRules()); } catch { /* silent */ }
    try { setComplianceStatus(await window.api.enterpriseComplianceStatus()); } catch { /* silent */ }
  };

  const addMember = async () => {
    if (!newName || !newEmail) return;
    await window.api.enterpriseAddMember({ name: newName, email: newEmail, role: newRole });
    setShowAddMember(false);
    setNewName('');
    setNewEmail('');
    loadAll();
  };

  const removeMember = async (id: string) => {
    await window.api.enterpriseRemoveMember({ id });
    loadAll();
  };

  const updateRole = async (id: string, role: string) => {
    await window.api.enterpriseUpdateRole({ id, role });
    loadAll();
  };

  const addProject = async () => {
    if (!projName || !members[0]) return;
    await window.api.enterpriseCreateProject({ name: projName, ownerId: members[0].id, description: projDesc });
    setShowAddProject(false);
    setProjName('');
    setProjDesc('');
    loadAll();
  };

  const addComplianceRule = async () => {
    if (!ruleName) return;
    await window.api.enterpriseAddComplianceRule({
      name: ruleName, description: ruleDesc, category: ruleCategory, severity: ruleSeverity, check: ruleCheck,
    });
    setShowAddRule(false);
    setRuleName('');
    setRuleDesc('');
    setRuleCheck('');
    loadAll();
  };

  const exportAudit = async () => {
    const data = await window.api.enterpriseExportAudit();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const roleColor = (role: string) => {
    switch (role) {
      case 'owner': return 'text-purple-400';
      case 'admin': return 'text-blue-400';
      case 'developer': return 'text-green-400';
      default: return 'text-[var(--text-secondary)]';
    }
  };

  const complianceColor = (status: string) => {
    switch (status) {
      case 'compliant': return <CheckCircle2 size={14} className="text-green-400" />;
      case 'non-compliant': return <XCircle size={14} className="text-red-400" />;
      default: return <AlertTriangle size={14} className="text-yellow-400" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      <div className="p-3 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Enterprise</h2>
        </div>
        <div className="flex gap-1">
          {(['company', 'members', 'projects', 'audit', 'compliance'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded text-sm capitalize ${
                tab === t ? 'bg-[var(--accent)] text-white' : 'hover:bg-[var(--bg-tertiary)]'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'company' && (
          <div className="space-y-4 max-w-2xl">
            <div className="p-3 bg-[var(--bg-secondary)] rounded space-y-2">
              <h3 className="text-sm font-medium">Company profile</h3>
              <p className="text-xs text-[var(--text-secondary)]">Infinite AI reads and updates this — tell it about your company once and it works with it everywhere.</p>
              <input value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                placeholder="Company name" className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
              <input value={companyForm.industry} onChange={(e) => setCompanyForm({ ...companyForm, industry: e.target.value })}
                placeholder="Industry (e.g. plumbing, salon, logistics)" className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
              <input value={companyForm.website} onChange={(e) => setCompanyForm({ ...companyForm, website: e.target.value })}
                placeholder="Website (optional)" className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
              <button onClick={saveCompany} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Save profile</button>
            </div>
            <div className="p-3 bg-[var(--bg-secondary)] rounded space-y-2">
              <h3 className="text-sm font-medium">Board ({company.notes.length})</h3>
              <div className="flex gap-2">
                <input value={noteText} onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                  placeholder="Add a note, complaint, decision, contact…" className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)}
                  className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm">
                  <option value="note">note</option>
                  <option value="complaint">complaint</option>
                  <option value="decision">decision</option>
                  <option value="contact">contact</option>
                </select>
                <button onClick={addNote} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Add</button>
              </div>
              <div className="space-y-2">
                {company.notes.map((n) => (
                  <div key={n.id} className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-px rounded bg-[var(--bg-tertiary)]">{n.kind}</span>
                      <span className="text-[10px] text-[var(--text-secondary)]">{n.by === 'agent' ? 'added by Infinite AI' : 'added by you'}</span>
                      <span className="ml-auto text-[10px] text-[var(--text-secondary)]">{new Date(n.createdAt).toLocaleString()}</span>
                      <button onClick={() => removeNote(n.id)} className="text-[var(--text-secondary)] hover:text-red-400"><Trash2 size={12} /></button>
                    </div>
                    <p className="text-sm">{n.text}</p>
                  </div>
                ))}
                {company.notes.length === 0 && <p className="text-xs text-[var(--text-secondary)]">Nothing on the board yet.</p>}
              </div>
            </div>
          </div>
        )}
        {tab === 'members' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Team Members ({members.length})</h3>
              <button onClick={() => setShowAddMember(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">
                <Plus size={14} /> Add Member
              </button>
            </div>
            {showAddMember && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded mb-4 space-y-2">
                <div className="flex gap-2">
                  <input type="text" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)}
                    className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                  <input type="email" placeholder="Email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                    className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                    className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm">
                    <option value="developer">Developer</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={addMember} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Add</button>
                  <button onClick={() => setShowAddMember(false)} className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded">
                  <div>
                    <span className="text-sm font-medium">{m.name}</span>
                    <span className="text-xs text-[var(--text-secondary)] ml-2">{m.email}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <select value={m.role} onChange={(e) => updateRole(m.id, e.target.value)}
                      className={`p-1 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-xs ${roleColor(m.role)}`}>
                      <option value="owner">Owner</option>
                      <option value="admin">Admin</option>
                      <option value="developer">Developer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button onClick={() => removeMember(m.id)} className="text-[var(--text-secondary)] hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'projects' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Projects ({projects.length})</h3>
              <button onClick={() => setShowAddProject(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">
                <Plus size={14} /> New Project
              </button>
            </div>
            {showAddProject && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded mb-4 space-y-2">
                <div className="flex gap-2">
                  <input type="text" placeholder="Project name" value={projName} onChange={(e) => setProjName(e.target.value)}
                    className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                  <input type="text" placeholder="Description" value={projDesc} onChange={(e) => setProjDesc(e.target.value)}
                    className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={addProject} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Create</button>
                  <button onClick={() => setShowAddProject(false)} className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {projects.map((p) => (
                <div key={p.id} className="p-3 bg-[var(--bg-secondary)] rounded">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FolderOpen size={14} className="text-[var(--accent)]" />
                      <span className="text-sm font-medium">{p.name}</span>
                    </div>
                    <span className="text-xs text-[var(--text-secondary)]">{p.members.length} members</span>
                  </div>
                  {p.description && <p className="text-xs text-[var(--text-secondary)] mt-1">{p.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Audit Log ({auditLog.length})</h3>
              <button onClick={exportAudit}
                className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">
                <Download size={14} /> Export
              </button>
            </div>
            <div className="space-y-1">
              {auditLog.slice().reverse().slice(0, 100).map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-2 bg-[var(--bg-secondary)] rounded text-sm">
                  <span className="text-[var(--text-secondary)] text-xs w-32">
                    {new Date(e.timestamp).toLocaleString()}
                  </span>
                  <span className="font-mono text-[var(--accent)] w-32">{e.action}</span>
                  <span className="text-[var(--text-secondary)]">{e.resource}</span>
                  <span className="flex-1 truncate">{JSON.stringify(e.details)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'compliance' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium">Compliance Rules</h3>
              <div className="flex gap-2">
                <div className="flex gap-2 text-sm">
                  <span className="text-green-400">{complianceStatus.compliant} compliant</span>
                  <span className="text-red-400">{complianceStatus.nonCompliant} non-compliant</span>
                  <span className="text-yellow-400">{complianceStatus.unknown} unknown</span>
                </div>
                <button onClick={() => setShowAddRule(true)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">
                  <Plus size={14} /> Add Rule
                </button>
              </div>
            </div>
            {showAddRule && (
              <div className="p-3 bg-[var(--bg-secondary)] rounded mb-4 space-y-2">
                <div className="flex gap-2">
                  <input type="text" placeholder="Rule name" value={ruleName} onChange={(e) => setRuleName(e.target.value)}
                    className="flex-1 p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                  <select value={ruleCategory} onChange={(e) => setRuleCategory(e.target.value)}
                    className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm">
                    <option value="security">Security</option>
                    <option value="privacy">Privacy</option>
                    <option value="data-retention">Data Retention</option>
                    <option value="access-control">Access Control</option>
                    <option value="encryption">Encryption</option>
                  </select>
                  <select value={ruleSeverity} onChange={(e) => setRuleSeverity(e.target.value)}
                    className="p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm">
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <input type="text" placeholder="Description" value={ruleDesc} onChange={(e) => setRuleDesc(e.target.value)}
                  className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm" />
                <textarea placeholder="Check logic description" value={ruleCheck} onChange={(e) => setRuleCheck(e.target.value)}
                  className="w-full p-2 rounded bg-[var(--bg-primary)] border border-[var(--border)] text-sm h-16 resize-none" />
                <div className="flex gap-2">
                  <button onClick={addComplianceRule} className="px-3 py-1.5 rounded bg-[var(--accent)] text-white text-sm">Add</button>
                  <button onClick={() => setShowAddRule(false)} className="px-3 py-1.5 rounded bg-[var(--bg-tertiary)] text-sm">Cancel</button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {complianceRules.map((r) => (
                <div key={r.id} className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded">
                  {complianceColor(r.status || 'unknown')}
                  <div className="flex-1">
                    <span className="text-sm font-medium">{r.name}</span>
                    <span className="text-xs text-[var(--text-secondary)] ml-2">{r.category}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    r.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                    r.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    r.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                  }`}>{r.severity}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

