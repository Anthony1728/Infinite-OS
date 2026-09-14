/**
 * Self-Evolution Engine
 *
 * The biggest moat for Infinite OS: turns user behavior into
 * automated skills. "You do X 3x per week — want me to automate it?"
 *
 * - Detects recurring patterns from activity tracker data
 * - Auto-generates skills from high-confidence patterns
 * - Suggests automation opportunities to the user
 * - Bridges SelfImprovementEngine + SkillsManager + ActivityTracker
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';
import { SkillsManager } from '../skills/manager.js';
import { activityTracker } from '../tracker/index.js';
import { SelfImprovementEngine } from './improvement.js';

export interface PatternSuggestion {
  id: string;
  pattern: string;
  description: string;
  frequency: number;
  confidence: number;
  automationProposal: string;
  skillDraft?: SkillDraft;
  status: 'suggested' | 'accepted' | 'auto-created' | 'dismissed';
  createdAt: number;
}

export interface SkillDraft {
  name: string;
  description: string;
  instructions: string;
  category: string;
  triggers: string[];
  examples: string[];
}

export interface EvolutionStatus {
  totalPatterns: number;
  totalSuggestions: number;
  autoCreatedSkills: number;
  pendingSuggestions: number;
  patternsAnalyzed: number;
  lastAnalysisAt: number;
}

export class SelfEvolutionEngine {
  private improvement: SelfImprovementEngine;
  private skillsManager: SkillsManager;
  private suggestions: PatternSuggestion[] = [];
  private dataDir: string;
  private autoCreateSkills: boolean;

  constructor(options?: { autoCreateSkills?: boolean; dataDir?: string }) {
    this.improvement = new SelfImprovementEngine();
    this.skillsManager = new SkillsManager();
    this.dataDir = options?.dataDir ?? join(infiniteHome(), 'self-evolution');
    this.autoCreateSkills = options?.autoCreateSkills ?? true;
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  // ── Core: Analyze Activity Patterns ──

  /**
   * Analyze the activity tracker's recent patterns and generate
   * automation suggestions. Call this periodically or on demand.
   */
  analyzePatterns(): PatternSuggestion[] {
    const patterns = activityTracker.getPatterns();
    const recentActions = activityTracker.getRecentActions(500);
    const newSuggestions: PatternSuggestion[] = [];

    for (const tp of patterns) {
      if (tp.frequency >= 3 && tp.confidence >= 0.5) {
        const suggestion = this.createSuggestionFromPattern(tp, recentActions);
        if (suggestion && !this.isDuplicate(suggestion.pattern)) {
          newSuggestions.push(suggestion);
        }
      }
    }

    const improvementPatterns = this.improvement.getPatterns();
    for (const pat of improvementPatterns) {
      if (pat.successRate < 0.7 && pat.examples > 5) {
        const suggestion = this.createSuggestionFromImprovement(pat, recentActions);
        if (suggestion && !this.isDuplicate(suggestion.pattern)) {
          newSuggestions.push(suggestion);
        }
      }
    }

    const filePatterns = this.detectFilePatterns(recentActions);
    for (const fp of filePatterns) {
      const suggestion = this.createSuggestionFromFilePattern(fp, recentActions);
      if (suggestion && !this.isDuplicate(suggestion.pattern)) {
        newSuggestions.push(suggestion);
      }
    }

    this.suggestions = [...newSuggestions, ...this.suggestions];
    this.saveData();

    return newSuggestions;
  }

  getSuggestions(status?: PatternSuggestion['status']): PatternSuggestion[] {
    if (status) return this.suggestions.filter((s) => s.status === status);
    return this.suggestions;
  }

  acceptSuggestion(id: string, autoCreate = true): PatternSuggestion | null {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (!suggestion) return null;

    suggestion.status = 'accepted';

    if (autoCreate && suggestion.skillDraft) {
      try {
        this.skillsManager.addSkill({
          name: suggestion.skillDraft.name,
          description: suggestion.skillDraft.description,
          instructions: suggestion.skillDraft.instructions,
          category: suggestion.skillDraft.category,
          triggers: suggestion.skillDraft.triggers,
          examples: suggestion.skillDraft.examples,
          source: 'custom',
        });
        suggestion.status = 'auto-created';
        suggestion.skillDraft = undefined;
      } catch {
        // Skill creation failed, keep as accepted
      }
    }

    this.saveData();
    return suggestion;
  }

  dismissSuggestion(id: string): boolean {
    const suggestion = this.suggestions.find((s) => s.id === id);
    if (!suggestion) return false;
    suggestion.status = 'dismissed';
    this.saveData();
    return true;
  }

  getTopSuggestion(): PatternSuggestion | null {
    return this.suggestions
      .filter((s) => s.status === 'suggested')
      .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  }

  getAutomationPrompt(): string | null {
    const top = this.getTopSuggestion();
    if (!top) return null;

    return `You've repeated "${top.pattern}" ${top.frequency} times. ` +
      `I can auto-create a skill to automate this. ` +
      `Want me to set it up? (${top.automationProposal})`;
  }

  // ── Pattern Detection Helpers ──

  private createSuggestionFromPattern(
    tp: { id: string; description: string; frequency: number; confidence: number; actions: unknown[] },
    _recentActions: unknown[]
  ): PatternSuggestion | null {
    const description = tp.description;
    const pattern = tp.description.replace(/Repeated sequence: /, '').split(' (')[0];
    const automationProposal = `Create a ${pattern} automation workflow`;

    return {
      id: randomUUID(),
      pattern,
      description: `Detected recurring pattern: ${description}`,
      frequency: tp.frequency,
      confidence: tp.confidence,
      automationProposal,
      skillDraft: this.generateSkillDraft(pattern, description, _recentActions),
      status: 'suggested',
      createdAt: Date.now(),
    };
  }

  private createSuggestionFromImprovement(
    pat: { taskType: string; pattern: string; successRate: number; examples: number; bestModel: string; bestApproach: string },
    _recentActions: unknown[]
  ): PatternSuggestion | null {
    const pattern = pat.pattern;
    const automationProposal = `Optimize ${pat.taskType} workflow using best approach: ${pat.bestApproach}`;

    return {
      id: randomUUID(),
      pattern,
      description: `Low success rate (${(pat.successRate * 100).toFixed(1)}%) on ${pat.taskType} — improve with automation`,
      frequency: pat.examples,
      confidence: Math.max(0.3, pat.successRate),
      automationProposal,
      skillDraft: {
        name: `${pat.taskType} auto-fix`,
        description: `Automate ${pat.taskType} using the best approach`,
        instructions: `Use the following approach for ${pat.taskType}: ${pat.bestApproach}. Model: ${pat.bestModel}.`,
        category: 'automation',
        triggers: [pat.taskType, ...pattern.toLowerCase().split(' ').slice(0, 3)],
        examples: [`${pat.taskType} using ${pat.bestApproach}`],
      },
      status: 'suggested',
      createdAt: Date.now(),
    };
  }

  private detectFilePatterns(actions: unknown[]): Array<{ filePath: string; count: number }> {
    const fileCounts = new Map<string, number>();
    for (const action of actions as Array<{ type: string; filePath?: string }>) {
      if ((action.type === 'file_open' || action.type === 'file_create') && action.filePath) {
        fileCounts.set(action.filePath, (fileCounts.get(action.filePath) ?? 0) + 1);
      }
    }
    const result: Array<{ filePath: string; count: number }> = [];
    for (const [filePath, count] of fileCounts) {
      if (count >= 3) result.push({ filePath, count });
    }
    return result;
  }

  private createSuggestionFromFilePattern(
    fp: { filePath: string; count: number },
    _recentActions: unknown[]
  ): PatternSuggestion | null {
    const fileName = fp.filePath.split(/[\\/]/).pop() ?? fp.filePath;
    const pattern = `Open ${fileName}`;

    return {
      id: randomUUID(),
      pattern,
      description: `You open ${fileName} ${fp.count} times — automate this`,
      frequency: fp.count,
      confidence: Math.min(1, fp.count / 10),
      automationProposal: `Create a quick-launch skill for ${fileName}`,
      skillDraft: {
        name: `Open ${fileName}`,
        description: `Quick-launch automation for ${fileName}`,
        instructions: `Automatically open and prepare ${fileName} for work.`,
        category: 'workflow',
        triggers: [fileName, pattern],
        examples: [`Open ${fileName}`],
      },
      status: 'suggested',
      createdAt: Date.now(),
    };
  }

  private generateSkillDraft(pattern: string, description: string, _actions: unknown[]): SkillDraft {
    const name = pattern.replace(/[^a-zA-Z0-9\s]/g, '').trim().slice(0, 40);
    const skillName = name.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    return {
      name: skillName || pattern,
      description: `Auto-generated skill for: ${description}`,
      instructions: `Execute the following pattern automatically: ${pattern}. ` +
        `This skill was auto-generated based on recent actions. ` +
        `Run the pattern when triggered.`,
      category: 'automation',
      triggers: [pattern, ...pattern.toLowerCase().split(' ').filter((w) => w.length > 2)],
      examples: [pattern],
    };
  }

  private isDuplicate(pattern: string): boolean {
    return this.suggestions.some((s) => s.pattern === pattern && s.status !== 'dismissed');
  }

  // ── Auto-Evolution Loop ──

  evolve(): { suggestions: PatternSuggestion[]; newSkills: number; status: EvolutionStatus } {
    const suggestions = this.analyzePatterns();

    let newSkills = 0;
    if (this.autoCreateSkills) {
      for (const suggestion of suggestions) {
        if (suggestion.confidence >= 0.8 && suggestion.status === 'suggested') {
          this.acceptSuggestion(suggestion.id, true);
          newSkills++;
        }
      }
    }

    const stats = this.getStatus();
    return { suggestions, newSkills, status: stats };
  }

  getStatus(): EvolutionStatus {
    return {
      totalPatterns: this.suggestions.length,
      totalSuggestions: this.suggestions.filter((s) => s.status === 'suggested').length,
      autoCreatedSkills: this.suggestions.filter((s) => s.status === 'auto-created').length,
      pendingSuggestions: this.suggestions.filter((s) => s.status === 'suggested').length,
      patternsAnalyzed: this.suggestions.length,
      lastAnalysisAt: this.suggestions.length > 0 ? Math.max(...this.suggestions.map((s) => s.createdAt)) : 0,
    };
  }

  // ── Persistence ──

  private loadData(): void {
    try {
      const path = join(this.dataDir, 'suggestions.json');
      if (existsSync(path)) {
        this.suggestions = JSON.parse(readFileSync(path, 'utf-8'));
      }
    } catch { /* silent */ }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'suggestions.json'), JSON.stringify(this.suggestions, null, 2));
    } catch { /* silent */ }
  }
}

let instance: SelfEvolutionEngine | null = null;

export function getSelfEvolutionEngine(options?: { autoCreateSkills?: boolean; dataDir?: string }): SelfEvolutionEngine {
  if (!instance) {
    instance = new SelfEvolutionEngine(options);
  }
  return instance;
}
