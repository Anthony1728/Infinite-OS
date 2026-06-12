/**
 * Decision Router
 * 
 * Automatically selects the best model for each task based on:
 * - Task type and complexity
 * - Model performance history
 * - Cost optimization
 * - Speed requirements
 * - Tool/vision capabilities
 * - Online/offline status
 */

export interface RouterConfig {
  defaultModel: string;
  defaultProvider: string;
  fallbackToLocal: boolean;
  costOptimization: boolean;
  speedPriority: boolean;
}

export interface TaskAnalysis {
  type: string;
  complexity: 'simple' | 'medium' | 'complex';
  requiresTools: boolean;
  requiresVision: boolean;
  estimatedTokens: number;
  tags: string[];
}

export interface RoutingDecision {
  modelId: string;
  provider: string;
  confidence: number;
  reasoning: string;
  fallbacks: Array<{ modelId: string; provider: string }>;
  costEstimate: number;
}

export class DecisionRouter {
  private config: RouterConfig;
  private taskHistory: Array<{ task: string; model: string; success: boolean; timestamp: number }> = [];

  constructor(config?: Partial<RouterConfig>) {
    this.config = {
      defaultModel: config?.defaultModel ?? 'meta-llama/llama-3.3-70b-instruct:free',
      defaultProvider: config?.defaultProvider ?? 'openrouter',
      fallbackToLocal: config?.fallbackToLocal ?? true,
      costOptimization: config?.costOptimization ?? true,
      speedPriority: config?.speedPriority ?? false,
    };
  }

  analyzeTask(prompt: string, _context?: Record<string, unknown>): TaskAnalysis {
    const lowerPrompt = prompt.toLowerCase();
    
    // Detect task type
    let type = 'general';
    if (lowerPrompt.includes('code') || lowerPrompt.includes('program') || lowerPrompt.includes('function')) {
      type = 'coding';
    } else if (lowerPrompt.includes('analyze') || lowerPrompt.includes('research') || lowerPrompt.includes('compare')) {
      type = 'analysis';
    } else if (lowerPrompt.includes('write') || lowerPrompt.includes('draft') || lowerPrompt.includes('essay')) {
      type = 'writing';
    } else if (lowerPrompt.includes('debug') || lowerPrompt.includes('error') || lowerPrompt.includes('fix')) {
      type = 'debugging';
    } else if (lowerPrompt.includes('plan') || lowerPrompt.includes('strategy') || lowerPrompt.includes('design')) {
      type = 'planning';
    } else if (lowerPrompt.includes('search') || lowerPrompt.includes('find') || lowerPrompt.includes('lookup')) {
      type = 'research';
    }

    // Detect complexity
    let complexity: 'simple' | 'medium' | 'complex' = 'medium';
    if (prompt.length < 50 || lowerPrompt.includes('simple') || lowerPrompt.includes('quick')) {
      complexity = 'simple';
    } else if (prompt.length > 500 || lowerPrompt.includes('complex') || lowerPrompt.includes('detailed') || lowerPrompt.includes('comprehensive')) {
      complexity = 'complex';
    }

    // Detect tool requirements
    const requiresTools = lowerPrompt.includes('file') || lowerPrompt.includes('execute') || 
      lowerPrompt.includes('read') || lowerPrompt.includes('write') || lowerPrompt.includes('run');

    // Detect vision requirements
    const requiresVision = lowerPrompt.includes('image') || lowerPrompt.includes('screenshot') || 
      lowerPrompt.includes('picture') || lowerPrompt.includes('photo') || lowerPrompt.includes('video');

    // Estimate tokens
    const estimatedTokens = Math.ceil(prompt.split(' ').length * 1.3);

    // Extract tags
    const tags: string[] = [];
    if (type !== 'general') tags.push(type);
    if (complexity !== 'medium') tags.push(complexity);
    if (requiresTools) tags.push('tools');
    if (requiresVision) tags.push('vision');

    return {
      type,
      complexity,
      requiresTools,
      requiresVision,
      estimatedTokens,
      tags,
    };
  }

