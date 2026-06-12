import { EventEmitter } from 'events';
import log from 'electron-log';
import { v4 as uuidv4 } from 'uuid';

export interface CallRecord {
  id: string;
  callerId: string;
  callerName?: string;
  direction: 'inbound' | 'outbound';
  status: 'ringing' | 'active' | 'hold' | 'ended' | 'missed' | 'voicemail';
  startTime: number;
  endTime?: number;
  duration?: number;
  recording?: string;
  transcript?: string;
  notes?: string;
  tags: string[];
  agentId?: string;
  queueName?: string;
  disposition?: string;
  createdAt: number;
}

export interface CallQueue {
  id: string;
  name: string;
  maxWaitTime: number;
  currentCalls: string[];
  waitlist: string[];
  priority: number;
  enabled: boolean;
  createdAt: number;
}

export interface CallAgent {
  id: string;
  name: string;
  status: 'available' | 'busy' | 'away' | 'offline';
  currentCallId?: string;
  skills: string[];
  maxConcurrent: number;
  totalCalls: number;
  avgHandleTime: number;
  satisfaction: number;
  createdAt: number;
}

export interface CallAnalytics {
  totalCalls: number;
  answeredCalls: number;
  missedCalls: number;
  avgWaitTime: number;
  avgHandleTime: number;
  avgSatisfaction: number;
  callsByHour: number[];
  callsByDay: number[];
  topDispositions: Array<{ disposition: string; count: number }>;
  agentPerformance: Array<{ agentId: string; calls: number; avgHandle: number; satisfaction: number }>;
}

export interface CallTemplate {
  id: string;
  name: string;
  greeting: string;
  prompts: string[];
  transferTo?: string;
  voicemailEnabled: boolean;
  maxDuration: number;
  createdAt: number;
}

class CallCenterSystem extends EventEmitter {
  private calls: Map<string, CallRecord> = new Map();
  private queues: Map<string, CallQueue> = new Map();
  private agents: Map<string, CallAgent> = new Map();
  private templates: Map<string, CallTemplate> = new Map();

  createCall(callerId: string, direction: CallRecord['direction'], options: Partial<CallRecord> = {}): CallRecord {
    const call: CallRecord = {
      id: uuidv4(),
      callerId,
      direction,
      status: 'ringing',
      startTime: Date.now(),
      tags: [],
      ...options,
      createdAt: Date.now(),
    };
    this.calls.set(call.id, call);
    this.emit('callCreated', call);
    return call;
  }

  answerCall(callId: string, agentId?: string): boolean {
    const call = this.calls.get(callId);
    if (!call || call.status !== 'ringing') return false;
    call.status = 'active';
    call.agentId = agentId;
    call.startTime = Date.now();
    this.emit('callAnswered', call);
    return true;
  }

  holdCall(callId: string): boolean {
    const call = this.calls.get(callId);
    if (!call || call.status !== 'active') return false;
    call.status = 'hold';
    this.emit('callHold', call);
    return true;
  }

  resumeCall(callId: string): boolean {
    const call = this.calls.get(callId);
    if (!call || call.status !== 'hold') return false;
    call.status = 'active';
    this.emit('callResumed', call);
    return true;
  }

  endCall(callId: string, disposition?: string, notes?: string): boolean {
    const call = this.calls.get(callId);
    if (!call || (call.status !== 'active' && call.status !== 'hold')) return false;
    call.status = 'ended';
    call.endTime = Date.now();
    call.duration = call.endTime - call.startTime;
    call.disposition = disposition;
    call.notes = notes;
    this.emit('callEnded', call);
    return true;
  }

  missCall(callId: string): boolean {
    const call = this.calls.get(callId);
    if (!call || call.status !== 'ringing') return false;
    call.status = 'missed';
    call.endTime = Date.now();
    this.emit('callMissed', call);
    return true;
  }

  getCall(id: string): CallRecord | undefined {
    return this.calls.get(id);
  }

  listCalls(filters?: { status?: string; direction?: string; since?: number }): CallRecord[] {
    let calls = Array.from(this.calls.values());
    if (filters?.status) calls = calls.filter((c) => c.status === filters.status);
    if (filters?.direction) calls = calls.filter((c) => c.direction === filters.direction);
    if (filters?.since) calls = calls.filter((c) => c.createdAt >= filters.since);
    return calls.sort((a, b) => b.createdAt - a.createdAt);
  }

  updateCallTags(callId: string, tags: string[]): void {
    const call = this.calls.get(callId);
    if (call) call.tags = tags;
  }

