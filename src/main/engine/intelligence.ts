/**
 * Intelligence Engine
 * 
 * Manages the bootstrap lifecycle of the Infinite Brain:
 * - DORMANT: Not yet active, waiting for API keys/local models
 * - BOOTSTRAPPING: Accumulating knowledge from real AI interactions
 * - ACTIVE: Fully operational — routes intelligently, self-improves
 * 
 * The engine only starts working once it has enough knowledge and
 * once it can do multiple things and answer multiple questions.
 * For now, it uses local models or API keys, learns from AI responses,
 * and trains itself.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

import { getBrain } from '../brain/core.js';
import { improvement as improvementEngine } from '../index.js';
import { getOllamaBrain } from '../ollama/brain.js';

export enum EnginePhase {
  DORMANT = 'dormant',
  BOOTSTRAPPING = 'bootstrapping',
  ACTIVE = 'active',
}

export interface EngineConfig {
  dataDir: string;
  /** Minimum successful interactions before engine goes ACTIVE */
  minInteractions: number;
  /** Minimum distinct categories covered */
  minCategories: number;
  /** Minimum success rate for at least one model */
  minSuccessRate: number;
  minMultiPartInteractions: number;
}

export interface EngineStatus {
  phase: EnginePhase;
  totalInteractions: number;
  successfulInteractions: number;
  categoriesCovered: string[];
  modelsUsed: string[];
  bestModel: string | null;
  bestModelSuccessRate: number;
  progressPercent: number;
  thresholdMet: boolean;
  successfulMultiPartInteractions: number;
  startedAt: number;
  lastInteractionAt: number;
}

export interface InteractionRecord {
  id: string;
  timestamp: number;
  taskType: string;
  input: string;
  modelUsed: string;
  provider: string;
  output: string;
  success: boolean;
  duration: number;
  tokens: { input: number; output: number };
  feedback?: 'positive' | 'negative';
}

const DEFAULT_CONFIG: EngineConfig = {
  dataDir: join(infiniteHome(), 'engine'),
  minInteractions: 10,
  minCategories: 3,
  minSuccessRate: 0.6,
  minMultiPartInteractions: 2,
};

export class IntelligenceEngine {
  private config: EngineConfig;
  private dataDir: string;
  private phase: EnginePhase = EnginePhase.DORMANT;
  private interactions: InteractionRecord[] = [];
  private startedAt: number = 0;
  private lastInteractionAt: number = 0;
  private _hasApiKey: boolean = false;
  private _ollamaAvailable: boolean = false;
  /** Shared by concurrent `initialize()` callers; see that method. */
  private initInFlight: Promise<void> | null = null;

  constructor(config?: Partial<EngineConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.dataDir = this.config.dataDir;
    this.ensureDir();
    this.loadState();
  }

  // ── Lifecycle ──

  /**
   * Call when app starts — detect what's available.
   *
   * Boot reaches this from two places within the same tick: the model warm-up
   * and the engine startup log. `isAvailable()` is a live HTTP probe of Ollama
   * with a 1.5 s timeout, so letting both run meant every launch made two
   * probes and could log two different answers. Concurrent callers now share
   * one in-flight probe; a later call (say, after the user starts Ollama)
   * still re-detects.
   */
  async initialize(): Promise<void> {
    if (this.initInFlight) return this.initInFlight;
    this.initInFlight = this.detectProviders().finally(() => {
      this.initInFlight = null;
    });
    return this.initInFlight;
  }

  private async detectProviders(): Promise<void> {
    // Check for Ollama availability
    try {
      const ollama = getOllamaBrain();
      this._ollamaAvailable = await ollama.isAvailable();
    } catch {
      this._ollamaAvailable = false;
    }

    // Check for stored API keys — this is updated as keys are configured
    this._hasApiKey = this.detectApiKeys();

    console.log(
      `[engine] Initialized: ollama=${this._ollamaAvailable}, apiKeys=${this._hasApiKey}, ` +
      `phase=${this.phase}, interactions=${this.interactions.length}`
    );

    // If we were ACTIVE but lost all providers, degrade to BOOTSTRAPPING
    if (this.phase === EnginePhase.ACTIVE && !this._ollamaAvailable && !this._hasApiKey) {
      this.phase = EnginePhase.BOOTSTRAPPING;
    }
  }

  /** Called when user sends first message — transitions from DORMANT */
  tryBootstrap(): boolean {
    const canBootstrap = this._ollamaAvailable || this._hasApiKey;

    if (this.phase === EnginePhase.DORMANT && canBootstrap) {
      this.phase = EnginePhase.BOOTSTRAPPING;
      this.startedAt = Date.now();
      console.log('[engine] Transition: DORMANT → BOOTSTRAPPING');
      this.saveState();
      return true;
    }

    // If ACTIVE, check if we need to re-bootstrap
    if (this.phase === EnginePhase.ACTIVE && !canBootstrap) {
      this.phase = EnginePhase.BOOTSTRAPPING;
      console.log('[engine] Transition: ACTIVE → BOOTSTRAPPING (providers lost)');
      this.saveState();
      return true;
    }

    return false;
  }

