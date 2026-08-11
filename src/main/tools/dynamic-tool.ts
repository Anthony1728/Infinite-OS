import type { Tool, ToolResult } from './base.js';
import { toolRegistry } from './base.js';

interface DynamicToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  executeScript: string;
  permission: 'none' | 'ask' | 'allow' | 'deny';
  createdAt: number;
  createdBy: string;
}

const dynamicTools = new Map<string, DynamicToolDef>();

export const dynamicToolTool: Tool = {
  name: 'DynamicTool',
  description:
    'Register, unregister, and manage custom tools at runtime. Create new tools from scripts, combine existing tools, or extend Infinite OS capabilities on the fly. This is how Infinite AI can add new capabilities without restarting.',
  permission: 'none',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['register', 'unregister', 'list', 'get', 'execute', 'update'],
        description: 'Dynamic tool action',
      },
      name: { type: 'string', description: 'Tool name' },
      description_text: { type: 'string', description: 'Tool description' },
      inputSchema: { type: 'object', description: 'JSON Schema for tool input' },
      executeScript: { type: 'string', description: 'JavaScript/TypeScript code to execute. Receives (args, ctx) and must return {content, is_error?}' },
      permission: { type: 'string', enum: ['none', 'ask', 'allow', 'deny'], description: 'Permission level' },
      toolName: { type: 'string', description: 'Tool name for unregister/get/update' },
      args: { type: 'object', description: 'Arguments for execute action' },
    },
    required: ['action'],
  },

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as {
      action: string;
      name?: string;
      description_text?: string;
      inputSchema?: Record<string, unknown>;
      executeScript?: string;
      permission?: string;
      toolName?: string;
      args?: Record<string, unknown>;
    };

    try {
      switch (input.action) {
        case 'register': {
          if (!input.name) return { content: 'name is required', is_error: true };
          if (!input.executeScript) return { content: 'executeScript is required', is_error: true };

          const toolDef: DynamicToolDef = {
            name: input.name,
            description: input.description_text || `Dynamic tool: ${input.name}`,
            inputSchema: input.inputSchema || { type: 'object', properties: {} },
            executeScript: input.executeScript,
            permission: (input.permission as DynamicToolDef['permission']) || 'none',
            createdAt: Date.now(),
            createdBy: ctx.sessionId,
          };

          dynamicTools.set(input.name, toolDef);

          const dynamicTool: Tool = {
            name: input.name,
            description: toolDef.description,
            inputSchema: toolDef.inputSchema,
            permission: toolDef.permission,
            execute: async (toolArgs, toolCtx): Promise<ToolResult> => {
              try {
                const fn = new Function('args', 'ctx', `
                  return (async () => {
                    ${toolDef.executeScript}
                  })();
                `);
                const result = await fn(toolArgs, toolCtx);
                return result as ToolResult;
              } catch (err) {
                return { content: `Dynamic tool error: ${(err as Error).message}`, is_error: true };
              }
            },
          };

          toolRegistry.register(dynamicTool);

          return {
            content: [
              `Tool registered: ${input.name}`,
              `Description: ${toolDef.description}`,
              `Permission: ${toolDef.permission}`,
              `Schema: ${JSON.stringify(toolDef.inputSchema)}`,
              '',
              'The tool is now available for use.',
            ].join('\n'),
          };
        }

        case 'unregister': {
          if (!input.toolName) return { content: 'toolName is required', is_error: true };

          const existed = dynamicTools.has(input.toolName);
          dynamicTools.delete(input.toolName);
          toolRegistry.unregister(input.toolName);

          return existed
            ? { content: `Tool unregistered: ${input.toolName}` }
            : { content: `Tool not found: ${input.toolName}`, is_error: true };
        }

        case 'list': {
          const tools = Array.from(dynamicTools.values());
          if (tools.length === 0) return { content: 'No dynamic tools registered yet.' };

          const lines = [`=== Dynamic Tools (${tools.length}) ===`, ''];
          for (const t of tools) {
            lines.push(`  ${t.name}: ${t.description}`);
            lines.push(`    Permission: ${t.permission} | Created: ${new Date(t.createdAt).toLocaleString()}`);
          }
          return { content: lines.join('\n') };
        }

        case 'get': {
          if (!input.toolName) return { content: 'toolName is required', is_error: true };
          const tool = dynamicTools.get(input.toolName);
          if (!tool) return { content: `Tool not found: ${input.toolName}`, is_error: true };

          return {
            content: [
              `=== ${tool.name} ===`,
              `Description: ${tool.description}`,
              `Permission: ${tool.permission}`,
              `Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`,
              `Execute Script:`,
              tool.executeScript,
            ].join('\n'),
          };
        }

        case 'execute': {
          if (!input.toolName) return { content: 'toolName is required', is_error: true };
          const tool = toolRegistry.get(input.toolName);
          if (!tool) return { content: `Tool not found: ${input.toolName}`, is_error: true };

          return await tool.execute(input.args || {}, ctx);
        }

        case 'update': {
          if (!input.toolName) return { content: 'toolName is required', is_error: true };
          const existing = dynamicTools.get(input.toolName);
          if (!existing) return { content: `Tool not found: ${input.toolName}`, is_error: true };

          if (input.description_text) existing.description = input.description_text;
          if (input.inputSchema) existing.inputSchema = input.inputSchema;
          if (input.executeScript) existing.executeScript = input.executeScript;
          if (input.permission) existing.permission = input.permission as DynamicToolDef['permission'];

          const dynamicTool: Tool = {
            name: existing.name,
            description: existing.description,
            inputSchema: existing.inputSchema,
            permission: existing.permission,
            execute: async (toolArgs, toolCtx): Promise<ToolResult> => {
              try {
                const fn = new Function('args', 'ctx', `
                  return (async () => {
                    ${existing.executeScript}
                  })();
                `);
                const result = await fn(toolArgs, toolCtx);
                return result as ToolResult;
              } catch (err) {
                return { content: `Dynamic tool error: ${(err as Error).message}`, is_error: true };
              }
            },
          };

          toolRegistry.register(dynamicTool);
          return { content: `Tool updated: ${existing.name}` };
        }

        default:
          return { content: `Unknown action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `DynamicTool error: ${(error as Error).message}`, is_error: true };
    }
  },
};
