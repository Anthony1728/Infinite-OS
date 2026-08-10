import type { Tool, ToolResult } from './base.js';
import { getComputerAutomation } from '../automation/computer-automation.js';

const ACTIONS = [
  'execute_task',
  'plan_task',
  'get_status',
] as const;

export const taskExecutorTool: Tool = {
  name: 'TaskExecutor',
  description:
    'Execute high-level computer tasks by breaking them into planned steps. Takes a natural language task description, plans the sequence of mouse, keyboard, window, and application actions needed, then executes each step. Use for multi-step tasks like "open Chrome, search for weather, and take a screenshot" or "open Notepad and type a summary".',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'Task executor action' },
      task: { type: 'string', description: 'Natural language description of the task to execute' },
      task_id: { type: 'string', description: 'Task ID to check status of (for get_status)' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: (typeof ACTIONS)[number];
      task?: string;
      task_id?: string;
    };
    const computer = getComputerAutomation();

    try {
      switch (input.action) {
        case 'execute_task': {
          if (!input.task) return missing('task');
          const result = await executeHighLevelTask(computer, input.task);
          return ok(result);
        }
        case 'plan_task': {
          if (!input.task) return missing('task');
          const plan = planTask(input.task);
          return ok(plan);
        }
        case 'get_status': {
          return ok(JSON.stringify({
            message: 'TaskExecutor is ready. Use execute_task to run a task or plan_task to see the planned steps.',
            capabilities: [
              'Launch and focus applications',
              'Type text and press keys',
              'Click, scroll, and drag with mouse',
              'Capture screenshots',
              'Open URLs in Chrome',
              'Manage windows (list, focus, minimize)',
              'Read clipboard content',
            ],
          }, null, 2));
        }
        default:
          return bad(`Unknown TaskExecutor action: ${input.action}`);
      }
    } catch (error) {
      return bad(`TaskExecutor action failed: ${(error as Error).message}`);
    }
  },
};

async function executeHighLevelTask(computer: ReturnType<typeof getComputerAutomation>, task: string): Promise<string> {
  const steps = parseTaskSteps(task);
  const results: string[] = [];

  results.push(`## Executing Task: ${task}`);
  results.push(`Planned ${steps.length} step(s)\n`);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    results.push(`### Step ${i + 1}: ${step.description}`);

    try {
      const stepResult = await executeStep(computer, step);
      results.push(`✅ ${stepResult}\n`);
    } catch (error) {
      results.push(`❌ Failed: ${(error as Error).message}\n`);
      results.push('Stopping execution due to step failure.');
      break;
    }

    // Small delay between steps for stability
    await new Promise((r) => setTimeout(r, 300));
  }

  results.push('---');
  results.push('Task execution complete.');
  return results.join('\n');
}

interface TaskStep {
  action: string;
  description: string;
  params: Record<string, string | number>;
}

