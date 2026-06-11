/**
 * MCP Tool Registry
 * 
 * Manages MCP tools that the CoreAgent can use.
 * Tools are registered here and made available to the agent loop.
 */

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface MCPRegistry {
  tools: Map<string, MCPTool>;
  register(tool: MCPTool): void;
  unregister(name: string): void;
  get(name: string): MCPTool | undefined;
  list(): MCPTool[];
}

export class InMemoryMCPRegistry implements MCPRegistry {
  tools: Map<string, MCPTool> = new Map();

  register(tool: MCPTool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): MCPTool | undefined {
    return this.tools.get(name);
  }

  list(): MCPTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Register built-in tools from the existing tool registry
   */
  registerBuiltInTools(toolRegistry: {
    list: () => Array<{
      name: string;
      description: string;
      input_schema: Record<string, unknown>;
      execute: (input: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;
    }>;
  }): void {
    for (const tool of toolRegistry.list()) {
      this.register({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.input_schema,
        execute: async (input) => {
          const result = await tool.execute(input, {
            sessionId: 'default',
            cwd: process.cwd(),
            signal: AbortSignal.timeout(30000),
          });
          return typeof result === 'string' ? result : JSON.stringify(result);
        },
      });
    }
  }
}

// Singleton instance
let registry: InMemoryMCPRegistry | null = null;

export function getMCPRegistry(): InMemoryMCPRegistry {
  if (!registry) {
    registry = new InMemoryMCPRegistry();
  }
  return registry;
}

export function createMCPRegistry(): InMemoryMCPRegistry {
  return new InMemoryMCPRegistry();
}
