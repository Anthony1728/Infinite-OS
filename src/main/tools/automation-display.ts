import type { Tool, ToolResult } from './base.js';
import { getAutomationDisplayState, setAutomationDisplayPreference, type AutomationDisplayPreference } from '../automation/display-policy.js';

export const automationDisplayTool: Tool = {
  name: 'AutomationDisplay',
  description: 'Get or change whether Infinite OS automation is visible or runs behind Infinite OS. Smart mode is the default: visible while windowed, background while full screen. Use this when the user asks to change background/visible PC control behavior.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'set'] },
      preference: { type: 'string', enum: ['smart', 'always-visible', 'always-background'] },
    },
    required: ['action'],
  },
  permission: 'allow',
  async execute(args, context): Promise<ToolResult> {
    const input = args as { action: 'get' | 'set'; preference?: AutomationDisplayPreference };
    if (input.action === 'set') {
      if (!input.preference) return { content: 'preference is required', is_error: true };
      const state = await setAutomationDisplayPreference(input.preference, context.cwd);
      return { content: JSON.stringify({ ...state, message: state.preference === 'smart' ? 'Automation is visible while windowed and background-only while full screen.' : `Automation is now ${state.mode}.` }) };
    }
    return { content: JSON.stringify(getAutomationDisplayState()) };
  },
};