function parseTaskSteps(task: string): TaskStep[] {
  const steps: TaskStep[] = [];
  const lower = task.toLowerCase();

  // Open/launch application
  const appMatch = lower.match(/(?:open|launch|start|run)\s+(.+?)(?:\s+and|\s+then|\s*,|$)/);
  if (appMatch) {
    const appName = appMatch[1].trim();
    steps.push({
      action: 'open_app',
      description: `Open ${appName}`,
      params: { app: appName },
    });
  }

  // Open URL
  const urlMatch = task.match(/(?:go to|navigate to|open)\s+(https?:\/\/\S+)/i);
  if (urlMatch) {
    steps.push({
      action: 'open_url',
      description: `Navigate to ${urlMatch[1]}`,
      params: { url: urlMatch[1] },
    });
  }

  // Type text
  const typeMatch = task.match(/(?:type|write|enter|input)\s+["'](.+?)["']/i) ||
    task.match(/(?:type|write|enter|input)\s+(.+?)(?:\s+and|\s+then|\s*,|$)/i);
  if (typeMatch) {
    steps.push({
      action: 'type_text',
      description: `Type text`,
      params: { text: typeMatch[1].trim() },
    });
  }

  // Press key
  const keyMatch = task.match(/(?:press|hit|push)\s+(enter|tab|escape|space|backspace|delete|up|down|left|right|f\d+|ctrl\+\w|alt\+\w|shift\+\w)/i);
  if (keyMatch) {
    steps.push({
      action: 'press_key',
      description: `Press ${keyMatch[1]}`,
      params: { key: keyMatch[1] },
    });
  }

  // Hotkey
  const hotkeyMatch = task.match(/(?:press|hit|use)\s+((?:ctrl|alt|shift|win)\s*\+\s*\w+(?:\s*\+\s*\w+)*)/i);
  if (hotkeyMatch) {
    steps.push({
      action: 'hotkey',
      description: `Press hotkey ${hotkeyMatch[1]}`,
      params: { keys: hotkeyMatch[1].replace(/\s/g, '') },
    });
  }

  // Take screenshot
  if (lower.includes('screenshot') || lower.includes('capture screen') || lower.includes('take a picture')) {
    steps.push({
      action: 'screenshot',
      description: 'Take a screenshot',
      params: {},
    });
  }

  // Click (general)
  if (lower.includes('click') && !lower.includes('double click')) {
    const clickMatch = task.match(/click\s+(?:at\s+)?(\d+)\s*[,x]\s*(\d+)/i);
    if (clickMatch) {
      steps.push({
        action: 'click',
        description: `Click at (${clickMatch[1]}, ${clickMatch[2]})`,
        params: { x: parseInt(clickMatch[1]), y: parseInt(clickMatch[2]) },
      });
    } else if (lower.includes('click on') || lower.includes('click the')) {
      steps.push({
        action: 'click',
        description: `Click on UI element (use visual_observe first to find coordinates)`,
        params: {},
      });
    }
  }

  // Scroll
  const scrollMatch = task.match(/scroll\s+(up|down)\s*(?:by\s+)?(\d+)?/i);
  if (scrollMatch) {
    steps.push({
      action: 'scroll',
      description: `Scroll ${scrollMatch[1]}${scrollMatch[2] ? ` by ${scrollMatch[2]}` : ''}`,
      params: { direction: scrollMatch[1], amount: scrollMatch[2] ? parseInt(scrollMatch[2]) : 3 },
    });
  }

  // Wait
  if (lower.includes('wait') || lower.includes('pause')) {
    const waitMatch = task.match(/wait\s+(?:for\s+)?(\d+)\s*(?:seconds?|secs?|ms|milliseconds?)/i);
    const ms = waitMatch ? (lower.includes('ms') || lower.includes('millisecond') ? parseInt(waitMatch[1]) : parseInt(waitMatch[1]) * 1000) : 2000;
    steps.push({
      action: 'wait',
      description: `Wait ${ms}ms`,
      params: { ms },
    });
  }

  // Close app
  const closeMatch = lower.match(/(?:close|quit|exit)\s+(.+?)(?:\s+and|\s+then|\s*,|$)/);
  if (closeMatch) {
    steps.push({
      action: 'close_app',
      description: `Close ${closeMatch[1].trim()}`,
      params: { app: closeMatch[1].trim() },
    });
  }

  // If no steps parsed, create a general observation step
  if (steps.length === 0) {
    steps.push({
      action: 'observe',
      description: 'Observe current screen state',
      params: {},
    });
    steps.push({
      action: 'type_text',
      description: `Type the requested text`,
      params: { text: task },
    });
  }

  return steps;
}

function planTask(task: string): string {
  const steps = parseTaskSteps(task);
  let plan = `## Task Plan: ${task}\n\n`;
  plan += `**Steps:** ${steps.length}\n\n`;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    plan += `${i + 1}. **${step.action}** — ${step.description}\n`;
    if (Object.keys(step.params).length > 0) {
      plan += `   Params: ${JSON.stringify(step.params)}\n`;
    }
  }

  plan += '\nUse `execute_task` to run this plan.';
  return plan;
}

async function executeStep(computer: ReturnType<typeof getComputerAutomation>, step: TaskStep): Promise<string> {
  switch (step.action) {
    case 'open_app': {
      const app = step.params.app as string;
      const success = await computer.openApp(app);
      return success ? `Opened ${app}` : `Could not open ${app}`;
    }
    case 'open_url': {
      const url = step.params.url as string;
      await computer.openApp('chrome');
      await new Promise((r) => setTimeout(r, 1500));
      await computer.focusWindow('Chrome');
      await computer.hotkey('ctrl', 'l');
      await computer.typeText(url, 8);
      await computer.pressKey('enter');
      return `Navigated to ${url}`;
    }
    case 'type_text': {
      const text = step.params.text as string;
      await computer.typeText(text, 10);
      return `Typed ${text.length} characters`;
    }
    case 'press_key': {
      const key = step.params.key as string;
      await computer.pressKey(key);
      return `Pressed ${key}`;
    }
    case 'hotkey': {
      const keys = (step.params.keys as string).split('+').map((k) => k.trim());
      await computer.hotkey(...keys);
      return `Pressed hotkey ${step.params.keys}`;
    }
    case 'screenshot': {
      const capture = await computer.captureScreen();
      return `Screenshot saved to ${capture.path}`;
    }
    case 'click': {
      if (step.params.x != null && step.params.y != null) {
        await computer.click(step.params.x as number, step.params.y as number);
        return `Clicked at (${step.params.x}, ${step.params.y})`;
      }
      return 'Click requires coordinates (use visual_observe first)';
    }
    case 'scroll': {
      const screen = await computer.getScreenSize();
      const dir = step.params.direction as string;
      const amount = (step.params.amount as number) * (dir === 'up' ? 1 : -1);
      await computer.scroll(screen.width / 2, screen.height / 2, amount);
      return `Scrolled ${dir}`;
    }
    case 'wait': {
      const ms = step.params.ms as number;
      await new Promise((r) => setTimeout(r, ms));
      return `Waited ${ms}ms`;
    }
    case 'close_app': {
      const app = step.params.app as string;
      const success = await computer.closeApp(app);
      return success ? `Closed ${app}` : `Could not close ${app}`;
    }
    case 'observe': {
      const state = await computer.getDesktopState();
      return `Active window: ${state.activeWindow ?? 'none'}, Screen: ${state.screen.width}x${state.screen.height}`;
    }
    default:
      return `Unknown step action: ${step.action}`;
  }
}

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}

function missing(fields: string): ToolResult {
  return { content: `TaskExecutor action requires ${fields}.`, is_error: true };
}
