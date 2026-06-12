// User personalization — profile, preferences, business analysis.
// All data stays local, no API keys needed for personalization logic.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  role: string; // 'developer', 'designer', 'manager', 'founder', etc.
  company?: string;
  industry?: string;
  preferences: UserPreferences;
  businessContext: BusinessContext;
  created: number;
  updated: number;
}

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system';
  language: string;
  defaultProvider: string;
  defaultModel: string;
  autoApproveReads: boolean;
  autoApproveWrites: boolean;
  notificationStyle: 'minimal' | 'detailed';
  responseStyle: 'concise' | 'detailed' | 'adaptive';
  workingHours?: { start: string; end: string };
  timezone?: string;
}

export interface BusinessContext {
  industry: string;
  teamSize?: number;
  techStack?: string[];
  goals?: string[];
  challenges?: string[];
  recentProjects?: ProjectInfo[];
  metrics?: Record<string, string>;
}

export interface ProjectInfo {
  name: string;
  description: string;
  status: 'active' | 'planned' | 'completed';
  techStack?: string[];
  lastWorked?: number;
}

export class PersonalizationManager {
  private profileDir: string;
  private profilePath: string;
  private profile: UserProfile;

  constructor(workspaceRoot?: string) {
    const baseDir = workspaceRoot ?? join(homedir(), '.infinite-ai');
    this.profileDir = join(baseDir, 'profile');
    this.profilePath = join(this.profileDir, 'user.json');

    if (!existsSync(this.profileDir)) {
      mkdirSync(this.profileDir, { recursive: true });
    }

    this.profile = this.loadProfile();
  }

  private loadProfile(): UserProfile {
    try {
      if (existsSync(this.profilePath)) {
        return JSON.parse(readFileSync(this.profilePath, 'utf-8'));
      }
    } catch { /* ignore */ }

    // Return default profile
    return {
      id: `user-${Date.now()}`,
      name: 'User',
      role: 'developer',
      preferences: {
        theme: 'dark',
        language: 'en',
        defaultProvider: 'openrouter',
        defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
        autoApproveReads: true,
        autoApproveWrites: false,
        notificationStyle: 'minimal',
        responseStyle: 'adaptive',
      },
      businessContext: {
        industry: 'technology',
      },
      created: Date.now(),
      updated: Date.now(),
    };
  }

  private saveProfile(): void {
    this.profile.updated = Date.now();
    writeFileSync(this.profilePath, JSON.stringify(this.profile, null, 2));
  }

  getProfile(): UserProfile {
    return { ...this.profile };
  }

  updateProfile(updates: Partial<UserProfile>): UserProfile {
    this.profile = { ...this.profile, ...updates, updated: Date.now() };
    this.saveProfile();
    return this.profile;
  }

  updatePreferences(prefs: Partial<UserPreferences>): UserProfile {
    this.profile.preferences = { ...this.profile.preferences, ...prefs };
    this.saveProfile();
    return this.profile;
  }

  updateBusinessContext(ctx: Partial<BusinessContext>): UserProfile {
    this.profile.businessContext = { ...this.profile.businessContext, ...ctx };
    this.saveProfile();
    return this.profile;
  }

  addProject(project: ProjectInfo): UserProfile {
    this.profile.businessContext.recentProjects = [
      project,
      ...(this.profile.businessContext.recentProjects ?? []).slice(0, 19),
    ];
    this.saveProfile();
    return this.profile;
  }

  // Generate personalized system prompt additions
  getPersonalizedContext(): string {
    const parts: string[] = [];

    if (this.profile.name && this.profile.name !== 'User') {
      parts.push(`User: ${this.profile.name}`);
    }
    if (this.profile.role) {
      parts.push(`Role: ${this.profile.role}`);
    }
    if (this.profile.company) {
      parts.push(`Company: ${this.profile.company}`);
    }
    if (this.profile.businessContext.industry) {
      parts.push(`Industry: ${this.profile.businessContext.industry}`);
    }
    if (this.profile.businessContext.techStack?.length) {
      parts.push(`Tech Stack: ${this.profile.businessContext.techStack.join(', ')}`);
    }
    if (this.profile.businessContext.goals?.length) {
      parts.push(`Goals: ${this.profile.businessContext.goals.join('; ')}`);
    }
    if (this.profile.preferences.responseStyle) {
      parts.push(`Response Style: ${this.profile.preferences.responseStyle}`);
    }

    return parts.length > 0 ? `\n\n## User Context\n${parts.join('\n')}` : '';
  }

  // Analyze user's working patterns
  analyzePatterns(): { activeHours: number[]; preferredTasks: string[]; avgSessionLength: number } {
    // This would analyze session history to find patterns
    // For now return defaults
    return {
      activeHours: [9, 10, 11, 14, 15, 16],
      preferredTasks: ['coding', 'debugging'],
      avgSessionLength: 45,
    };
  }

  // Suggest improvements based on user context
  suggestImprovements(): string[] {
    const suggestions: string[] = [];

    if (!this.profile.businessContext.techStack?.length) {
      suggestions.push('Add your tech stack to get more relevant code suggestions');
    }
    if (!this.profile.businessContext.goals?.length) {
      suggestions.push('Define your goals so I can prioritize relevant tasks');
    }
    if (!this.profile.company) {
      suggestions.push('Add your company name for business-context-aware responses');
    }

    return suggestions;
  }
}
