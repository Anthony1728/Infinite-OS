// Tool interface — every tool (built-in or MCP) implements this.

import type { ContentBlock } from '../../shared/types.js';

export interface ToolContext {
  cwd: string;
  abortSignal: AbortSignal;
  sessionId: string;
  onUpdate: (partial: ToolResult) => void;
}

export interface ToolResult {
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permission: 'none' | 'ask' | 'allow' | 'deny';

  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  asProviderTools() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}

export const toolRegistry = new ToolRegistry();
export { ToolRegistry };