  route(analysis: TaskAnalysis, availableModels?: string[]): RoutingDecision {
    // Model definitions
    const models = [
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        provider: 'openrouter',
        name: 'Llama 3.3 70B',
        types: ['general', 'coding', 'analysis'],
        speed: 0.6,
        quality: 0.8,
        cost: 0,
        tools: true,
        vision: false,
        local: false,
      },
      {
        id: 'claude-3-5-sonnet-20241022',
        provider: 'anthropic',
        name: 'Claude 3.5 Sonnet',
        types: ['coding', 'analysis', 'writing', 'planning'],
        speed: 0.7,
        quality: 0.95,
        cost: 0.003,
        tools: true,
        vision: true,
        local: false,
      },
      {
        id: 'gpt-4o',
        provider: 'openai',
        name: 'GPT-4o',
        types: ['general', 'coding', 'analysis', 'vision'],
        speed: 0.75,
        quality: 0.93,
        cost: 0.005,
        tools: true,
        vision: true,
        local: false,
      },
      {
        id: 'gemini-2.0-flash-exp',
        provider: 'gemini',
        name: 'Gemini 2.0 Flash',
        types: ['general', 'fast', 'vision'],
        speed: 0.95,
        quality: 0.85,
        cost: 0.001,
        tools: true,
        vision: true,
        local: false,
      },
      {
        id: 'llama3.1:8b',
        provider: 'ollama',
        name: 'Llama 3.1 8B (Local)',
        types: ['general', 'coding'],
        speed: 0.8,
        quality: 0.7,
        cost: 0,
        tools: true,
        vision: false,
        local: true,
      },
    ];

    // Filter by available models if specified
    let candidates = models;
    if (availableModels && availableModels.length > 0) {
      candidates = models.filter((m) => availableModels.includes(m.id) || availableModels.includes(m.provider));
    }

    // Score each model
    const scored = candidates.map((model) => {
      let score = 0.5;

      // Type match
      if (model.types.includes(analysis.type)) score += 0.25;

      // Complexity match
      if (analysis.complexity === 'simple' && model.speed > 0.8) score += 0.1;
      if (analysis.complexity === 'complex' && model.quality > 0.9) score += 0.15;

      // Tool requirement
      if (analysis.requiresTools && model.tools) score += 0.1;

      // Vision requirement
      if (analysis.requiresVision && model.vision) score += 0.15;

      // Cost optimization
      if (this.config.costOptimization && model.cost === 0) score += 0.1;

      // Speed priority
      if (this.config.speedPriority) score += model.speed * 0.15;

      // Historical success
      const history = this.taskHistory.filter(
        (h) => h.model === model.id && h.success
      );
      if (history.length > 0) score += 0.05;

      return { ...model, score: Math.min(score, 1) };
    });

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    const fallbacks = scored.slice(1, 3).map((m) => ({
      modelId: m.id,
      provider: m.provider,
    }));

    const costEstimate = (analysis.estimatedTokens / 1000) * best.cost;

    return {
      modelId: best.id,
      provider: best.provider,
      confidence: best.score,
      reasoning: `Selected ${best.name} for ${analysis.type} (${analysis.complexity}) - score: ${best.score.toFixed(2)}`,
      fallbacks,
      costEstimate,
    };
  }

  recordTask(model: string, success: boolean): void {
    this.taskHistory.push({
      task: '',
      model,
      success,
      timestamp: Date.now(),
    });
    if (this.taskHistory.length > 500) this.taskHistory.shift();
  }

  getStats(): {
    totalTasks: number;
    successRate: number;
    modelUsage: Record<string, number>;
  } {
    const totalTasks = this.taskHistory.length;
    const successRate = totalTasks > 0
      ? this.taskHistory.filter((h) => h.success).length / totalTasks
      : 0;

    const modelUsage: Record<string, number> = {};
    for (const h of this.taskHistory) {
      modelUsage[h.model] = (modelUsage[h.model] || 0) + 1;
    }

    return { totalTasks, successRate, modelUsage };
  }
}
