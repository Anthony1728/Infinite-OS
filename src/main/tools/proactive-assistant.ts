import type { Tool, ToolResult } from './base.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

interface ProactiveContext {
  currentApp?: string;
  recentApps: string[];
  recentFiles: string[];
  timeOfDay: number;
  dayOfWeek: number;
  activeTasks: number;
  overdueTasks: number;
  upcomingMeetings: number;
  unreadEmails: number;
  systemLoad: 'low' | 'medium' | 'high';
}

interface ProactiveSuggestion {
  id: string;
  type: 'shortcut' | 'reminder' | 'optimization' | 'automation' | 'insight' | 'warning';
  title: string;
  description: string;
  action?: string;
  priority: 'high' | 'medium' | 'low';
  confidence: number;
  category: 'productivity' | 'system' | 'calendar' | 'email' | 'code' | 'general';
  autoExecute?: boolean;
  createdAt: number;
  expiresAt?: number;
  dismissed: boolean;
}

interface UserPattern {
  id: string;
  pattern: string;
  frequency: number;
  lastSeen: number;
  context: string;
  suggestion: string;
}

const DATA_DIR = join(homedir(), '.infinite-ai', 'proactive');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function loadSuggestions(): ProactiveSuggestion[] {
  ensureDir();
  const path = join(DATA_DIR, 'suggestions.json');
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function saveSuggestions(suggestions: ProactiveSuggestion[]): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, 'suggestions.json'), JSON.stringify(suggestions, null, 2));
}

function loadPatterns(): UserPattern[] {
  ensureDir();
  const path = join(DATA_DIR, 'patterns.json');
  if (!existsSync(path)) return [];
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return []; }
}

function savePatterns(patterns: UserPattern[]): void {
  ensureDir();
  writeFileSync(join(DATA_DIR, 'patterns.json'), JSON.stringify(patterns, null, 2));
}

