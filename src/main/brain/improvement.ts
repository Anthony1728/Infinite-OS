/**
 * Self-Improvement Engine
 * 
 * Continuously learns and improves:
 * - Task execution patterns
 * - Model selection
 * - Tool usage
 * - Error prevention
 * - Performance optimization
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface ImprovementConfig {
  dataDir: string;
  maxPatterns: number;
  learningRate: number;
  improvementThreshold: number;
}

export interface TaskPattern {
  id: string;
  taskType: string;
  pattern: string;
  successRate: number;
  avgDuration: number;
  bestModel: string;
  bestApproach: string;
  examples: number;
  lastUpdated: number;
}

export interface ErrorPattern {
  id: string;
  errorType: string;
  context: string;
  frequency: number;
  lastOccurrence: number;
  preventionStrategy: string;
  resolved: boolean;
}

export interface PerformanceMetric {
  id: string;
  metric: string;
  value: number;
  timestamp: number;
  trend: 'improving' | 'stable' | 'declining';
}

export interface ImprovementAction {
  id: string;
  type: 'optimize' | 'fix' | 'adapt' | 'learn';
  target: string;
  description: string;
  expectedImpact: number;
  status: 'pending' | 'applied' | 'verified' | 'rejected';
  createdAt: number;
  appliedAt?: number;
}

export class SelfImprovementEngine {
  private config: ImprovementConfig;
  private patterns: Map<string, TaskPattern> = new Map();
  private errors: Map<string, ErrorPattern> = new Map();
  private metrics: PerformanceMetric[] = [];
  private actions: ImprovementAction[] = [];
  private dataDir: string;

  constructor(config?: Partial<ImprovementConfig>) {
    this.config = {
      dataDir: config?.dataDir ?? join(infiniteHome(), 'improvement'),
      maxPatterns: config?.maxPatterns ?? 500,
      learningRate: config?.learningRate ?? 0.1,
      improvementThreshold: config?.improvementThreshold ?? 0.05,
    };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const patternsPath = join(this.dataDir, 'patterns.json');
      if (existsSync(patternsPath)) {
        const data = JSON.parse(readFileSync(patternsPath, 'utf-8'));
        this.patterns = new Map(data);
      }
      const errorsPath = join(this.dataDir, 'errors.json');
      if (existsSync(errorsPath)) {
        const data = JSON.parse(readFileSync(errorsPath, 'utf-8'));
        this.errors = new Map(data);
      }
      const metricsPath = join(this.dataDir, 'metrics.json');
      if (existsSync(metricsPath)) {
        this.metrics = JSON.parse(readFileSync(metricsPath, 'utf-8'));
      }
      const actionsPath = join(this.dataDir, 'actions.json');
      if (existsSync(actionsPath)) {
        this.actions = JSON.parse(readFileSync(actionsPath, 'utf-8'));
      }
    } catch {
      // Silent fail
    }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'patterns.json'), JSON.stringify(Array.from(this.patterns.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'errors.json'), JSON.stringify(Array.from(this.errors.entries()), null, 2));
      writeFileSync(join(this.dataDir, 'metrics.json'), JSON.stringify(this.metrics.slice(-1000), null, 2));
      writeFileSync(join(this.dataDir, 'actions.json'), JSON.stringify(this.actions.slice(-200), null, 2));
    } catch {
      // Silent fail
    }
  }

  // Learn from task execution
  recordTaskExecution(
    taskType: string,
    pattern: string,
    success: boolean,
    duration: number,
    model: string,
    approach: string,
  ): void {
    const key = `${taskType}_${pattern}`;
    const existing = this.patterns.get(key);

    if (existing) {
      existing.examples++;
      existing.successRate = (existing.successRate * (existing.examples - 1) + (success ? 1 : 0)) / existing.examples;
      existing.avgDuration = (existing.avgDuration * (existing.examples - 1) + duration) / existing.examples;
      if (success && duration < existing.avgDuration) {
        existing.bestModel = model;
        existing.bestApproach = approach;
      }
      existing.lastUpdated = Date.now();
    } else {
      this.patterns.set(key, {
        id: randomUUID(),
        taskType,
        pattern,
        successRate: success ? 1 : 0,
        avgDuration: duration,
        bestModel: model,
        bestApproach: approach,
        examples: 1,
        lastUpdated: Date.now(),
      });
    }

    // Trim patterns if needed
    if (this.patterns.size > this.config.maxPatterns) {
      const sorted = Array.from(this.patterns.entries()).sort(
        (a, b) => a[1].lastUpdated - b[1].lastUpdated
      );
      const toDelete = sorted.slice(0, this.patterns.size - this.config.maxPatterns);
      for (const [key] of toDelete) {
        this.patterns.delete(key);
      }
    }

    this.saveData();
  }

  // Record and analyze errors
  recordError(errorType: string, context: string): void {
    const key = `${errorType}_${context}`;
    const existing = this.errors.get(key);

    if (existing) {
      existing.frequency++;
      existing.lastOccurrence = Date.now();
    } else {
      this.errors.set(key, {
        id: randomUUID(),
        errorType,
        context,
        frequency: 1,
        lastOccurrence: Date.now(),
        preventionStrategy: '',
        resolved: false,
      });

      // Generate prevention strategy
      const error = this.errors.get(key)!;
      error.preventionStrategy = this.generatePreventionStrategy(errorType, context);
    }

    this.saveData();
  }

  private generatePreventionStrategy(errorType: string, context: string): string {
    const strategies: Record<string, string> = {
      timeout: 'Increase timeout or use faster model',
      rate_limit: 'Add delay between requests or use alternative provider',
      auth_error: 'Verify API key or refresh credentials',
      network_error: 'Check connectivity or use offline mode',
      parse_error: 'Validate input format before processing',
      memory_error: 'Reduce context size or clear old data',
    };

    return strategies[errorType] ?? `Review ${context} and adjust approach`;
  }

  // Track performance metrics
  recordMetric(metric: string, value: number): void {
    const existing = this.metrics.filter((m) => m.metric === metric);
    const trend = this.calculateTrend(existing.map((m) => m.value));

    this.metrics.push({
      id: randomUUID(),
      metric,
      value,
      timestamp: Date.now(),
      trend,
    });

    if (this.metrics.length > 1000) this.metrics.shift();
    this.saveData();
  }

  private calculateTrend(values: number[]): 'improving' | 'stable' | 'declining' {
    if (values.length < 2) return 'stable';

    const recent = values.slice(-5);
    const older = values.slice(-10, -5);

    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const change = (recentAvg - olderAvg) / olderAvg;

    if (change > this.config.improvementThreshold) return 'improving';
    if (change < -this.config.improvementThreshold) return 'declining';
    return 'stable';
  }

  // Generate improvement actions
  generateImprovements(): ImprovementAction[] {
    const actions: ImprovementAction[] = [];

    // Check error patterns
    for (const [, error] of this.errors) {
      if (!error.resolved && error.frequency > 3) {
        actions.push({
          id: randomUUID(),
          type: 'fix',
          target: error.errorType,
          description: `Fix recurring error: ${error.errorType} (${error.frequency} occurrences)`,
          expectedImpact: 0.2,
          status: 'pending',
          createdAt: Date.now(),
        });
      }
    }

    // Check performance metrics
    const decliningMetrics = this.metrics.filter((m) => m.trend === 'declining');
    for (const metric of decliningMetrics.slice(0, 5)) {
      actions.push({
        id: randomUUID(),
        type: 'optimize',
        target: metric.metric,
        description: `Address declining metric: ${metric.metric}`,
        expectedImpact: 0.15,
        status: 'pending',
        createdAt: Date.now(),
      });
    }

    // Check task patterns
    for (const [, pattern] of this.patterns) {
      if (pattern.successRate < 0.7 && pattern.examples > 5) {
        actions.push({
          id: randomUUID(),
          type: 'adapt',
          target: pattern.taskType,
          description: `Improve ${pattern.taskType} success rate (currently ${(pattern.successRate * 100).toFixed(1)}%)`,
          expectedImpact: 0.25,
          status: 'pending',
          createdAt: Date.now(),
        });
      }
    }

    this.actions.push(...actions);
    this.saveData();

    return actions;
  }

  // Get best approach for a task
  getBestApproach(taskType: string, pattern: string): {
    model: string;
    approach: string;
    confidence: number;
  } | null {
    const key = `${taskType}_${pattern}`;
    const existing = this.patterns.get(key);

    if (existing && existing.examples >= 3) {
      return {
        model: existing.bestModel,
        approach: existing.bestApproach,
        confidence: existing.successRate,
      };
    }

    return null;
  }

  // Get improvement stats
  getStats(): {
    totalPatterns: number;
    totalErrors: number;
    unresolvedErrors: number;
    totalMetrics: number;
    pendingActions: number;
    overallImprovement: number;
  } {
    const unresolvedErrors = Array.from(this.errors.values()).filter((e) => !e.resolved).length;
    const pendingActions = this.actions.filter((a) => a.status === 'pending').length;

    const improvingMetrics = this.metrics.filter((m) => m.trend === 'improving').length;
    const decliningMetrics = this.metrics.filter((m) => m.trend === 'declining').length;
    const overallImprovement = improvingMetrics - decliningMetrics;

    return {
      totalPatterns: this.patterns.size,
      totalErrors: this.errors.size,
      unresolvedErrors,
      totalMetrics: this.metrics.length,
      pendingActions,
      overallImprovement,
    };
  }

  getPatterns(): TaskPattern[] {
    return Array.from(this.patterns.values());
  }

  getErrors(): ErrorPattern[] {
    return Array.from(this.errors.values());
  }

  getMetrics(): PerformanceMetric[] {
    return this.metrics;
  }

  getActions(): ImprovementAction[] {
    return this.actions;
  }

  /**
   * Auto-generate skills from low-success-rate patterns.
   * Returns skill drafts that can be fed to SkillsManager.
   */
  autoGenerateSkills(): Array<{ name: string; description: string; instructions: string; category: string; triggers: string[] }> {
    const skills = [];
    for (const [, pattern] of this.patterns) {
      if (pattern.successRate < 0.7 && pattern.examples > 5) {
        skills.push({
          name: `${pattern.taskType} auto-fix`,
          description: `Automate ${pattern.taskType} using best approach`,
          instructions: `Use the following approach for ${pattern.taskType}: ${pattern.bestApproach}. Model: ${pattern.bestModel}.`,
          category: 'automation',
          triggers: [pattern.taskType, ...pattern.pattern.toLowerCase().split(' ').slice(0, 3)],
        });
      }
    }
    return skills;
  }
}

