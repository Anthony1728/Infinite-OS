/**
 * Safety Governor
 * 
 * Validates all actions before execution:
 * - Risk assessment
 * - Permission checking
 * - Rollback capability
 * - Audit logging
 */

export interface SafetyConfig {
  level: 'low' | 'medium' | 'high';
  requireApprovalAbove: number;
  auditLog: boolean;
  maxConcurrentActions: number;
}

export interface ActionRequest {
  id: string;
  type: string;
  target: string;
  payload: Record<string, unknown>;
  source: string;
  timestamp: number;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

export interface ValidationResult {
  approved: boolean;
  riskScore: number;
  reason: string;
  requirements: string[];
  rollbackPlan?: string;
}

export interface AuditEntry {
  id: string;
  action: ActionRequest;
  result: ValidationResult;
  executedAt?: number;
  completedAt?: number;
  outcome?: 'success' | 'failure' | 'rollback';
}

export class SafetyGovernor {
  private config: SafetyConfig;
  private auditLog: AuditEntry[] = [];
  private activeActions: Map<string, ActionRequest> = new Map();

  constructor(config?: Partial<SafetyConfig>) {
    this.config = {
      level: config?.level ?? 'medium',
      requireApprovalAbove: config?.requireApprovalAbove ?? 0.6,
      auditLog: config?.auditLog ?? true,
      maxConcurrentActions: config?.maxConcurrentActions ?? 5,
    };
  }

  validate(request: ActionRequest): ValidationResult {
    // Check concurrent actions
    if (this.activeActions.size >= this.config.maxConcurrentActions) {
      return {
        approved: false,
        riskScore: 1,
        reason: 'Maximum concurrent actions reached',
        requirements: ['Wait for existing actions to complete'],
      };
    }

    let riskScore = 0;
    const requirements: string[] = [];

    // Risk level scoring
    const riskScores = { low: 0.1, medium: 0.4, high: 0.7, critical: 1.0 };
    riskScore += riskScores[request.riskLevel ?? 'low'];

    // Action type risk
    const actionRisks: Record<string, number> = {
      read: 0.05,
      search: 0.05,
      list: 0.05,
      write: 0.3,
      create: 0.2,
      update: 0.25,
      delete: 0.5,
      execute: 0.6,
      send: 0.4,
      publish: 0.7,
      system: 0.8,
    };
    riskScore += actionRisks[request.type] ?? 0.2;

    // Target risk
    const sensitiveTargets = ['system', 'config', 'database', 'api', 'credentials', 'secrets'];
    if (sensitiveTargets.some((t) => request.target.toLowerCase().includes(t))) {
      riskScore += 0.2;
      requirements.push('Sensitive target requires additional verification');
    }

    // Payload risk
    if (request.payload.delete || request.payload.remove) {
      riskScore += 0.15;
      requirements.push('Deletion detected - backup recommended');
    }

    // Safety level thresholds
    const thresholds = { low: 0.85, medium: 0.65, high: 0.45 };
    const threshold = thresholds[this.config.level];

    const approved = riskScore < threshold;

    if (!approved) {
      requirements.push(`Risk score ${(riskScore * 100).toFixed(0)}% exceeds ${this.config.level} safety threshold`);
    }

    // Generate rollback plan
    let rollbackPlan: string | undefined;
    if (request.type === 'write' || request.type === 'delete' || request.type === 'update') {
      rollbackPlan = `To rollback: restore previous state of ${request.target}`;
    }

    const result: ValidationResult = {
      approved,
      riskScore: Math.min(riskScore, 1),
      reason: approved
        ? 'Action approved by safety governor'
        : `Action blocked: risk score ${(riskScore * 100).toFixed(0)}% exceeds threshold`,
      requirements,
      rollbackPlan,
    };

    // Audit log
    if (this.config.auditLog) {
      this.auditLog.push({
        id: request.id,
        action: request,
        result,
      });
      if (this.auditLog.length > 1000) this.auditLog.shift();
    }

    return result;
  }

  execute(request: ActionRequest): string | null {
    const validation = this.validate(request);
    if (!validation.approved) return null;

    this.activeActions.set(request.id, request);
    return request.id;
  }

  complete(actionId: string, outcome: 'success' | 'failure' | 'rollback'): void {
    const request = this.activeActions.get(actionId);
    if (!request) return;

    this.activeActions.delete(actionId);

    const entry = this.auditLog.find((e) => e.id === actionId);
    if (entry) {
      entry.completedAt = Date.now();
      entry.outcome = outcome;
    }
  }

  getAuditLog(count: number = 50): AuditEntry[] {
    return this.auditLog.slice(-count);
  }

  getActiveActions(): ActionRequest[] {
    return Array.from(this.activeActions.values());
  }

  getStats(): {
    totalValidated: number;
    approved: number;
    blocked: number;
    activeActions: number;
  } {
    const approved = this.auditLog.filter((e) => e.result.approved).length;
    return {
      totalValidated: this.auditLog.length,
      approved,
      blocked: this.auditLog.length - approved,
      activeActions: this.activeActions.size,
    };
  }
}

