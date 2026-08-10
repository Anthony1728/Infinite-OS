// The `create_custom_agent` tool — allows the AI to create a custom agent
// with a name, description, system prompt, icon, color, and tool permissions.
// After creation, the agent can be spawned via the `Agent` tool.

import type { Tool, ToolResult } from './base.js';
import { createCustomAgent } from '../agents/custom-store.js';
import { listCustomAgents } from '../agents/custom-store.js';

const VALID_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite',
  'Browser', 'Computer', 'Email', 'BuildFeature', 'RollbackFeature', 'Notification',
];

export const createCustomAgentTool: Tool = {
  name: 'create_custom_agent',
  description: [
    'Create a new custom AI agent with a name, description, system prompt, icon, color, and allowed tools.',
    'Use this when a user asks you to create a new agent, build an agent, or configure an agent.',
    'After creation, the agent can be spawned using the `Agent` tool with its ID.',
    'Returns the created agent details including its ID.',
    'Naming tips: Use descriptive names like "Security Auditor", "Code Reviewer", "Data Analyst", etc.',
    'For system prompts: Be specific about the agent\'s role, expertise, and behavioral guidelines.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'The agent\'s display name (e.g. "Security Auditor", "Code Reviewer")',
        minLength: 1,
        maxLength: 60,
      },
      description: {
        type: 'string',
        description: 'Brief description of what this agent does (1-2 sentences)',
        maxLength: 200,
      },
      system_prompt: {
        type: 'string',
        description: 'Detailed system prompt / instructions that define the agent\'s behavior, expertise, and guidelines',
        minLength: 10,
        maxLength: 4000,
      },
      icon: {
        type: 'string',
        description: 'SVG path data for the agent\'s icon (a single path d attribute from heroicons)',
        default: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
      },
      color: {
        type: 'string',
        description: 'Hex color code for the agent\'s accent color (e.g. #8b5cf6, #10b981)',
        default: '#8b5cf6',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string', enum: VALID_TOOLS },
        description: 'List of tool names this agent is allowed to use',
        default: ['Read', 'Glob', 'Grep'],
      },
      max_turns: {
        type: 'integer',
        description: 'Maximum number of conversation turns before the agent auto-stops',
        default: 20,
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['name', 'description', 'system_prompt'],
  },
  permission: 'ask',

  async execute(args, _ctx): Promise<ToolResult> {
    const { name, description, system_prompt, icon, color, allowed_tools, max_turns } = args as {
      name: string;
      description: string;
      system_prompt: string;
      icon?: string;
      color?: string;
      allowed_tools?: string[];
      max_turns?: number;
    };

    // Basic validation
    if (!name || !name.trim()) {
      return { content: 'Error: Agent name is required.', is_error: true };
    }

    if (!description || !description.trim()) {
      return { content: 'Error: Agent description is required.', is_error: true };
    }

    if (!system_prompt || system_prompt.trim().length < 10) {
      return { content: 'Error: System prompt must be at least 10 characters.', is_error: true };
    }

    // Check for duplicate name
    const existing = listCustomAgents();
    if (existing.some((a) => a.name.toLowerCase() === name.trim().toLowerCase())) {
      return { content: `Error: An agent named "${name}" already exists. Please choose a different name.`, is_error: true };
    }

    try {
      const agent = createCustomAgent({
        name: name.trim(),
        description: description.trim(),
        icon: icon ?? 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z',
        color: color ?? '#8b5cf6',
        systemPrompt: system_prompt.trim(),
        allowedTools: allowed_tools ?? ['Read', 'Glob', 'Grep'],
        maxTurns: max_turns ?? 20,
      });

      return {
        content: [
          `✅ Agent created successfully!`,
          ``,
          `**Name:** ${agent.name}`,
          `**ID:** ${agent.id}`,
          `**Description:** ${agent.description}`,
          `**Color:** ${agent.color}`,
          `**Allowed Tools:** ${agent.allowedTools.join(', ')}`,
          `**Max Turns:** ${agent.maxTurns}`,
          ``,
          `The agent is now available and can be spawned using the \`Agent\` tool.`,
        ].join('\n'),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: `Failed to create agent: ${msg}`, is_error: true };
    }
  },
};
