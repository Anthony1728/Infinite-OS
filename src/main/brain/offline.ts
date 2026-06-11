/**
 * Offline Mode Manager
 * 
 * Handles graceful degradation when internet is unavailable:
 * - Detects connectivity status
 * - Falls back to local models
 * - Manages cached capabilities
 * - Provides offline-first operations
 */

export interface OfflineConfig {
  checkInterval: number;
  localModelProvider: string;
  localModelId: string;
  cacheSize: number;
  enableGracefulDegradation: boolean;
}

export interface ConnectivityStatus {
  online: boolean;
  lastChecked: number;
  latency: number;
  providerStatus: Record<string, 'online' | 'offline' | 'slow'>;
}

export interface OfflineCapability {
  name: string;
  available: boolean;
  degraded: boolean;
  alternative?: string;
}

export class OfflineManager {
  private config: OfflineConfig;
  private status: ConnectivityStatus;
  private capabilities: OfflineCapability[] = [];
  private connectivityHistory: boolean[] = [];

  constructor(config?: Partial<OfflineConfig>) {
    this.config = {
      checkInterval: config?.checkInterval ?? 30000,
      localModelProvider: config?.localModelProvider ?? 'ollama',
      localModelId: config?.localModelId ?? 'llama3.1:8b',
      cacheSize: config?.cacheSize ?? 1000,
      enableGracefulDegradation: config?.enableGracefulDegradation ?? true,
    };

    this.status = {
      online: true,
      lastChecked: Date.now(),
      latency: 0,
      providerStatus: {},
    };

    this.initCapabilities();
  }

  private initCapabilities(): void {
    this.capabilities = [
      { name: 'chat', available: true, degraded: false },
      { name: 'code_generation', available: true, degraded: false },
      { name: 'file_operations', available: true, degraded: false },
      { name: 'web_search', available: true, degraded: true, alternative: 'cached_search' },
      { name: 'api_calls', available: true, degraded: true, alternative: 'local_fallback' },
      { name: 'vision', available: true, degraded: true, alternative: 'text_only' },
      { name: 'real_time_data', available: true, degraded: true, alternative: 'cached_data' },
    ];
  }

  async checkConnectivity(): Promise<ConnectivityStatus> {
    const start = Date.now();

    try {
      // Try to reach a reliable endpoint
      const response = await fetch('https://httpbin.org/get', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      const latency = Date.now() - start;

      this.status = {
        online: response.ok,
        lastChecked: Date.now(),
        latency,
        providerStatus: {
          openrouter: response.ok ? 'online' : 'offline',
          anthropic: response.ok ? 'online' : 'offline',
          openai: response.ok ? 'online' : 'offline',
          gemini: response.ok ? 'online' : 'offline',
          ollama: 'online', // Local, always available
        },
      };
    } catch {
      this.status = {
        online: false,
        lastChecked: Date.now(),
        latency: -1,
        providerStatus: {
          openrouter: 'offline',
          anthropic: 'offline',
          openai: 'offline',
          gemini: 'offline',
          ollama: 'online',
        },
      };
    }

    this.connectivityHistory.push(this.status.online);
    if (this.connectivityHistory.length > 100) this.connectivityHistory.shift();

    return this.status;
  }

  getStatus(): ConnectivityStatus {
    return { ...this.status };
  }

  isOnline(): boolean {
    return this.status.online;
  }

  getBestAvailableModel(preferredProvider?: string): { provider: string; model: string } {
    if (this.status.online && preferredProvider && this.status.providerStatus[preferredProvider] === 'online') {
      return {
        provider: preferredProvider,
        model: this.getProviderModel(preferredProvider),
      };
    }

    if (this.status.online) {
      // Find any online provider
      for (const [provider, status] of Object.entries(this.status.providerStatus)) {
        if (status === 'online' && provider !== 'ollama') {
          return {
            provider,
            model: this.getProviderModel(provider),
          };
        }
      }
    }

    // Fallback to local
    return {
      provider: this.config.localModelProvider,
      model: this.config.localModelId,
    };
  }

  private getProviderModel(provider: string): string {
    const models: Record<string, string> = {
      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
      anthropic: 'claude-3-5-sonnet-20241022',
      openai: 'gpt-4o',
      gemini: 'gemini-2.0-flash-exp',
      ollama: 'llama3.1:8b',
    };
    return models[provider] ?? 'llama3.1:8b';
  }

  getCapabilities(): OfflineCapability[] {
    if (this.status.online) {
      return this.capabilities.map((c) => ({ ...c, available: true, degraded: false }));
    }

    return this.capabilities.map((c) => ({
      ...c,
      available: c.name === 'chat' || c.name === 'code_generation' || c.name === 'file_operations',
      degraded: c.degraded,
    }));
  }

  getConnectivityScore(): number {
    if (this.connectivityHistory.length === 0) return 1;
    const onlineCount = this.connectivityHistory.filter(Boolean).length;
    return onlineCount / this.connectivityHistory.length;
  }

  getRecommendation(): string {
    const score = this.getConnectivityScore();

    if (score > 0.9) return 'Stable connection - use cloud models for best quality';
    if (score > 0.7) return 'Unstable connection - consider local model fallback';
    if (score > 0.5) return 'Poor connection - prefer local models';
    return 'No connection - using offline mode with local models';
  }
}
