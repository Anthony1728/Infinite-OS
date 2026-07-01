// YouTube Learning Engine — analyzes videos, extracts step-by-step instructions,
// and stores learned tasks that can be replayed via mouse/keyboard automation.

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

export interface VideoInstruction {
  id: string;
  step: number;
  action: string;
  target?: string;
  value?: string;
  timestamp?: number;
  screenshot?: string;
  confidence: number;
}

export interface LearnedTask {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  sourceTitle: string;
  instructions: VideoInstruction[];
  tags: string[];
  estimatedDuration: number;
  successRate: number;
  timesExecuted: number;
  createdAt: number;
  updatedAt: number;
}

export interface VideoAnalysis {
  id: string;
  url: string;
  title: string;
  channel: string;
  duration: string;
  transcript: string;
  instructions: VideoInstruction[];
  summary: string;
  tags: string[];
  analyzedAt: number;
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string;
  steps: Array<{
    type: 'mouse_click' | 'mouse_move' | 'type_text' | 'key_press' | 'wait' | 'scroll' | 'screenshot' | 'open_app' | 'navigate';
    params: Record<string, unknown>;
    description: string;
  }>;
  variables: Array<{
    name: string;
    type: 'text' | 'number' | 'email' | 'password' | 'url';
    defaultValue?: string;
    description: string;
  }>;
  tags: string[];
  createdAt: number;
}

const DATA_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.infinite-ai', 'learning');

export class YouTubeLearningEngine extends EventEmitter {
  private tasks: Map<string, LearnedTask> = new Map();
  private analyses: Map<string, VideoAnalysis> = new Map();
  private templates: Map<string, TaskTemplate> = new Map();

