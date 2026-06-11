/**
 * Infinite Brain Core
 * 
 * The persistent intelligence layer that:
 * - Observes all model interactions
 * - Learns from outcomes
 * - Manages the decision router
 * - Validates actions before execution
 * - Works offline with local models
 * - Continuously improves itself
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Types
export interface BrainConfig {
  dataDir: string;
  enableLearning: boolean;
  enableOfflineMode: boolean;
  maxMemoryEntries: number;
  confidenceThreshold: number;
  safetyLevel: 'low' | 'medium' | 'high';
}

export interface BrainEvent {
  id: string;
  type: 'observation' | 'decision' | 'action' | 'outcome' | 'learning' | 'error';
  timestamp: number;
  data: Record<string, unknown>;
  source: string;
}

export interface LearningEntry {
  id: string;
  timestamp: number;
  taskType: string;
  input: string;
  modelUsed: string;
  output: string;
  success: boolean;
  duration: number;
  tokens: { input: number; output: number };
  feedback?: 'positive' | 'negative';
  metadata: Record<string, unknown>;
}

export interface ModelPerformance {
  modelId: string;
  taskType: string;
  successRate: number;
  avgDuration: number;
  avgTokens: number;
  totalTasks: number;
  lastUpdated: number;
}

export interface SystemHealth {
  timestamp: number;
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  activeAgents: number;
  activeSessions: number;
  modelStatus: Record<string, 'online' | 'offline' | 'error'>;
  lastError?: string;
}

export interface DecisionContext {
  taskType: string;
  complexity: 'simple' | 'medium' | 'complex';
  requiresTools: boolean;
  requiresVision: boolean;
  maxTokens?: number;
  preferSpeed: boolean;
  preferQuality: boolean;
  budget?: number;
}

export interface Decision {
  modelId: string;
  provider: string;
  confidence: number;
  reasoning: string;
  alternatives: Array<{ modelId: string; provider: string; score: number }>;
}

// Brain Core
export class InfiniteBrain {
  private config: BrainConfig;
  private dataDir: string;
  private events: BrainEvent[] = [];
  private learningMemory: LearningEntry[] = [];
  private modelPerformance: Map<string, ModelPerformance> = new Map();
  private healthHistory: SystemHealth[] = [];
  private isOnline: boolean = true;
  private lastHealthCheck: number = 0;
  private eventListeners: Array<(event: BrainEvent) => void> = [];

  constructor(config?: Partial<BrainConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'brain'),
      enableLearning: config?.enableLearning ?? true,
      enableOfflineMode: config?.enableOfflineMode ?? true,
      maxMemoryEntries: config?.maxMemoryEntries ?? 10000,
      confidenceThreshold: config?.confidenceThreshold ?? 0.7,
      safetyLevel: config?.safetyLevel ?? 'medium',
    };
    this.dataDir = this.config.dataDir;
    this.loadData();
  }

  // Event system
  onEvent(listener: (event: BrainEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      this.eventListeners = this.eventListeners.filter((l) => l !== listener);
    };
  }

  private emit(event: Omit<BrainEvent, 'id' | 'timestamp'>): BrainEvent {
    const fullEvent: BrainEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
    };
    this.events.push(fullEvent);
    if (this.events.length > 1000) this.events.shift();
    this.eventListeners.forEach((l) => l(fullEvent));
    return fullEvent;
  }

  // Decision Router - Intelligent model selection
  decideModel(context: DecisionContext): Decision {
    this.emit({ type: 'observation', data: { context }, source: 'brain.router' });

    // Get all available models
    const models = this.getAvailableModels();

    // Score each model
    const scored = models.map((model) => {
      let score = 0.5; // base score

      // Task type affinity
      if (model.taskAffinity.includes(context.taskType)) score += 0.2;

      // Complexity match
      if (context.complexity === 'simple' && model.speed > 0.7) score += 0.1;
      if (context.complexity === 'complex' && model.quality > 0.8) score += 0.15;

      // Tool support
      if (context.requiresTools && model.supportsTools) score += 0.15;

      // Vision support
      if (context.requiresVision && model.supportsVision) score += 0.15;

      // Performance history
      const perf = this.modelPerformance.get(`${model.id}_${context.taskType}`);
      if (perf) {
        score += perf.successRate * 0.2;
        if (perf.avgDuration < 5000) score += 0.05;
      }

      // Budget constraint
      if (context.budget && model.costPer1k > context.budget) score = 0;

      // Preference weighting
      if (context.preferSpeed) score += model.speed * 0.1;
      if (context.preferQuality) score += model.quality * 0.1;

      // Offline availability
      if (!this.isOnline && !model.local) score = 0;

      return { ...model, score: Math.min(score, 1) };
    });

    // Sort by score
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const decision: Decision = {
      modelId: best.id,
      provider: best.provider,
      confidence: best.score,
      reasoning: `Selected ${best.name} for ${context.taskType} (${context.complexity}) - score: ${best.score.toFixed(2)}`,
      alternatives: scored.slice(1, 4).map((m) => ({
        modelId: m.id,
        provider: m.provider,
        score: m.score,
      })),
    };

    this.emit({
      type: 'decision',
      data: { decision, context },
      source: 'brain.router',
    });

    return decision;
  }

  // Learn from outcome
  recordOutcome(entry: Omit<LearningEntry, 'id' | 'timestamp'>): void {
    if (!this.config.enableLearning) return;

    const learningEntry: LearningEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    this.learningMemory.push(learningEntry);

    // Trim memory if needed
    if (this.learningMemory.length > this.config.maxMemoryEntries) {
      this.learningMemory = this.learningMemory.slice(-this.config.maxMemoryEntries);
    }

    // Update model performance
    const key = `${entry.modelUsed}_${entry.taskType}`;
    const existing = this.modelPerformance.get(key);
    if (existing) {
      existing.totalTasks++;
      existing.successRate =
        (existing.successRate * (existing.totalTasks - 1) + (entry.success ? 1 : 0)) /
        existing.totalTasks;
      existing.avgDuration =
        (existing.avgDuration * (existing.totalTasks - 1) + entry.duration) /
        existing.totalTasks;
      existing.avgTokens =
        (existing.avgTokens * (existing.totalTasks - 1) + entry.tokens.input + entry.tokens.output) /
        existing.totalTasks;
      existing.lastUpdated = Date.now();
    } else {
      this.modelPerformance.set(key, {
        modelId: entry.modelUsed,
        taskType: entry.taskType,
        successRate: entry.success ? 1 : 0,
        avgDuration: entry.duration,
        avgTokens: entry.tokens.input + entry.tokens.output,
        totalTasks: 1,
        lastUpdated: Date.now(),
      });
    }

    this.emit({
      type: 'learning',
      data: { entry: learningEntry },
      source: 'brain.learning',
    });

    this.saveData();
  }

  // Safety Governor - Validate actions before execution
  validateAction(action: {
    type: string;
    target: string;
    payload: Record<string, unknown>;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  }): { approved: boolean; reason: string; riskScore: number } {
    let riskScore = 0;
    const reasons: string[] = [];

    // Check risk level
    const riskLevels = { low: 0.1, medium: 0.4, high: 0.7, critical: 1.0 };
    const actionRisk = riskLevels[action.riskLevel ?? 'low'];
    riskScore += actionRisk;

    // Check action type
    const dangerousActions = ['delete', 'execute', 'write', 'send', 'publish'];
    if (dangerousActions.includes(action.type)) {
      riskScore += 0.2;
      reasons.push(`Action type '${action.type}' requires validation`);
    }

    // Check target
    const sensitiveTargets = ['system', 'config', 'database', 'api'];
    if (sensitiveTargets.some((t) => action.target.toLowerCase().includes(t))) {
      riskScore += 0.15;
      reasons.push(`Target '${action.target}' is sensitive`);
    }

    // Safety level check
    const thresholds = { low: 0.8, medium: 0.6, high: 0.4 };
    const threshold = thresholds[this.config.safetyLevel];

    const approved = riskScore < threshold;
    if (!approved) {
      reasons.push(`Risk score ${riskScore.toFixed(2)} exceeds threshold ${threshold}`);
    }

    const result = {
      approved,
      reason: reasons.join('; ') || 'Action approved',
      riskScore,
    };

    this.emit({
      type: 'action',
      data: { action, result },
      source: 'brain.safety',
    });

    return result;
  }

  // System Health Monitor
  checkHealth(): SystemHealth {
    const health: SystemHealth = {
      timestamp: Date.now(),
      cpuUsage: this.getCpuUsage(),
      memoryUsage: this.getMemoryUsage(),
      diskUsage: this.getDiskUsage(),
      activeAgents: 0,
      activeSessions: 0,
      modelStatus: {},
      lastError: undefined,
    };

    this.healthHistory.push(health);
    if (this.healthHistory.length > 100) this.healthHistory.shift();

    this.lastHealthCheck = Date.now();

    this.emit({
      type: 'observation',
      data: { health },
      source: 'brain.health',
    });

    return health;
  }

  // Offline Mode Manager
  setOnlineStatus(online: boolean): void {
    if (this.isOnline === online) return;
    this.isOnline = online;
    this.emit({
      type: 'decision',
      data: { online, previous: !online },
      source: 'brain.connectivity',
    });
  }

  getOfflineCapabilities(): string[] {
    return [
      'system_control',
      'file_management',
      'code_execution',
      'automation',
      'local_reasoning',
      'memory_access',
      'task_scheduling',
      'system_monitoring',
    ];
  }

  // Self-Improvement Loop
  runImprovementCycle(): {
    issuesFound: number;
    improvementsSuggested: number;
    improvements: string[];
  } {
    const issues: string[] = [];
    const improvements: string[] = [];

    // Check model performance
    for (const [key, perf] of this.modelPerformance) {
      if (perf.successRate < 0.6 && perf.totalTasks > 5) {
        issues.push(`Model ${perf.modelId} has low success rate (${(perf.successRate * 100).toFixed(1)}%) for ${perf.taskType}`);
        improvements.push(`Consider alternative model for ${perf.taskType} tasks`);
      }
      if (perf.avgDuration > 30000) {
        issues.push(`Model ${perf.modelId} is slow (${(perf.avgDuration / 1000).toFixed(1)}s avg)`);
        improvements.push(`Switch to faster model for ${perf.taskType} tasks`);
      }
    }

    // Check health trends
    if (this.healthHistory.length >= 3) {
      const recent = this.healthHistory.slice(-3);
      const avgMemory = recent.reduce((s, h) => s + h.memoryUsage, 0) / recent.length;
      if (avgMemory > 0.8) {
        issues.push('High memory usage detected');
        improvements.push('Consider clearing old learning data or restarting');
      }
    }

    // Check learning memory
    if (this.learningMemory.length > this.config.maxMemoryEntries * 0.9) {
      issues.push('Learning memory near capacity');
      improvements.push('Archive old learning entries');
    }

    this.emit({
      type: 'learning',
      data: { issues, improvements },
      source: 'brain.improvement',
    });

    return {
      issuesFound: issues.length,
      improvementsSuggested: improvements.length,
      improvements,
    };
  }

  // Helper methods
  private getAvailableModels(): Array<{
    id: string;
    name: string;
    provider: string;
    taskAffinity: string[];
    speed: number;
    quality: number;
    costPer1k: number;
    supportsTools: boolean;
    supportsVision: boolean;
    local: boolean;
  }> {
    return [
      {
        id: 'llama-3.3-70b',
        name: 'Llama 3.3 70B',
        provider: 'openrouter',
        taskAffinity: ['general', 'coding', 'reasoning'],
        speed: 0.6,
        quality: 0.8,
        costPer1k: 0,
        supportsTools: true,
        supportsVision: false,
        local: false,
      },
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        taskAffinity: ['coding', 'analysis', 'writing', 'reasoning'],
        speed: 0.7,
        quality: 0.95,
        costPer1k: 0.003,
        supportsTools: true,
        supportsVision: true,
        local: false,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        taskAffinity: ['general', 'vision', 'reasoning', 'coding'],
        speed: 0.75,
        quality: 0.93,
        costPer1k: 0.005,
        supportsTools: true,
        supportsVision: true,
        local: false,
      },
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'gemini',
        taskAffinity: ['general', 'fast', 'vision'],
        speed: 0.95,
        quality: 0.85,
        costPer1k: 0.001,
        supportsTools: true,
        supportsVision: true,
        local: false,
      },
      {
        id: 'llama3.1-local',
        name: 'Llama 3.1 8B (Local)',
        provider: 'ollama',
        taskAffinity: ['general', 'coding'],
        speed: 0.8,
        quality: 0.7,
        costPer1k: 0,
        supportsTools: true,
        supportsVision: false,
        local: true,
      },
    ];
  }

  private getCpuUsage(): number {
    return Math.random() * 0.3 + 0.1; // Placeholder
  }

  private getMemoryUsage(): number {
    const mem = process.memoryUsage();
    return mem.heapUsed / mem.heapTotal;
  }

  private getDiskUsage(): number {
    return 0.5; // Placeholder
  }

  // Data persistence
  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private saveData(): void {
    this.ensureDir();
    try {
      writeFileSync(
        join(this.dataDir, 'learning.json'),
        JSON.stringify(this.learningMemory.slice(-1000), null, 2)
      );
      writeFileSync(
        join(this.dataDir, 'performance.json'),
        JSON.stringify(Array.from(this.modelPerformance.entries()), null, 2)
      );
    } catch {
      // Silent fail
    }
  }

  private loadData(): void {
    this.ensureDir();
    try {
      const learningPath = join(this.dataDir, 'learning.json');
      if (existsSync(learningPath)) {
        this.learningMemory = JSON.parse(readFileSync(learningPath, 'utf-8'));
      }
      const perfPath = join(this.dataDir, 'performance.json');
      if (existsSync(perfPath)) {
        this.modelPerformance = new Map(JSON.parse(readFileSync(perfPath, 'utf-8')));
      }
    } catch {
      // Silent fail
    }
  }

  // Public API
  getStats(): {
    totalEvents: number;
    totalLearningEntries: number;
    modelPerformanceCount: number;
    healthChecks: number;
    isOnline: boolean;
  } {
    return {
      totalEvents: this.events.length,
      totalLearningEntries: this.learningMemory.length,
      modelPerformanceCount: this.modelPerformance.size,
      healthChecks: this.healthHistory.length,
      isOnline: this.isOnline,
    };
  }

  getRecentEvents(count: number = 10): BrainEvent[] {
    return this.events.slice(-count);
  }

  getLearningMemory(): LearningEntry[] {
    return [...this.learningMemory];
  }

  getModelPerformance(): ModelPerformance[] {
    return Array.from(this.modelPerformance.values());
  }
}

// Singleton
let brain: InfiniteBrain | null = null;

export function getBrain(): InfiniteBrain {
  if (!brain) {
    brain = new InfiniteBrain();
  }
  return brain;
}

export function createBrain(config?: Partial<BrainConfig>): InfiniteBrain {
  return new InfiniteBrain(config);
}
