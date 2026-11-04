import { create } from 'zustand';

export type OrgRole = 'ceo' | 'manager' | 'employee';

export interface AgentTeam {
  id: string; name: string; description: string;
  agents: string[]; members: string[];
  roles: Record<string, OrgRole>;
  leader?: string; mission?: string; parentTeamId?: string;
  status?: 'idle' | 'active' | 'paused';
  createdAt: number;
}

export interface AgentTask {
  id: string; title: string; description: string; teamId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignedTo?: string; role?: OrgRole; result?: string; createdAt: number; completedAt?: number;
}

export interface AgentMessage {
  id: string; from: string; to: string; content: string; timestamp: number;
}

export interface MultiAgentStats {
  teams?: number; tasks?: number; completedTasks?: number; activeAgents?: number;
  totalTeams?: number; totalTasks?: number; activeTeams?: number;
  pendingTasks?: number; inProgressTasks?: number; runningTasks?: number;
  failedTasks?: number; totalMessages?: number; agents?: number;
}

export interface AgentOrg {
  teams: AgentTeam[];
  roots: string[];
  totals: Record<OrgRole, number> & { teams: number; agents: number };
}

interface MultiAgentState {
  teams: AgentTeam[]; tasks: AgentTask[]; messages: AgentMessage[]; org: AgentOrg | null;
  stats: MultiAgentStats | null; loading: boolean;
  loadTeams: () => Promise<void>; loadTasks: () => Promise<void>; loadStats: () => Promise<void>;
  loadOrg: () => Promise<void>;
  createTeam: (team: { name: string; description: string; mission?: string; members?: string[]; leader?: string; roles?: Record<string, OrgRole> }) => Promise<void>;
  updateTeam: (team: { teamId: string; name?: string; description?: string; mission?: string; leader?: string; parentTeamId?: string | null }) => Promise<void>;
  addMember: (teamId: string, agentId: string, role?: OrgRole) => Promise<void>;
  removeMember: (teamId: string, agentId: string) => Promise<void>;
  setRole: (teamId: string, agentId: string, role: OrgRole) => Promise<void>;
  setLeader: (teamId: string, agentId: string) => Promise<void>;
  createTask: (task: { title: string; description: string; teamId?: string; assignTo?: string }) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  completeTask: (id: string, result: string) => Promise<void>;
  runOrgMission: (teamId: string, mission: string) => Promise<{ tasks: AgentTask[]; plan: string } | null>;
  sendMessage: (msg: { from: string; to: string; content: string }) => Promise<void>;
  getMessages: (agentId: string) => Promise<AgentMessage[]>;
}

const normalizeTeam = (team: Partial<AgentTeam> & { agents?: string[]; members?: string[] }): AgentTeam => {
  const agents = Array.isArray(team.agents) ? team.agents : Array.isArray(team.members) ? team.members : [];
  const roles: Record<string, OrgRole> = {};
  for (const agentId of agents) {
    const role = team.roles?.[agentId];
    roles[agentId] = role === 'ceo' || role === 'manager' || role === 'employee' ? role : 'employee';
  }
  return {
    id: String(team.id),
    name: team.name ?? 'Untitled team',
    description: team.description ?? '',
    agents,
    members: agents,
    roles,
    leader: team.leader,
    mission: team.mission,
    parentTeamId: team.parentTeamId,
    status: team.status,
    createdAt: Number(team.createdAt) || Date.now(),
  };
};

export const useMultiAgentStore = create<MultiAgentState>((set, get) => ({
  teams: [], tasks: [], messages: [], org: null, stats: null, loading: false,
  loadTeams: async () => {
    try {
      const teams = await window.api.multiAgentListTeams() as AgentTeam[];
      set({ teams: (teams ?? []).map(normalizeTeam) });
    } catch { /* silent */ }
  },
  loadTasks: async () => { try { set({ tasks: await window.api.multiAgentListTasks() as AgentTask[] }); } catch { /* silent */ } },
  loadStats: async () => { try { set({ stats: await window.api.multiAgentStats() as MultiAgentStats }); } catch { /* silent */ } },
  loadOrg: async () => {
    try {
      const org = await window.api.multiAgentOrg() as AgentOrg;
      set({ org, teams: (org.teams ?? []).map(normalizeTeam) });
    } catch { /* silent */ }
  },
  createTeam: async (team) => {
    await window.api.multiAgentCreateTeam(team);
    await get().loadTeams(); await get().loadStats();
  },
  updateTeam: async (team) => {
    await window.api.multiAgentUpdateTeam(team);
    await get().loadTeams();
  },
  addMember: async (teamId, agentId, role) => {
    await window.api.multiAgentAddToTeam({ teamId, agentId, role });
    await get().loadTeams();
  },
  removeMember: async (teamId, agentId) => {
    await window.api.multiAgentRemoveFromTeam({ teamId, agentId });
    await get().loadTeams();
  },
  setRole: async (teamId, agentId, role) => {
    await window.api.multiAgentSetRole({ teamId, agentId, role });
    await get().loadTeams();
  },
  setLeader: async (teamId, agentId) => {
    await window.api.multiAgentSetLeader({ teamId, agentId });
    await get().loadTeams();
  },
  createTask: async (task) => {
    await window.api.multiAgentCreateTask(task);
    await get().loadTasks(); await get().loadStats();
  },
  startTask: async (id) => { await window.api.multiAgentStartTask({ id }); await get().loadTasks(); },
  completeTask: async (id, result) => { await window.api.multiAgentCompleteTask({ id, result }); await get().loadTasks(); await get().loadStats(); },
  runOrgMission: async (teamId, mission) => {
    const result = await window.api.multiAgentRunOrgMission({ teamId, mission }) as { tasks: AgentTask[]; plan: string };
    await get().loadTasks(); await get().loadStats(); await get().loadTeams();
    return result;
  },
  sendMessage: async (msg) => { await window.api.multiAgentSendMessage(msg); },
  getMessages: async (agentId) => {
    const msgs = await window.api.multiAgentGetMessages({ agentId }) as AgentMessage[];
    set({ messages: msgs }); return msgs;
  },
}));