  async init(): Promise<void> {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.mkdir(path.join(DATA_DIR, 'tasks'), { recursive: true });
      await fs.mkdir(path.join(DATA_DIR, 'analyses'), { recursive: true });
      await fs.mkdir(path.join(DATA_DIR, 'templates'), { recursive: true });
      await this.loadAll();
    } catch { /* ignore */ }
  }

  async analyzeVideo(url: string, transcript: string, title = '', channel = ''): Promise<VideoAnalysis> {
    const id = uuidv4();
    const instructions = this.extractInstructions(transcript);

    const analysis: VideoAnalysis = {
      id,
      url,
      title: title || this.extractTitleFromUrl(url),
      channel,
      duration: '',
      transcript,
      instructions,
      summary: this.generateSummary(instructions),
      tags: this.extractTags(transcript),
      analyzedAt: Date.now(),
    };

    this.analyses.set(id, analysis);
    await this.saveAnalysis(analysis);
    this.emit('videoAnalyzed', analysis);
    return analysis;
  }

  async learnFromVideo(url: string, transcript: string, taskTitle: string): Promise<LearnedTask> {
    const analysis = await this.analyzeVideo(url, transcript);

    const task: LearnedTask = {
      id: uuidv4(),
      title: taskTitle,
      description: analysis.summary,
      sourceUrl: url,
      sourceTitle: analysis.title,
      instructions: analysis.instructions,
      tags: analysis.tags,
      estimatedDuration: analysis.instructions.length * 3,
      successRate: 1.0,
      timesExecuted: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    await this.saveTask(task);
    this.emit('taskLearned', task);
    return task;
  }

  async createTaskFromSteps(title: string, steps: TaskTemplate['steps'], variables: TaskTemplate['variables'] = [], description = ''): Promise<TaskTemplate> {
    const template: TaskTemplate = {
      id: uuidv4(),
      name: title,
      description: description || `Automated task: ${title}`,
      steps,
      variables,
      tags: ['custom', 'user-created'],
      createdAt: Date.now(),
    };

    this.templates.set(template.id, template);
    await this.saveTemplate(template);
    this.emit('templateCreated', template);
    return template;
  }

  async learnFromDailyActivity(sessionData: {
    actions: Array<{ type: string; target?: string; value?: string; timestamp: number }>;
    appsUsed: string[];
    websitesVisited: string[];
    date: string;
  }): Promise<LearnedTask[]> {
    const tasks: LearnedTask[] = [];
    const groupedActions = this.groupActionsIntoTasks(sessionData.actions);

    for (const group of groupedActions) {
      if (group.actions.length < 3) continue;

      const task: LearnedTask = {
        id: uuidv4(),
        title: this.inferTaskTitle(group.actions),
        description: `Learned from daily activity on ${sessionData.date}`,
        sourceUrl: '',
        sourceTitle: `Daily activity ${sessionData.date}`,
        instructions: group.actions.map((a, i) => ({
          id: uuidv4(),
          step: i + 1,
          action: a.type,
          target: a.target,
          value: a.value,
          timestamp: a.timestamp,
          confidence: 0.8,
        })),
        tags: [...this.inferTags(group.actions), 'auto-learned', 'daily'],
        estimatedDuration: group.actions.length * 2,
        successRate: 1.0,
        timesExecuted: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      this.tasks.set(task.id, task);
      await this.saveTask(task);
      tasks.push(task);
    }

    this.emit('dailyActivityLearned', { tasks, date: sessionData.date });
    return tasks;
  }

  private extractInstructions(transcript: string): VideoInstruction[] {
    const instructions: VideoInstruction[] = [];
    const lines = transcript.split('\n').filter(l => l.trim());
    let step = 1;

    const actionPatterns = [
      { pattern: /click\s+(?:on\s+)?(.+)/i, action: 'mouse_click' },
      { pattern: /open\s+(.+?)(?:\s+and|\s*$)/i, action: 'open_app' },
      { pattern: /go\s+to\s+(.+?)(?:\s+and|\s*$)/i, action: 'navigate' },
      { pattern: /type\s+(.+?)(?:\s+and|\s*$)/i, action: 'type_text' },
      { pattern: /press\s+(.+?)(?:\s+and|\s*$)/i, action: 'key_press' },
      { pattern: /scroll\s+(down|up|left|right)/i, action: 'scroll' },
      { pattern: /select\s+(.+?)(?:\s+and|\s*$)/i, action: 'mouse_click' },
      { pattern: /enter\s+(.+?)(?:\s+and|\s*$)/i, action: 'type_text' },
      { pattern: /fill\s+(.+?)\s+with\s+(.+)/i, action: 'type_text' },
      { pattern: /navigate\s+to\s+(.+?)(?:\s+and|\s*$)/i, action: 'navigate' },
      { pattern: /install\s+(.+?)(?:\s+and|\s*$)/i, action: 'open_app' },
      { pattern: /download\s+(.+?)(?:\s+and|\s*$)/i, action: 'navigate' },
      { pattern: /save\s+(.+?)(?:\s+and|\s*$)/i, action: 'key_press' },
      { pattern: /copy\s+(.+?)(?:\s+and|\s*$)/i, action: 'key_press' },
      { pattern: /paste\s+(.+?)(?:\s+and|\s*$)/i, action: 'key_press' },
      { pattern: /right[\s-]?click\s+(?:on\s+)?(.+)/i, action: 'mouse_click' },
      { pattern: /double[\s-]?click\s+(?:on\s+)?(.+)/i, action: 'mouse_click' },
      { pattern: /sign\s*up|register|create\s+account/i, action: 'navigate' },
      { pattern: /log\s*in|sign\s*in|login/i, action: 'navigate' },
      { pattern: /search\s+(?:for\s+)?(.+?)(?:\s+and|\s*$)/i, action: 'navigate' },
    ];

    for (const line of lines) {
      for (const { pattern, action } of actionPatterns) {
        const match = line.match(pattern);
        if (match) {
          instructions.push({
            id: uuidv4(),
            step: step++,
            action,
            target: match[1]?.trim() || line.trim(),
            value: match[2]?.trim(),
            confidence: 0.7,
          });
          break;
        }
      }
    }

    if (instructions.length === 0 && lines.length > 0) {
      for (let i = 0; i < Math.min(lines.length, 20); i++) {
        instructions.push({
          id: uuidv4(),
          step: step++,
          action: 'description',
          target: lines[i].trim(),
          confidence: 0.5,
        });
      }
    }

    return instructions;
  }

  private generateSummary(instructions: VideoInstruction[]): string {
    if (instructions.length === 0) return 'No actionable steps extracted';
    const actions = instructions.map(i => i.action);
    const unique = [...new Set(actions)];
    return `${instructions.length} steps identified: ${unique.join(', ')}`;
  }

  private extractTags(transcript: string): string[] {
    const tags: string[] = [];
    const keywords = ['install', 'download', 'setup', 'configure', 'code', 'build', 'deploy',
      'website', 'app', 'account', 'sign up', 'login', 'search', 'buy', 'purchase',
      'edit', 'create', 'write', 'design', 'learn', 'tutorial', 'how to'];
    const lower = transcript.toLowerCase();
    for (const kw of keywords) {
      if (lower.includes(kw)) tags.push(kw);
    }
    return tags;
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const u = new URL(url);
      const params = new URLSearchParams(u.search);
      return params.get('v') ? `YouTube Video (${params.get('v')})` : u.hostname;
    } catch {
      return 'Unknown Video';
    }
  }

  private groupActionsIntoTasks(actions: Array<{ type: string; target?: string; value?: string; timestamp: number }>): Array<{ actions: typeof actions }> {
    const groups: Array<{ actions: typeof actions }> = [];
    let current: typeof actions = [];

    for (let i = 0; i < actions.length; i++) {
      current.push(actions[i]);
      if (i < actions.length - 1) {
        const gap = actions[i + 1].timestamp - actions[i].timestamp;
        if (gap > 300000) {
          groups.push({ actions: [...current] });
          current = [];
        }
      }
    }
    if (current.length > 0) groups.push({ actions: current });
    return groups;
  }

  private inferTaskTitle(actions: Array<{ type: string; target?: string }>): string {
    const targets = actions.map(a => a.target).filter(Boolean);
    if (targets.length > 0) return `Task: ${targets[0]}`;
    return `Task: ${actions[0]?.type || 'Unknown'}`;
  }

  private inferTags(actions: Array<{ type: string; target?: string }>): string[] {
    const tags: string[] = [];
    const all = actions.map(a => `${a.type} ${a.target || ''}`.toLowerCase()).join(' ');
    if (all.includes('browser') || all.includes('http')) tags.push('browser');
    if (all.includes('code') || all.includes('file')) tags.push('coding');
    if (all.includes('app') || all.includes('launch')) tags.push('application');
    return tags;
  }

  listTasks(): LearnedTask[] { return Array.from(this.tasks.values()); }
  getTask(id: string): LearnedTask | undefined { return this.tasks.get(id); }
  deleteTask(id: string): boolean { return this.tasks.delete(id); }
  listAnalyses(): VideoAnalysis[] { return Array.from(this.analyses.values()); }
  getAnalysis(id: string): VideoAnalysis | undefined { return this.analyses.get(id); }
  listTemplates(): TaskTemplate[] { return Array.from(this.templates.values()); }
  getTemplate(id: string): TaskTemplate | undefined { return this.templates.get(id); }

  private async loadAll(): Promise<void> {
    try {
      const taskFiles = await fs.readdir(path.join(DATA_DIR, 'tasks')).catch(() => []);
      for (const f of taskFiles) {
        if (!f.endsWith('.json')) continue;
        const data = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'tasks', f), 'utf-8'));
        this.tasks.set(data.id, data);
      }
      const templateFiles = await fs.readdir(path.join(DATA_DIR, 'templates')).catch(() => []);
      for (const f of templateFiles) {
        if (!f.endsWith('.json')) continue;
        const data = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'templates', f), 'utf-8'));
        this.templates.set(data.id, data);
      }
    } catch { /* ignore */ }
  }

  private async saveTask(task: LearnedTask): Promise<void> {
    try { await fs.writeFile(path.join(DATA_DIR, 'tasks', `${task.id}.json`), JSON.stringify(task, null, 2)); } catch { /* ignore */ }
  }

  private async saveAnalysis(analysis: VideoAnalysis): Promise<void> {
    try { await fs.writeFile(path.join(DATA_DIR, 'analyses', `${analysis.id}.json`), JSON.stringify(analysis, null, 2)); } catch { /* ignore */ }
  }

  private async saveTemplate(template: TaskTemplate): Promise<void> {
    try { await fs.writeFile(path.join(DATA_DIR, 'templates', `${template.id}.json`), JSON.stringify(template, null, 2)); } catch { /* ignore */ }
  }
}

export const youtubeLearning = new YouTubeLearningEngine();