  /** Record a completed AI interaction — the core learning mechanism */
  recordInteraction(record: Omit<InteractionRecord, 'id' | 'timestamp'>): EngineStatus {
    const entry: InteractionRecord = {
      ...record,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    this.interactions.push(entry);
    if (this.interactions.length > 5000) {
      this.interactions = this.interactions.slice(-5000);
    }
    this.lastInteractionAt = Date.now();

    // Feed into InfiniteBrain learning memory
    const brain = getBrain();
    brain.recordOutcome({
      taskType: record.taskType,
      input: record.input,
      modelUsed: record.modelUsed,
      output: record.output,
      success: record.success,
      duration: record.duration,
      tokens: record.tokens,
      metadata: { provider: record.provider },
    });

    // Feed into SelfImprovementEngine for pattern learning
    improvementEngine.recordTaskExecution(
      record.taskType,
      this.extractPattern(record.input),
      record.success,
      record.duration,
      record.modelUsed,
      `model:${record.modelUsed}`,
    );

    // If Ollama is available, distill knowledge from API responses
    if (record.provider !== 'ollama' && record.success && this._ollamaAvailable) {
      try {
        const ollama = getOllamaBrain();
        ollama.recordApiLearning(record.input, record.output, record.modelUsed, record.provider);
      } catch {
        /* non-blocking */
      }
    }

    // Check if we should transition to ACTIVE
    if (this.phase === EnginePhase.BOOTSTRAPPING && this.checkThreshold()) {
      this.phase = EnginePhase.ACTIVE;
      console.log('[engine] Transition: BOOTSTRAPPING → ACTIVE');
    }

    this.saveState();
    return this.getStatus();
  }

  /** Check if enough knowledge has been accumulated */
  private checkThreshold(): boolean {
    const successful = this.interactions.filter(i => i.success);

    // Condition 1: minimum successful interactions
    if (successful.length < this.config.minInteractions) return false;

    // Condition 2: minimum distinct categories covered
    const categories = new Set(successful.map(i => i.taskType));
    if (categories.size < this.config.minCategories) return false;

    const multiPartSuccesses = successful.filter(i => this.isMultiPart(i.input));
    if (multiPartSuccesses.length < this.config.minMultiPartInteractions) return false;

    // Condition 3: at least one model with >= minSuccessRate
    const modelStats = new Map<string, { total: number; success: number }>();
    for (const i of this.interactions) {
      const stats = modelStats.get(i.modelUsed) || { total: 0, success: 0 };
      stats.total++;
      if (i.success) stats.success++;
      modelStats.set(i.modelUsed, stats);
    }
    const hasGoodModel = Array.from(modelStats.values()).some(
      s => s.total >= 3 && s.success / s.total >= this.config.minSuccessRate
    );
    if (!hasGoodModel) return false;

    return true;
  }

  // ── Status & Queries ──

  getPhase(): EnginePhase {
    return this.phase;
  }

  getStatus(): EngineStatus {
    const successful = this.interactions.filter(i => i.success);
    const categories = new Set(successful.map(i => i.taskType));
    const models = new Set(this.interactions.map(i => i.modelUsed));
    const successfulMultiPartInteractions = successful.filter(i => this.isMultiPart(i.input)).length;

    // Find best model
    const modelStats = new Map<string, { total: number; success: number }>();
    for (const i of this.interactions) {
      const stats = modelStats.get(i.modelUsed) || { total: 0, success: 0 };
      stats.total++;
      if (i.success) stats.success++;
      modelStats.set(i.modelUsed, stats);
    }
    let bestModel: string | null = null;
    let bestRate = 0;
    for (const [model, stats] of modelStats) {
      if (stats.total >= 2) {
        const rate = stats.success / stats.total;
        if (rate > bestRate) {
          bestRate = rate;
          bestModel = model;
        }
      }
    }

    // Progress percentage toward ACTIVE threshold
    const progressPercent = this.phase === EnginePhase.ACTIVE
      ? 100
      : Math.min(
          100,
          Math.round(
            ((successful.length / this.config.minInteractions) * 35 +
              (categories.size / this.config.minCategories) * 25 +
              (successfulMultiPartInteractions / this.config.minMultiPartInteractions) * 15 +
              (bestRate >= this.config.minSuccessRate ? 25 : (bestRate / this.config.minSuccessRate) * 25))
          )
        );

    return {
      phase: this.phase,
      totalInteractions: this.interactions.length,
      successfulInteractions: successful.length,
      categoriesCovered: Array.from(categories),
      modelsUsed: Array.from(models),
      bestModel,
      bestModelSuccessRate: bestRate,
      progressPercent,
      thresholdMet: this.checkThreshold(),
      successfulMultiPartInteractions,
      startedAt: this.startedAt,
      lastInteractionAt: this.lastInteractionAt,
    };
  }

  /** Check if the engine has enough knowledge to be considered "ready" */
  hasEnoughKnowledge(): boolean {
    return this.phase === EnginePhase.ACTIVE;
  }

  /** Get learned knowledge as teaching data */
  getLearnedKnowledge(): Array<{ question: string; answer: string; category: string }> {
    return this.interactions
      .filter(i => i.success && i.output.length > 20)
      .slice(-100)
      .map(i => ({
        question: i.input.slice(0, 300),
        answer: i.output.slice(0, 600),
        category: i.taskType,
      }));
  }

  // ── Provider Detection ──

  /** Update API key availability — call when keys are configured */
  updateApiKeyStatus(hasKey: boolean): void {
    this._hasApiKey = hasKey;
    if (this.phase === EnginePhase.DORMANT && (this._ollamaAvailable || hasKey)) {
      // Don't auto-bootstrap — wait for first message
    }
  }

  /** Update Ollama availability */
  updateOllamaStatus(available: boolean): void {
    this._ollamaAvailable = available;
  }

  getAvailableProviders(): string[] {
    const providers: string[] = [];
    if (this._ollamaAvailable) providers.push('ollama');
    if (this._hasApiKey) {
      providers.push('openrouter', 'anthropic', 'openai', 'gemini', 'groq');
    }
    return providers;
  }

  private detectApiKeys(): boolean {
    try {
      // Check the secrets storage location
      const secretsPath = join(infiniteHome(), 'secrets.bin');
      if (existsSync(secretsPath)) {
        return true; // At least one key is configured
      }
    } catch { /* ignore */ }

    // Also check the brain's modelPerformance — if there are entries for
    // non-ollama models, keys must have been configured previously
    try {
      const brain = getBrain();
      const performance = brain.getModelPerformance();
      const nonLocalModels = performance.filter(
        p => !p.modelId.toLowerCase().includes('local') &&
             !p.modelId.toLowerCase().includes('ollama')
      );
      if (nonLocalModels.length > 0) return true;
    } catch { /* ignore */ }

    return false;
  }

  // ── Helpers ──

  private extractPattern(input: string): string {
    const lower = input.toLowerCase().slice(0, 100);
    if (/\b(code|program|function|class|api|debug|error|fix)\b/.test(lower)) return 'coding';
    if (/\b(build|create|make|generate|write)\b/.test(lower)) return 'building';
    if (/\b(explain|what|how|why|tell|describe)\b/.test(lower)) return 'learning';
    if (/\b(deploy|push|publish|release)\b/.test(lower)) return 'deployment';
    if (/\b(test|check|verify|validate)\b/.test(lower)) return 'testing';
    if (/\b(hi|hello|hey|thanks|bye)\b/.test(lower)) return 'conversation';
    return 'general';
  }

  private isMultiPart(input: string): boolean {
    const questions = input.match(/\?/g)?.length ?? 0;
    const numberedItems = input.match(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s+/g)?.length ?? 0;
    const joinedTasks = input.match(/\b(?:and then|also|after that|as well as)\b/gi)?.length ?? 0;
    return questions >= 2 || numberedItems >= 2 || joinedTasks >= 1;
  }

  // ── Persistence ──

  private ensureDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private saveState(): void {
    this.ensureDir();
    try {
      writeFileSync(
        join(this.dataDir, 'state.json'),
        JSON.stringify({
          phase: this.phase,
          interactions: this.interactions.slice(-2000),
          startedAt: this.startedAt,
          lastInteractionAt: this.lastInteractionAt,
        }, null, 2)
      );
    } catch {
      /* silent fail */
    }
  }

  private loadState(): void {
    this.ensureDir();
    try {
      const statePath = join(this.dataDir, 'state.json');
      if (existsSync(statePath)) {
        const data = JSON.parse(readFileSync(statePath, 'utf-8'));
        this.phase = data.phase ?? EnginePhase.DORMANT;
        this.interactions = data.interactions ?? [];
        this.startedAt = data.startedAt ?? 0;
        this.lastInteractionAt = data.lastInteractionAt ?? 0;

        // Re-check threshold in case we loaded ACTIVE state
        if (this.phase === EnginePhase.ACTIVE && !this.checkThreshold()) {
          this.phase = EnginePhase.BOOTSTRAPPING;
        }
      }
    } catch {
      /* silent fail — start fresh */
    }
  }

  /** Reset the engine to DORMANT (for debugging/reset) */
  reset(): void {
    this.phase = EnginePhase.DORMANT;
    this.interactions = [];
    this.startedAt = 0;
    this.lastInteractionAt = 0;
    this.saveState();
  }
}

// Singleton
let instance: IntelligenceEngine | null = null;

export function getEngine(config?: Partial<EngineConfig>): IntelligenceEngine {
  if (!instance) {
    instance = new IntelligenceEngine(config);
  }
  return instance;
}

export function createEngine(config?: Partial<EngineConfig>): IntelligenceEngine {
  instance = new IntelligenceEngine(config);
  return instance;
}