  createQueue(name: string, maxWaitTime = 300, priority = 0): CallQueue {
    const queue: CallQueue = {
      id: uuidv4(),
      name,
      maxWaitTime,
      currentCalls: [],
      waitlist: [],
      priority,
      enabled: true,
      createdAt: Date.now(),
    };
    this.queues.set(queue.id, queue);
    return queue;
  }

  getQueue(id: string): CallQueue | undefined {
    return this.queues.get(id);
  }

  listQueues(): CallQueue[] {
    return Array.from(this.queues.values());
  }

  addToQueue(queueId: string, callId: string): boolean {
    const queue = this.queues.get(queueId);
    if (!queue || !queue.enabled) return false;
    queue.waitlist.push(callId);
    this.emit('callQueued', { queueId, callId });
    return true;
  }

  removeFromQueue(queueId: string, callId: string): boolean {
    const queue = this.queues.get(queueId);
    if (!queue) return false;
    queue.waitlist = queue.waitlist.filter((id) => id !== callId);
    return true;
  }

  createAgent(name: string, skills: string[] = [], maxConcurrent = 1): CallAgent {
    const agent: CallAgent = {
      id: uuidv4(),
      name,
      status: 'available',
      skills,
      maxConcurrent,
      totalCalls: 0,
      avgHandleTime: 0,
      satisfaction: 5.0,
      createdAt: Date.now(),
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  getAgent(id: string): CallAgent | undefined {
    return this.agents.get(id);
  }

  listAgents(): CallAgent[] {
    return Array.from(this.agents.values());
  }

  updateAgentStatus(agentId: string, status: CallAgent['status']): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.status = status;
    this.emit('agentStatusChanged', { agentId, status });
    return true;
  }

  assignCall(agentId: string, callId: string): boolean {
    const agent = this.agents.get(agentId);
    const call = this.calls.get(callId);
    if (!agent || !call) return false;
    if (agent.status !== 'available') return false;
    call.agentId = agentId;
    call.status = 'active';
    agent.currentCallId = callId;
    agent.status = 'busy';
    this.emit('callAssigned', { agentId, callId });
    return true;
  }

  createTemplate(name: string, greeting: string, prompts: string[] = []): CallTemplate {
    const template: CallTemplate = {
      id: uuidv4(),
      name,
      greeting,
      prompts,
      voicemailEnabled: true,
      maxDuration: 600,
      createdAt: Date.now(),
    };
    this.templates.set(template.id, template);
    return template;
  }

  listTemplates(): CallTemplate[] {
    return Array.from(this.templates.values());
  }

  getAnalytics(since?: number): CallAnalytics {
    let calls = Array.from(this.calls.values());
    if (since) calls = calls.filter((c) => c.createdAt >= since);

    const totalCalls = calls.length;
    const answeredCalls = calls.filter((c) => c.status === 'ended').length;
    const missedCalls = calls.filter((c) => c.status === 'missed').length;

    const durations = calls.filter((c) => c.duration).map((c) => c.duration!);
    const avgHandleTime = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    const callsByHour = new Array(24).fill(0);
    calls.forEach((c) => {
      const hour = new Date(c.createdAt).getHours();
      callsByHour[hour]++;
    });

    const callsByDay = new Array(7).fill(0);
    calls.forEach((c) => {
      const day = new Date(c.createdAt).getDay();
      callsByDay[day]++;
    });

    const dispositionCounts = new Map<string, number>();
    calls.forEach((c) => {
      if (c.disposition) {
        dispositionCounts.set(c.disposition, (dispositionCounts.get(c.disposition) || 0) + 1);
      }
    });
    const topDispositions = Array.from(dispositionCounts.entries())
      .map(([disposition, count]) => ({ disposition, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const agentPerf = new Map<string, { calls: number; totalHandle: number; totalSat: number }>();
    calls.forEach((c) => {
      if (c.agentId) {
        const existing = agentPerf.get(c.agentId) || { calls: 0, totalHandle: 0, totalSat: 0 };
        existing.calls++;
        if (c.duration) existing.totalHandle += c.duration;
        agentPerf.set(c.agentId, existing);
      }
    });

    const agentPerformance = Array.from(agentPerf.entries()).map(([agentId, data]) => ({
      agentId,
      calls: data.calls,
      avgHandle: data.calls ? data.totalHandle / data.calls : 0,
      satisfaction: 4.5,
    }));

    return {
      totalCalls,
      answeredCalls,
      missedCalls,
      avgWaitTime: 0,
      avgHandleTime,
      avgSatisfaction: 4.5,
      callsByHour,
      callsByDay,
      topDispositions,
      agentPerformance,
    };
  }
}

export const callCenter = new CallCenterSystem();
