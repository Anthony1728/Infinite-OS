import { create } from 'zustand';

export interface AgentTeam {
  id: string; name: string; description: string; members: string[];
  createdAt: number;
}

export interface AgentTask {
  id: string; title: string; description: string; teamId?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignedTo?: string; result?: string; createdAt: number; completedAt?: number;
}

export interface AgentMessage {
  id: string; from: string; to: string; content: string; timestamp: number;
}

export interface MultiAgentStats {
  teams: number; tasks: number; completedTasks: number; activeAgents: number;
}

interface MultiAgentState {
  teams: AgentTeam[]; tasks: AgentTask[]; messages: AgentMessage[];
  stats: MultiAgentStats | null; loading: boolean;
  loadTeams: () => Promise<void>; loadTasks: () => Promise<void>; loadStats: () => Promise<void>;
  createTeam: (team: { name: string; description: string }) => Promise<void>;
  createTask: (task: { title: string; description: string; teamId?: string; assignTo?: string }) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  completeTask: (id: string, result: string) => Promise<void>;
  sendMessage: (msg: { from: string; to: string; content: string }) => Promise<void>;
  getMessages: (agentId: string) => Promise<AgentMessage[]>;
}

export const useMultiAgentStore = create<MultiAgentState>((set, get) => ({
  teams: [], tasks: [], messages: [], stats: null, loading: false,
  loadTeams: async () => { try { set({ teams: await window.api.multiAgentListTeams() as AgentTeam[] }); } catch {} },
  loadTasks: async () => { try { set({ tasks: await window.api.multiAgentListTasks() as AgentTask[] }); } catch {} },
  loadStats: async () => { try { set({ stats: await window.api.multiAgentStats() as MultiAgentStats }); } catch {} },
  createTeam: async (team) => { await window.api.multiAgentCreateTeam(team); await get().loadTeams(); await get().loadStats(); },
  createTask: async (task) => { await window.api.multiAgentCreateTask(task); await get().loadTasks(); await get().loadStats(); },
  startTask: async (id) => { await window.api.multiAgentStartTask({ id }); await get().loadTasks(); },
  completeTask: async (id, result) => { await window.api.multiAgentCompleteTask({ id, result }); await get().loadTasks(); await get().loadStats(); },
  sendMessage: async (msg) => { await window.api.multiAgentSendMessage(msg); },
  getMessages: async (agentId) => {
    const msgs = await window.api.multiAgentGetMessages({ agentId }) as AgentMessage[];
    set({ messages: msgs }); return msgs;
  },
}));
