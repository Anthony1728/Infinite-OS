// Activity Tracker — records mouse/keyboard movements, app usage, and website visits
// throughout the day. Enables the AI to learn from user behavior.

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

export interface TrackedAction {
  id: string;
  type: 'mouse_move' | 'mouse_click' | 'mouse_scroll' | 'key_press' | 'type_text' | 'app_open' | 'app_close' | 'website_visit' | 'file_open' | 'file_create' | 'screenshot';
  x?: number;
  y?: number;
  button?: string;
  key?: string;
  text?: string;
  target?: string;
  url?: string;
  app?: string;
  filePath?: string;
  timestamp: number;
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface TrackingSession {
  id: string;
  startTime: number;
  endTime?: number;
  actions: TrackedAction[];
  appsUsed: Set<string>;
  websitesVisited: Set<string>;
  isActive: boolean;
}

export interface DailySummary {
  date: string;
  totalActions: number;
  mouseActions: number;
  keyboardActions: number;
  appsUsed: string[];
  websitesVisited: string[];
  activeDuration: number;
  taskGroups: Array<{
    name: string;
    actions: TrackedAction[];
    startTime: number;
    endTime: number;
    duration: number;
  }>;
  mostUsedApps: Array<{ app: string; count: number }>;
  mostVisitedSites: Array<{ site: string; count: number }>;
}

export interface UserPattern {
  id: string;
  type: 'recurring_action' | 'preferred_sequence' | 'habitual_timing' | 'common_task';
  description: string;
  actions: TrackedAction[];
  frequency: number;
  lastSeen: number;
  confidence: number;
  createdAt: number;
}

const TRACKER_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.infinite-ai', 'tracker');

export class ActivityTracker extends EventEmitter {
  private currentSession: TrackingSession | null = null;
  private allActions: TrackedAction[] = [];
  private patterns: UserPattern[] = [];
  private isTracking = false;
  private maxActions = 100000;

  async init(): Promise<void> {
    try {
      await fs.mkdir(TRACKER_DIR, { recursive: true });
      await fs.mkdir(path.join(TRACKER_DIR, 'sessions'), { recursive: true });
      await fs.mkdir(path.join(TRACKER_DIR, 'patterns'), { recursive: true });
      await this.loadPatterns();
      await this.loadTodaysActions();
    } catch { /* ignore */ }
  }

  startTracking(): void {
    if (this.isTracking) return;
    this.isTracking = true;
    this.currentSession = {
      id: uuidv4(),
      startTime: Date.now(),
      actions: [],
      appsUsed: new Set<string>(),
      websitesVisited: new Set<string>(),
      isActive: true,
    };
    this.emit('trackingStarted', { sessionId: this.currentSession.id });
  }

  stopTracking(): TrackingSession | null {
    if (!this.currentSession) return null;
    this.currentSession.endTime = Date.now();
    this.currentSession.isActive = false;
    this.isTracking = false;
    this.saveSession(this.currentSession);
    const session = this.currentSession;
    this.currentSession = null;
    this.emit('trackingStopped', { sessionId: session.id, actionCount: session.actions.length });
    return session;
  }

  recordAction(action: Omit<TrackedAction, 'id' | 'timestamp'>): TrackedAction {
    const fullAction: TrackedAction = {
      ...action,
      id: uuidv4(),
      timestamp: Date.now(),
    };

    this.allActions.push(fullAction);
    if (this.allActions.length > this.maxActions) {
      this.allActions = this.allActions.slice(-this.maxActions);
    }

    if (this.currentSession) {
      this.currentSession.actions.push(fullAction);
      if (action.app) this.currentSession.appsUsed.add(action.app);
      if (action.url) this.currentSession.websitesVisited.add(new URL(action.url).hostname);
    }

    this.emit('actionRecorded', fullAction);
    return fullAction;
  }

  recordMouseMove(x: number, y: number): TrackedAction {
    return this.recordAction({ type: 'mouse_move', x, y });
  }

  recordMouseClick(x: number, y: number, button = 'left'): TrackedAction {
    return this.recordAction({ type: 'mouse_click', x, y, button });
  }

  recordKeyPress(key: string): TrackedAction {
    return this.recordAction({ type: 'key_press', key });
  }

  recordTypeText(text: string): TrackedAction {
    return this.recordAction({ type: 'type_text', text });
  }

  recordAppOpen(app: string): TrackedAction {
    return this.recordAction({ type: 'app_open', app });
  }

  recordAppClose(app: string): TrackedAction {
    return this.recordAction({ type: 'app_close', app });
  }

  recordWebsiteVisit(url: string): TrackedAction {
    return this.recordAction({ type: 'website_visit', url });
  }

  recordFileOpen(filePath: string): TrackedAction {
    return this.recordAction({ type: 'file_open', filePath });
  }

  async analyzeDay(date?: string): Promise<DailySummary> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const dayStart = new Date(targetDate).getTime();
    const dayEnd = dayStart + 86400000;

    const dayActions = this.allActions.filter(a => a.timestamp >= dayStart && a.timestamp < dayEnd);
    const taskGroups = this.groupIntoTasks(dayActions);
    const patterns = this.detectPatterns(dayActions);

    const appsUsed = [...new Set(dayActions.filter(a => a.app).map(a => a.app!))];
    const websitesVisited = [...new Set(dayActions.filter(a => a.url).map(a => { try { return new URL(a.url!).hostname; } catch { return a.url!; } }))];

    const appCounts = new Map<string, number>();
    dayActions.filter(a => a.app).forEach(a => { appCounts.set(a.app!, (appCounts.get(a.app!) || 0) + 1); });
    const mostUsedApps = [...appCounts.entries()].sort((a, b) => b[1] - a[1]).map(([app, count]) => ({ app, count }));