function generateTimeBasedSuggestions(ctx: ProactiveContext): ProactiveSuggestion[] {
  const suggestions: ProactiveSuggestion[] = [];
  const hour = ctx.timeOfDay;

  if (hour === 9) {
    suggestions.push({
      id: randomUUID(),
      type: 'reminder',
      title: 'Morning Briefing',
      description: 'Good morning! Would you like a daily briefing with weather, calendar, and task summary?',
      action: 'run_agent:general:Generate a daily morning briefing with weather, calendar events, and pending tasks',
      priority: 'medium',
      confidence: 0.9,
      category: 'productivity',
      autoExecute: false,
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (hour === 12) {
    suggestions.push({
      id: randomUUID(),
      type: 'reminder',
      title: 'Lunch Break',
      description: "It's lunch time! Consider taking a break to recharge.",
      priority: 'low',
      confidence: 0.7,
      category: 'general',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (hour === 17) {
    suggestions.push({
      id: randomUUID(),
      type: 'reminder',
      title: 'End of Day Review',
      description: 'Time for end-of-day review. Would you like to see what you accomplished today?',
      action: 'run_agent:general:Summarize today accomplishments and pending tasks',
      priority: 'medium',
      confidence: 0.85,
      category: 'productivity',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (hour >= 22 || hour < 6) {
    suggestions.push({
      id: randomUUID(),
      type: 'warning',
      title: 'Late Night Work',
      description: "It's late. Consider wrapping up and getting some rest.",
      priority: 'low',
      confidence: 0.6,
      category: 'general',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  return suggestions;
}

function generateSystemSuggestions(ctx: ProactiveContext): ProactiveSuggestion[] {
  const suggestions: ProactiveSuggestion[] = [];

  if (ctx.systemLoad === 'high') {
    suggestions.push({
      id: randomUUID(),
      type: 'optimization',
      title: 'High System Load Detected',
      description: 'System is under heavy load. Consider closing unnecessary apps or running a cleanup.',
      action: 'run_tool:System:action=get_processes',
      priority: 'high',
      confidence: 0.9,
      category: 'system',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (ctx.overdueTasks > 0) {
    suggestions.push({
      id: randomUUID(),
      type: 'reminder',
      title: `${ctx.overdueTasks} Overdue Task(s)`,
      description: `You have ${ctx.overdueTasks} overdue task(s). Would you like to review and reschedule them?`,
      action: 'run_tool:SmartScheduler:action=overdue',
      priority: 'high',
      confidence: 0.95,
      category: 'productivity',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (ctx.upcomingMeetings > 0) {
    suggestions.push({
      id: randomUUID(),
      type: 'reminder',
      title: `${ctx.upcomingMeetings} Upcoming Meeting(s)`,
      description: `You have ${ctx.upcomingMeetings} upcoming meeting(s). Would you like to prepare?`,
      action: 'run_tool:SmartScheduler:action=today',
      priority: 'medium',
      confidence: 0.85,
      category: 'calendar',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  return suggestions;
}

function generateContextSuggestions(ctx: ProactiveContext): ProactiveSuggestion[] {
  const suggestions: ProactiveSuggestion[] = [];

  if (ctx.currentApp === 'Code' || ctx.currentApp?.includes('VS Code')) {
    suggestions.push({
      id: randomUUID(),
      type: 'automation',
      title: 'Code Assistant Active',
      description: "You're coding! I can help with code review, testing, or documentation.",
      action: 'run_agent:code:Analyze the current code for improvements, bugs, or documentation needs',
      priority: 'medium',
      confidence: 0.8,
      category: 'code',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (ctx.recentFiles.some((f) => f.endsWith('.md'))) {
    suggestions.push({
      id: randomUUID(),
      type: 'insight',
      title: 'Documentation Detected',
      description: "You've been working with documentation. Would you like help reviewing or improving it?",
      priority: 'low',
      confidence: 0.6,
      category: 'productivity',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  if (ctx.recentFiles.some((f) => f.endsWith('.json'))) {
    suggestions.push({
      id: randomUUID(),
      type: 'shortcut',
      title: 'JSON File Detected',
      description: 'I can help validate, format, or transform JSON files.',
      action: 'run_tool:Json:action=validate',
      priority: 'low',
      confidence: 0.7,
      category: 'code',
      createdAt: Date.now(),
      dismissed: false,
    });
  }

  return suggestions;
}

export const proactiveAssistantTool: Tool = {
  name: 'ProactiveAssistant',
  description:
    'AI-powered proactive assistant that monitors context and provides smart suggestions, shortcuts, and automations. Learns user patterns and anticipates needs. Provides time-based reminders, system alerts, and context-aware recommendations.',
  permission: 'none',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['suggest', 'dismiss', 'patterns', 'learn', 'context', 'history', 'settings'],
        description: 'Proactive assistant action',
      },
      suggestionId: { type: 'string', description: 'Suggestion ID to dismiss' },
      pattern: { type: 'string', description: 'Pattern to learn' },
      context: { type: 'object', description: 'Current context (apps, files, time, etc.)' },
      settings: { type: 'object', description: 'Update assistant settings' },
    },
    required: ['action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      suggestionId?: string;
      pattern?: string;
      context?: Record<string, unknown>;
      settings?: Record<string, unknown>;
    };

    try {
      const suggestions = loadSuggestions();
      const patterns = loadPatterns();

      switch (input.action) {
        case 'suggest': {
          const now = new Date();
          const ctx: ProactiveContext = {
            currentApp: input.context?.currentApp as string,
            recentApps: (input.context?.recentApps as string[]) || [],
            recentFiles: (input.context?.recentFiles as string[]) || [],
            timeOfDay: now.getHours(),
            dayOfWeek: now.getDay(),
            activeTasks: Number(input.context?.activeTasks) || 0,
            overdueTasks: Number(input.context?.overdueTasks) || 0,
            upcomingMeetings: Number(input.context?.upcomingMeetings) || 0,
            unreadEmails: Number(input.context?.unreadEmails) || 0,
            systemLoad: (input.context?.systemLoad as ProactiveContext['systemLoad']) || 'medium',
          };

          const newSuggestions = [
            ...generateTimeBasedSuggestions(ctx),
            ...generateSystemSuggestions(ctx),
            ...generateContextSuggestions(ctx),
          ];

          const activeSuggestions = suggestions.filter(
            (s) => !s.dismissed && (!s.expiresAt || s.expiresAt > Date.now()),
          );

          const allSuggestions = [...activeSuggestions, ...newSuggestions].slice(0, 10);

          if (allSuggestions.length === 0) {
            return { content: 'No suggestions at this time. Everything looks good!' };
          }

          const lines = ['=== Proactive Suggestions ===', ''];
          for (const s of allSuggestions) {
            lines.push(`[${s.priority.toUpperCase()}] ${s.title}`);
            lines.push(`  ${s.description}`);
            if (s.action) lines.push(`  Action: ${s.action}`);
            lines.push(`  Confidence: ${Math.round(s.confidence * 100)}%`);
            lines.push('');
          }
          return { content: lines.join('\n') };
        }

        case 'dismiss': {
          if (!input.suggestionId) return { content: 'suggestionId is required', is_error: true };
          const suggestion = suggestions.find((s) => s.id === input.suggestionId);
          if (!suggestion) return { content: `Suggestion not found: ${input.suggestionId}`, is_error: true };

          suggestion.dismissed = true;
          saveSuggestions(suggestions);
          return { content: `Dismissed: ${suggestion.title}` };
        }

        case 'patterns': {
          if (patterns.length === 0) return { content: 'No learned patterns yet. Use "learn" to teach me.' };

          const lines = ['=== Learned Patterns ===', ''];
          for (const p of patterns.sort((a, b) => b.frequency - a.frequency)) {
            lines.push(`  ${p.pattern}`);
            lines.push(`    Frequency: ${p.frequency}x | Last: ${new Date(p.lastSeen).toLocaleString()}`);
            lines.push(`    Suggestion: ${p.suggestion}`);
          }
          return { content: lines.join('\n') };
        }

        case 'learn': {
          if (!input.pattern) return { content: 'pattern is required', is_error: true };

          const existing = patterns.find((p) => p.pattern === input.pattern);
          if (existing) {
            existing.frequency++;
            existing.lastSeen = Date.now();
          } else {
            patterns.push({
              id: randomUUID(),
              pattern: input.pattern,
              frequency: 1,
              lastSeen: Date.now(),
              context: JSON.stringify(input.context || {}),
              suggestion: input.context?.suggestion as string || 'Continue this pattern',
            });
          }

          savePatterns(patterns);
          return {
            content: existing
              ? `Pattern reinforced: ${input.pattern} (now ${existing.frequency}x)`
              : `New pattern learned: ${input.pattern}`,
          };
        }

        case 'context': {
          return {
            content: [
              '=== Current Context ===',
              `Time: ${new Date().toLocaleString()}`,
              `Day: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()]}`,
              input.context?.currentApp ? `App: ${input.context.currentApp}` : '',
              input.context?.systemLoad ? `System Load: ${input.context.systemLoad}` : '',
              `Active Suggestions: ${suggestions.filter((s) => !s.dismissed).length}`,
              `Learned Patterns: ${patterns.length}`,
            ].filter(Boolean).join('\n'),
          };
        }

        case 'history': {
          const recentSuggestions = suggestions
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 20);

          if (recentSuggestions.length === 0) return { content: 'No suggestion history.' };

          const lines = ['=== Suggestion History ===', ''];
          for (const s of recentSuggestions) {
            lines.push(`  ${s.dismissed ? '[DISMISSED]' : '[ACTIVE]'} ${s.title}`);
            lines.push(`    ${new Date(s.createdAt).toLocaleString()}`);
          }
          return { content: lines.join('\n') };
        }

        case 'settings': {
          return {
            content: [
              '=== Proactive Assistant Settings ===',
              '',
              'The assistant automatically provides suggestions based on:',
              '- Time of day (morning briefing, lunch reminder, end-of-day review)',
              '- System state (CPU load, memory usage)',
              '- Calendar events (upcoming meetings)',
              '- Task status (overdue tasks)',
              '- Current application (code assistance, documentation help)',
              '- Recent files (JSON validation, markdown review)',
              '',
              'Use "learn" to teach new patterns.',
              'Use "dismiss" to remove suggestions.',
            ].join('\n'),
          };
        }

        default:
          return { content: `Unknown action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `ProactiveAssistant error: ${(error as Error).message}`, is_error: true };
    }
  },
};
