import type { Tool, ToolResult } from './base.js';
import { ComputerControlAgent } from '../agent/computer.js';

let agent: ComputerControlAgent | null = null;

function getAgent(): ComputerControlAgent {
  if (!agent) agent = new ComputerControlAgent();
  return agent;
}

export const computerTool: Tool = {
  name: 'Computer',
  description: 'Control the computer: move/click mouse, type text, press keys, take screenshots, launch apps.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['mouse_click', 'mouse_move', 'type_text', 'key_press', 'screenshot', 'launch_app', 'list_apps'],
        description: 'The computer action to perform',
      },
      x: { type: 'number', description: 'X coordinate (for mouse actions)' },
      y: { type: 'number', description: 'Y coordinate (for mouse actions)' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (default: left)' },
      text: { type: 'string', description: 'Text to type or key to press' },
      app: { type: 'string', description: 'Application name or path to launch' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const { action, x, y, button, text, app } = args as {
      action: string;
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      text?: string;
      app?: string;
    };
    try {
      const agent = getAgent();
      switch (action) {
        case 'mouse_click': {
          if (x == null || y == null) return { content: 'x and y are required for mouse_click', is_error: true };
          const result = await agent.clickMouse(x, y, button ?? 'left');
          return { content: `Clicked at (${x}, ${y}) - success: ${result.success}` };
        }
        case 'mouse_move': {
          if (x == null || y == null) return { content: 'x and y are required for mouse_move', is_error: true };
          const result = await agent.moveMouse(x, y);
          return { content: `Moved mouse to (${x}, ${y}) - success: ${result.success}` };
        }
        case 'type_text': {
          if (!text) return { content: 'text is required for type_text', is_error: true };
          const result = await agent.typeText(text);
          return { content: `Typed ${text.length} characters - success: ${result.success}` };
        }
        case 'key_press': {
          if (!text) return { content: 'text (key name) is required for key_press', is_error: true };
          const result = await agent.pressKey(...text.split('+'));
          return { content: `Pressed key: ${text} - success: ${result.success}` };
        }
        case 'screenshot': {
          const result = await agent.captureScreen();
          return { content: `Screenshot saved: ${result.path} (${result.width}x${result.height})` };
        }
        case 'launch_app': {
          if (!app) return { content: 'app name is required for launch_app', is_error: true };
          const result = await agent.openApplication(app);
          return { content: `Launched ${app} - status: ${result.status}` };
        }
        case 'list_apps': {
          const apps = agent.getApplications();
          if (apps.length === 0) return { content: 'No applications registered yet.' };
          return { content: apps.map((a) => `${a.name} (${a.status})`).join('\n') };
        }
        default:
          return { content: `Unknown action: ${action}`, is_error: true };
      }
    } catch (e) {
      return { content: `Computer error: ${(e as Error).message}`, is_error: true };
    }
  },
};
