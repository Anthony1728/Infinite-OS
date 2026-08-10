import type { Tool, ToolResult } from './base.js';
import { getComputerAutomation } from '../automation/computer-automation.js';
import { execSync } from 'child_process';

const ACTIONS = [
  'launch_game',
  'analyze_screen',
  'send_keys',
  'send_key',
  'mouse_action',
  'list_games',
  'game_state',
] as const;

export const gameAssistantTool: Tool = {
  name: 'GameAssistant',
  description:
    'Play and assist with games on the computer. Launch games, analyze the current screen to understand game state, send keyboard/mouse inputs to the game, and list installed games. Uses screenshot analysis to describe what is happening on screen and suggest or execute actions.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'Game assistant action to perform' },
      game: { type: 'string', description: 'Game name or path to launch' },
      keys: { type: 'string', description: 'Key or hotkey sequence to send (e.g. "w", "ctrl+c", "space")' },
      x: { type: 'number', description: 'Mouse X coordinate for mouse_action' },
      y: { type: 'number', description: 'Mouse Y coordinate for mouse_action' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button for mouse_action' },
      prompt: { type: 'string', description: 'Additional context or question about the game screen for analyze_screen' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: (typeof ACTIONS)[number];
      game?: string;
      keys?: string;
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      prompt?: string;
    };
    const computer = getComputerAutomation();

    try {
      switch (input.action) {
        case 'launch_game': {
          if (!input.game) return missing('game');
          const launched = await computer.openApp(input.game);
          if (!launched) return bad(`Could not launch "${input.game}". Check the name or path.`);
          await new Promise((r) => setTimeout(r, 2000));
          return ok(`Launched "${input.game}". Use analyze_screen to see the current state.`);
        }
        case 'analyze_screen': {
          const capture = await computer.captureScreen();
          const state = await computer.getDesktopState();
          const parts = [
            `Screenshot saved: ${capture.path} (${capture.width}x${capture.height})`,
            `Active window: ${state.activeWindow ?? 'none'}`,
            `Screen size: ${state.screen.width}x${state.screen.height}`,
          ];
          if (input.prompt) {
            parts.push(`User question: ${input.prompt}`);
          }
          parts.push(
            'The screenshot has been captured. Analyze the image to understand the game state, ' +
            'describe what you see, and suggest the next action the user should take or execute it for them.'
          );
          return ok(parts.join('\n'));
        }
        case 'send_keys': {
          if (!input.keys) return missing('keys');
          const keys = input.keys.split('+').map((k) => k.trim());
          await computer.hotkey(...keys);
          return ok(`Sent hotkey: ${input.keys}`);
        }
        case 'send_key': {
          if (!input.keys) return missing('keys');
          await computer.pressKey(input.keys);
          return ok(`Pressed key: ${input.keys}`);
        }
        case 'mouse_action': {
          if (input.x == null || input.y == null) return missing('x and y');
          await computer.click(input.x, input.y, input.button ?? 'left');
          return ok(`Clicked ${input.button ?? 'left'} at (${input.x}, ${input.y}).`);
        }
        case 'list_games': {
          const games = findInstalledGames();
          if (games.length === 0) {
            return ok('No commonly installed games found. You can launch any game by name or full path using launch_game.');
          }
          return ok(`Found ${games.length} installed game(s):\n${games.map((g) => `  - ${g}`).join('\n')}`);
        }
        case 'game_state': {
          const [frame, desktopState] = await Promise.all([
            computer.captureLiveFrame(),
            computer.getDesktopState(),
          ]);
          return ok(JSON.stringify({
            frame: { path: frame.path, width: frame.width, height: frame.height },
            activeWindow: desktopState.activeWindow,
            screen: desktopState.screen,
            message: 'Live game frame captured. Analyze the image to determine the current game state.',
          }, null, 2));
        }
        default:
          return bad(`Unknown GameAssistant action: ${input.action}`);
      }
    } catch (error) {
      return bad(`GameAssistant action failed: ${(error as Error).message}`);
    }
  },
};

function findInstalledGames(): string[] {
  const games: string[] = [];
  const searchPaths = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common',
    'C:\\Program Files\\Steam\\steamapps\\common',
    process.env['LOCALAPPDATA'] + '\\Programs',
    process.env['PROGRAMFILES'] + '',
    process.env['PROGRAMFILES(X86)'] + '',
  ].filter(Boolean) as string[];

  for (const dir of searchPaths) {
    try {
      const entries = execSync(`dir /b /ad "${dir}" 2>nul`, { encoding: 'utf-8', timeout: 5000 })
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      for (const entry of entries) {
        if (/\.(exe|bat|lnk)$/i.test(entry) || /game|play|hero|quest|craft|war|battle|doom|fortnite|minecraft|valorant|league|apex|destiny/i.test(entry)) {
          games.push(entry);
        }
      }
    } catch {
      // directory doesn't exist or not accessible
    }
  }

  // Also check desktop shortcuts
  const desktopPath = process.env['USERPROFILE'] + '\\Desktop';
  try {
    const shortcuts = execSync(`dir /b "${desktopPath}\\*.lnk" 2>nul`, { encoding: 'utf-8', timeout: 3000 })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const s of shortcuts) {
      if (/game|play|hero|quest|craft|war|battle|doom|fortnite|minecraft|valorant|league|apex|destiny/i.test(s)) {
        games.push(s.replace(/\.lnk$/i, ''));
      }
    }
  } catch {
    // desktop not accessible
  }

  return [...new Set(games)].slice(0, 30);
}

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}

function missing(fields: string): ToolResult {
  return { content: `GameAssistant action requires ${fields}.`, is_error: true };
}
