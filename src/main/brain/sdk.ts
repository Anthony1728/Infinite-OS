/**
 * Developer SDK
 * 
 * API for developers to extend Infinite AI:
 * - Create custom tools
 * - Create custom agents
 * - Create workflows
 * - Access brain APIs
 */

import { randomUUID } from 'node:crypto';

export interface SDKConfig {
  apiKey: string;
  baseUrl: string;
  version: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  sessionId: string;
  userId: string;
  brain: {
    learn: (data: Record<string, unknown>) => void;
    decide: (task: string) => { model: string; confidence: number };
  };
  tools: {
    call: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  maxTurns: number;
  onMessage?: (message: string) => void;
}

export interface WorkflowDefinition {
  name: string;
  description: string;
  steps: Array<{
    name: string;
    type: 'tool' | 'agent' | 'condition';
    config: Record<string, unknown>;
  }>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  tools: ToolDefinition[];
  agents: AgentDefinition[];
  workflows: WorkflowDefinition[];
}

export class DeveloperSDK {
  private config: SDKConfig;
  private tools: Map<string, ToolDefinition> = new Map();
  private agents: Map<string, AgentDefinition> = new Map();
  private workflows: Map<string, WorkflowDefinition> = new Map();

  constructor(config?: Partial<SDKConfig>) {
    this.config = {
      apiKey: config?.apiKey ?? '',
      baseUrl: config?.baseUrl ?? 'http://localhost:3001',
      version: config?.version ?? '1.0.0',
    };
  }

  // Tool creation
  createTool(definition: ToolDefinition): string {
    const id = randomUUID();
    this.tools.set(id, definition);
    return id;
  }

  getTool(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  listTools(): Array<{ id: string } & ToolDefinition> {
    return Array.from(this.tools.entries()).map(([id, def]) => ({ id, ...def }));
  }

  // Agent creation
  createAgent(definition: AgentDefinition): string {
    const id = randomUUID();
    this.agents.set(id, definition);
    return id;
  }

  getAgent(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  listAgents(): Array<{ id: string } & AgentDefinition> {
    return Array.from(this.agents.entries()).map(([id, def]) => ({ id, ...def }));
  }

  // Workflow creation
  createWorkflow(definition: WorkflowDefinition): string {
    const id = randomUUID();
    this.workflows.set(id, definition);
    return id;
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  listWorkflows(): Array<{ id: string } & WorkflowDefinition> {
    return Array.from(this.workflows.entries()).map(([id, def]) => ({ id, ...def }));
  }

  // Plugin management
  loadPlugin(manifest: PluginManifest): void {
    for (const tool of manifest.tools) {
      this.createTool(tool);
    }
    for (const agent of manifest.agents) {
      this.createAgent(agent);
    }
    for (const workflow of manifest.workflows) {
      this.createWorkflow(workflow);
    }
  }

  exportPlugin(id: string): PluginManifest | null {
    return {
      id,
      name: `Plugin ${id}`,
      version: '1.0.0',
      description: 'Custom plugin',
      author: 'Developer',
      tools: this.listTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        outputSchema: t.outputSchema,
        execute: t.execute,
      })),
      agents: this.listAgents().map((a) => ({
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        tools: a.tools,
        maxTurns: a.maxTurns,
      })),
      workflows: this.listWorkflows().map((w) => ({
        name: w.name,
        description: w.description,
        steps: w.steps,
      })),
    };
  }

  // API access
  async apiCall(endpoint: string, method: string, body?: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    return response.json();
  }

  // SDK info
  getInfo(): {
    version: string;
    toolsCount: number;
    agentsCount: number;
    workflowsCount: number;
  } {
    return {
      version: this.config.version,
      toolsCount: this.tools.size,
      agentsCount: this.agents.size,
      workflowsCount: this.workflows.size,
    };
  }
}