    const siteCounts = new Map<string, number>();
    dayActions.filter(a => a.url).forEach(a => {
      try {
        const host = new URL(a.url!).hostname;
        siteCounts.set(host, (siteCounts.get(host) || 0) + 1);
      } catch { /* skip */ }
    });
    const mostVisitedSites = [...siteCounts.entries()].sort((a, b) => b[1] - a[1]).map(([site, count]) => ({ site, count }));

    const mouseActions = dayActions.filter(a => a.type.startsWith('mouse')).length;
    const keyboardActions = dayActions.filter(a => a.type === 'key_press' || a.type === 'type_text').length;

    const activeDuration = dayActions.length > 0
      ? dayActions[dayActions.length - 1].timestamp - dayActions[0].timestamp
      : 0;

    if (patterns.length > 0) {
      this.patterns.push(...patterns);
      await this.savePatterns();
    }

    const summary: DailySummary = {
      date: targetDate,
      totalActions: dayActions.length,
      mouseActions,
      keyboardActions,
      appsUsed,
      websitesVisited,
      activeDuration,
      taskGroups,
      mostUsedApps,
      mostVisitedSites,
    };

    this.emit('dayAnalyzed', summary);
    return summary;
  }

  private groupIntoTasks(actions: TrackedAction[]): DailySummary['taskGroups'] {
    const groups: DailySummary['taskGroups'] = [];
    let current: TrackedAction[] = [];
    let groupStart = 0;

    for (const action of actions) {
      if (current.length === 0) {
        groupStart = action.timestamp;
        current.push(action);
        continue;
      }

      const gap = action.timestamp - current[current.length - 1].timestamp;
      if (gap > 600000) {
        if (current.length >= 3) {
          groups.push({
            name: this.inferGroupName(current),
            actions: [...current],
            startTime: groupStart,
            endTime: current[current.length - 1].timestamp,
            duration: current[current.length - 1].timestamp - groupStart,
          });
        }
        current = [];
        groupStart = action.timestamp;
      }
      current.push(action);
    }

    if (current.length >= 3) {
      groups.push({
        name: this.inferGroupName(current),
        actions: current,
        startTime: groupStart,
        endTime: current[current.length - 1].timestamp,
        duration: current[current.length - 1].timestamp - groupStart,
      });
    }

    return groups;
  }

  private inferGroupName(actions: TrackedAction[]): string {
    const apps = actions.filter(a => a.app).map(a => a.app!);
    const urls = actions.filter(a => a.url).map(a => { try { return new URL(a.url!).hostname; } catch { return a.url!; } });
    if (apps.length > 0) return `Working in ${apps[0]}`;
    if (urls.length > 0) return `Browsing ${urls[0]}`;
    return 'General task';
  }

  private detectPatterns(actions: TrackedAction[]): UserPattern[] {
    const patterns: UserPattern[] = [];
    const sequences = new Map<string, { count: number; actions: TrackedAction[]; lastSeen: number }>();

    for (let i = 0; i < actions.length - 2; i++) {
      const key = `${actions[i].type}->${actions[i + 1].type}->${actions[i + 2].type}`;
      const existing = sequences.get(key);
      if (existing) {
        existing.count++;
        existing.lastSeen = actions[i + 2].timestamp;
      } else {
        sequences.set(key, { count: 1, actions: actions.slice(i, i + 3), lastSeen: actions[i + 2].timestamp });
      }
    }

    for (const [key, data] of sequences) {
      if (data.count >= 3) {
        patterns.push({
          id: uuidv4(),
          type: 'recurring_action',
          description: `Repeated sequence: ${key} (${data.count} times)`,
          actions: data.actions,
          frequency: data.count,
          lastSeen: data.lastSeen,
          confidence: Math.min(1, data.count / 10),
          createdAt: Date.now(),
        });
      }
    }

    return patterns;
  }

  getRecentActions(count = 100): TrackedAction[] { return this.allActions.slice(-count); }
  getPatterns(): UserPattern[] { return this.patterns; }
  isCurrentlyTracking(): boolean { return this.isTracking; }
  getCurrentSession(): TrackingSession | null { return this.currentSession; }
  getTotalActions(): number { return this.allActions.length; }

  async loadTodaysActions(): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const filePath = path.join(TRACKER_DIR, `${today}.json`);
      const data = await fs.readFile(filePath, 'utf-8').catch(() => '[]');
      this.allActions = JSON.parse(data);
    } catch { this.allActions = []; }
  }

  private async saveSession(session: TrackingSession): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const filePath = path.join(TRACKER_DIR, 'sessions', `${today}-${session.id}.json`);
      await fs.writeFile(filePath, JSON.stringify({
        ...session,
        appsUsed: [...session.appsUsed],
        websitesVisited: [...session.websitesVisited],
      }, null, 2));
    } catch { /* ignore */ }
  }

  private async loadPatterns(): Promise<void> {
    try {
      const files = await fs.readdir(path.join(TRACKER_DIR, 'patterns')).catch(() => []);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const data = JSON.parse(await fs.readFile(path.join(TRACKER_DIR, 'patterns', f), 'utf-8'));
        this.patterns.push(data);
      }
    } catch { /* ignore */ }
  }

  private async savePatterns(): Promise<void> {
    try {
      for (const p of this.patterns) {
        await fs.writeFile(path.join(TRACKER_DIR, 'patterns', `${p.id}.json`), JSON.stringify(p, null, 2));
      }
    } catch { /* ignore */ }
  }
}

export const activityTracker = new ActivityTracker();

