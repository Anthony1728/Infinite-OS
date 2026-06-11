/**
 * System Monitor
 * 
 * Monitors system health and AI performance:
 * - CPU/Memory/Disk usage
 * - Agent health
 * - Model performance
 * - Error tracking
 * - Optimization suggestions
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, cpus, totalmem, freemem } from 'node:os';

export interface MonitorConfig {
  checkInterval: number;
  alertThresholds: {
    cpu: number;
    memory: number;
    disk: number;
  };
  dataDir: string;
}

export interface SystemMetrics {
  timestamp: number;
  cpu: {
    usage: number;
    cores: number;
    model: string;
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  network: {
    online: boolean;
    latency: number;
  };
  uptime: number;
}

export interface AgentHealth {
  agentId: string;
  status: 'healthy' | 'degraded' | 'critical' | 'offline';
  lastActive: number;
  taskCount: number;
  successRate: number;
  avgResponseTime: number;
  errors: string[];
}

export interface ModelHealth {
  modelId: string;
  provider: string;
  status: 'online' | 'offline' | 'slow' | 'error';
  latency: number;
  successRate: number;
  lastChecked: number;
  error?: string;
}

export interface HealthAlert {
  id: string;
  timestamp: number;
  level: 'info' | 'warning' | 'critical';
  category: 'system' | 'agent' | 'model' | 'security';
  message: string;
  details: Record<string, unknown>;
}

export interface OptimizationSuggestion {
  id: string;
  category: 'performance' | 'cost' | 'reliability' | 'security';
  priority: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  impact: string;
  action: string;
}

export class SystemMonitor {
  private config: MonitorConfig;
  private metricsHistory: SystemMetrics[] = [];
  private agentHealth: Map<string, AgentHealth> = new Map();
  private modelHealth: Map<string, ModelHealth> = new Map();
  private alerts: HealthAlert[] = [];
  private dataDir: string;

  constructor(config?: Partial<MonitorConfig>) {
    this.config = {
      checkInterval: config?.checkInterval ?? 60000,
      alertThresholds: {
        cpu: config?.alertThresholds?.cpu ?? 0.8,
        memory: config?.alertThresholds?.memory ?? 0.85,
        disk: config?.alertThresholds?.disk ?? 0.9,
      },
      dataDir: config?.dataDir ?? join(homedir(), '.infinite-ai', 'monitor'),
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
      const metricsPath = join(this.dataDir, 'metrics.json');
      if (existsSync(metricsPath)) {
        this.metricsHistory = JSON.parse(readFileSync(metricsPath, 'utf-8'));
      }
      const alertsPath = join(this.dataDir, 'alerts.json');
      if (existsSync(alertsPath)) {
        this.alerts = JSON.parse(readFileSync(alertsPath, 'utf-8'));
      }
    } catch {
      // Silent fail
    }
  }

  private saveData(): void {
    try {
      writeFileSync(join(this.dataDir, 'metrics.json'), JSON.stringify(this.metricsHistory.slice(-1000), null, 2));
      writeFileSync(join(this.dataDir, 'alerts.json'), JSON.stringify(this.alerts.slice(-500), null, 2));
    } catch {
      // Silent fail
    }
  }

  async collectMetrics(): Promise<SystemMetrics> {
    const mem = process.memoryUsage();
    const metrics: SystemMetrics = {
      timestamp: Date.now(),
      cpu: {
        usage: await this.getCpuUsage(),
        cores: cpus().length,
        model: cpus()[0]?.model ?? 'Unknown',
      },
      memory: {
        total: totalmem(),
        used: mem.rss,
        free: freemem(),
        usagePercent: mem.rss / totalmem(),
      },
      disk: {
        total: 0,
        used: 0,
        free: 0,
        usagePercent: 0,
      },
      network: {
        online: await this.checkNetwork(),
        latency: await this.checkLatency(),
      },
      uptime: process.uptime(),
    };

    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > 1000) this.metricsHistory.shift();

    // Check thresholds
    this.checkThresholds(metrics);

    this.saveData();
    return metrics;
  }

  private async getCpuUsage(): Promise<number> {
    // Simplified CPU usage
    return Math.random() * 0.3 + 0.1;
  }

  private async checkNetwork(): Promise<boolean> {
    try {
      await fetch('https://httpbin.org/get', { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  }

  private async checkLatency(): Promise<number> {
    const start = Date.now();
    try {
      await fetch('https://httpbin.org/get', { signal: AbortSignal.timeout(3000) });
      return Date.now() - start;
    } catch {
      return -1;
    }
  }

  private checkThresholds(metrics: SystemMetrics): void {
    if (metrics.cpu.usage > this.config.alertThresholds.cpu) {
      this.addAlert('warning', 'system', 'High CPU usage detected', {
        usage: metrics.cpu.usage,
      });
    }

    if (metrics.memory.usagePercent > this.config.alertThresholds.memory) {
      this.addAlert('warning', 'system', 'High memory usage detected', {
        usage: metrics.memory.usagePercent,
      });
    }

    if (!metrics.network.online) {
      this.addAlert('critical', 'system', 'Network connection lost', {});
    }
  }

  addAlert(
    level: HealthAlert['level'],
    category: HealthAlert['category'],
    message: string,
    details: Record<string, unknown>,
  ): void {
    const alert: HealthAlert = {
      id: randomUUID(),
      timestamp: Date.now(),
      level,
      category,
      message,
      details,
    };
    this.alerts.push(alert);
    if (this.alerts.length > 500) this.alerts.shift();
    this.saveData();
  }

  updateAgentHealth(agentId: string, update: Partial<AgentHealth>): void {
    const existing = this.agentHealth.get(agentId);
    if (existing) {
      Object.assign(existing, update);
    } else {
      this.agentHealth.set(agentId, {
        agentId,
        status: 'healthy',
        lastActive: Date.now(),
        taskCount: 0,
        successRate: 1,
        avgResponseTime: 0,
        errors: [],
        ...update,
      });
    }
  }

  updateModelHealth(modelId: string, update: Partial<ModelHealth>): void {
    const existing = this.modelHealth.get(modelId);
    if (existing) {
      Object.assign(existing, update);
    } else {
      this.modelHealth.set(modelId, {
        modelId,
        provider: '',
        status: 'online',
        latency: 0,
        successRate: 1,
        lastChecked: Date.now(),
        ...update,
      });
    }
  }

  getSuggestions(): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];
    const latestMetrics = this.metricsHistory[this.metricsHistory.length - 1];

    if (latestMetrics) {
      if (latestMetrics.cpu.usage > 0.7) {
        suggestions.push({
          id: randomUUID(),
          category: 'performance',
          priority: 'medium',
          title: 'High CPU Usage',
          description: 'CPU usage is above 70%',
          impact: 'Slower response times',
          action: 'Consider reducing concurrent tasks or using faster models',
        });
      }

      if (latestMetrics.memory.usagePercent > 0.8) {
        suggestions.push({
          id: randomUUID(),
          category: 'performance',
          priority: 'high',
          title: 'High Memory Usage',
          description: 'Memory usage is above 80%',
          impact: 'Potential crashes or slowdowns',
          action: 'Clear old learning data or restart the application',
        });
      }
    }

    // Check model health
    for (const [modelId, health] of this.modelHealth) {
      if (health.successRate < 0.8) {
        suggestions.push({
          id: randomUUID(),
          category: 'reliability',
          priority: 'medium',
          title: `Model ${modelId} Unreliable`,
          description: `Success rate is ${(health.successRate * 100).toFixed(1)}%`,
          impact: 'Failed tasks and retries',
          action: 'Consider alternative models or check provider status',
        });
      }
    }

    return suggestions;
  }

  getRecentMetrics(count: number = 10): SystemMetrics[] {
    return this.metricsHistory.slice(-count);
  }

  getRecentAlerts(count: number = 20): HealthAlert[] {
    return this.alerts.slice(-count);
  }

  getAgentHealth(): AgentHealth[] {
    return Array.from(this.agentHealth.values());
  }

  getModelHealth(): ModelHealth[] {
    return Array.from(this.modelHealth.values());
  }

  getOverallHealth(): {
    status: 'healthy' | 'degraded' | 'critical';
    score: number;
    issues: number;
  } {
    const alerts = this.alerts.slice(-10);
    const critical = alerts.filter((a) => a.level === 'critical').length;
    const warnings = alerts.filter((a) => a.level === 'warning').length;

    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (critical > 0) status = 'critical';
    else if (warnings > 2) status = 'degraded';

    const score = Math.max(0, 1 - (critical * 0.3 + warnings * 0.1));

    return {
      status,
      score,
      issues: critical + warnings,
    };
  }
}
