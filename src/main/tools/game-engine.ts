import type { Tool, ToolContext, ToolResult } from './base.js';
import { getComputerAutomation } from '../automation/computer-automation.js';
import { getOCR } from '../ocr/index.js';

interface GameStrategy {
  name: string;
  description: string;
  genre: string;
  actions: string[];
  tips: string[];
}

const GAME_STRATEGIES: Record<string, GameStrategy> = {
  chess: {
    name: 'Chess Strategy',
    description: 'AI-powered chess analysis and move suggestion',
    genre: 'strategy',
    actions: ['analyze_board', 'suggest_move', 'evaluate_position', 'play_move'],
    tips: [
      'Control the center (e4, d4, e5, d5 squares)',
      'Develop knights before bishops',
      'Castle early for king safety',
      'Look for tactics: forks, pins, skewers, discovered attacks',
      'Calculate at least 2-3 moves ahead',
    ],
  },
  solitaire: {
    name: 'Solitaire Strategy',
    description: 'Play and win solitaire games',
    genre: 'puzzle',
    actions: ['scan_cards', 'find_move', 'make_move', 'auto_play'],
    tips: [
      'Always move cards from tableau to foundation when possible',
      'Uncover face-down cards when possible',
      'Keep columns balanced',
      'Draw from stock only when no tableau moves available',
    ],
  },
  minesweeper: {
    name: 'Minesweeper Solver',
    description: 'Auto-solve minesweeper puzzles',
    genre: 'puzzle',
    actions: ['scan_board', 'calculate_mines', 'flag_mine', 'reveal_safe'],
    tips: [
      'Use number hints to determine safe cells',
      'Flag cells that must contain mines',
      'Use logic: if a cell touches N mines and has N flagged neighbors, remaining neighbors are safe',
      'Start with edges and corners where more info is available',
    ],
  },
  sudoko: {
    name: 'Sudoku Solver',
    description: 'Solve sudoku puzzles with AI',
    genre: 'puzzle',
    actions: ['scan_puzzle', 'analyze_candidates', 'fill_cell', 'solve'],
    tips: [
      'Scan rows, columns, and 3x3 boxes for missing numbers',
      'Use pencil marks to track candidates',
      'Look for naked singles (only one candidate in a cell)',
      'Look for hidden singles (number appears only once in a row/col/box)',
    ],
  },
  wordle: {
    name: 'Wordle Solver',
    description: 'Optimal Wordle solving strategy',
    genre: 'word',
    actions: ['analyze_guess', 'suggest_word', 'eliminate', 'solve'],
    tips: [
      'Start with common vowels: ADIEU, AUDIO, RAISE',
      'Use information theory: pick words that eliminate most possibilities',
      'Track green (correct position) and yellow (wrong position) letters',
      'Consider letter frequency in English',
    ],
  },
  generic: {
    name: 'Generic Game Strategy',
    description: 'General-purpose game playing strategy',
    genre: 'any',
    actions: ['observe', 'analyze', 'decide', 'act', 'learn'],
    tips: [
      'Observe the game state carefully',
      'Identify win conditions and obstacles',
      'Look for patterns and shortcuts',
      'Practice makes perfect - learn from failures',
    ],
  },
};

function findGameStrategy(gameName: string): GameStrategy {
  const lower = gameName.toLowerCase();
  for (const [key, strategy] of Object.entries(GAME_STRATEGIES)) {
    if (lower.includes(key)) return strategy;
  }
  return GAME_STRATEGIES.generic;
}

export const gameEngineTool: Tool = {
  name: 'GameEngine',
  description:
    'AI game engine that can play and strategize for various games: chess, solitaire, minesweeper, sudoku, Wordle, and more. Can observe game state via screenshot, analyze moves, and execute optimal strategies. Use for game assistance, auto-play, or learning game strategies.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['observe', 'analyze', 'suggest', 'play', 'auto_play', 'strategies', 'learn'],
        description: 'Game engine action',
      },
      game: { type: 'string', description: 'Game name (chess, solitaire, minesweeper, sudoku, wordle, etc.)' },
      prompt: { type: 'string', description: 'Additional context or question about the game' },
      move: { type: 'string', description: 'Specific move to execute (e.g., "e2 to e4" for chess)' },
      maxMoves: { type: 'number', description: 'Maximum moves for auto_play (default 20)' },
    },
    required: ['action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      game?: string;
      prompt?: string;
      move?: string;
      maxMoves?: number;
    };

    const computer = getComputerAutomation();
    const ocr = getOCR();

    try {
      switch (input.action) {
        case 'strategies': {
          const lines = ['=== Available Game Strategies ===', ''];
          for (const [key, strategy] of Object.entries(GAME_STRATEGIES)) {
            if (key === 'generic') continue;
            lines.push(`--- ${strategy.name} (${strategy.genre}) ---`);
            lines.push(`  ${strategy.description}`);
            lines.push(`  Actions: ${strategy.actions.join(', ')}`);
            lines.push(`  Tips:`);
            for (const tip of strategy.tips) {
              lines.push(`    - ${tip}`);
            }
            lines.push('');
          }
          lines.push('Use "observe" to let me see the current game state.');
          return { content: lines.join('\n') };
        }

        case 'observe': {
          const capture = await computer.captureScreen();
          const screenText = await ocr.recognizeText(capture.path);

          const strategy = input.game ? findGameStrategy(input.game) : null;

          return {
            content: [
              '=== Game Observation ===',
              `Screenshot: ${capture.path}`,
              `Dimensions: ${capture.width}x${capture.height}`,
              '',
              '--- Detected Text/Elements ---',
              screenText || '(no text detected)',
              '',
              strategy ? `Strategy loaded: ${strategy.name}` : 'Use "analyze" with a game name for strategy.',
              '',
              '--- Desktop State ---',
              JSON.stringify(await computer.getDesktopState(), null, 2),
            ].join('\n'),
          };
        }

        case 'analyze': {
          if (!input.game) return { content: 'game parameter is required for analysis', is_error: true };
          const strategy = findGameStrategy(input.game);
          const capture = await computer.captureScreen();
          const screenText = await ocr.recognizeText(capture.path);

          const lines = [
            `=== ${strategy.name} Analysis ===`,
            `Genre: ${strategy.genre}`,
            '',
            '--- Current Screen ---',
            screenText.slice(0, 2000),
            '',
            '--- Strategy Tips ---',
            ...strategy.tips.map((tip) => `  - ${tip}`),
            '',
            '--- Available Actions ---',
            ...strategy.actions.map((action) => `  - ${action}`),
          ];

          if (input.prompt) {
            lines.push('', '--- User Question ---', input.prompt);
            lines.push('', '(AI will analyze and respond to your question based on the screenshot)');
          }

          return { content: lines.join('\n') };
        }

        case 'suggest': {
          if (!input.game) return { content: 'game parameter is required', is_error: true };
          const strategy = findGameStrategy(input.game);
          const capture = await computer.captureScreen();
          const screenText = await ocr.recognizeText(capture.path);

          return {
            content: [
              `=== ${strategy.name} - Move Suggestion ===`,
              '',
              'Analyzing current game state...',
              '',
              'Screen content:',
              screenText.slice(0, 1500),
              '',
              '--- Suggested Strategy ---',
              `Based on ${strategy.name} optimal play:`,
              ...strategy.tips.slice(0, 3).map((tip) => `  - ${tip}`),
              '',
              'Ask me a specific question about what move to make.',
            ].join('\n'),
          };
        }

        case 'play': {
          if (!input.move) return { content: 'move parameter is required (e.g., "click at 500, 300")', is_error: true };

          const moveStr = input.move.toLowerCase();

          const coordMatch = moveStr.match(/(\d+)\s*[,]\s*(\d+)/);
          if (coordMatch) {
            const x = parseInt(coordMatch[1]!);
            const y = parseInt(coordMatch[2]!);
            await computer.click(x, y, 'left');
            return { content: `Clicked at (${x}, ${y})` };
          }

          if (moveStr.includes('type')) {
            const text = input.move.replace(/^type\s*/i, '');
            await computer.typeText(text);
            return { content: `Typed: ${text}` };
          }

          if (moveStr.includes('press')) {
            const key = input.move.replace(/^press\s*/i, '');
            await computer.pressKey(key);
            return { content: `Pressed: ${key}` };
          }

          return {
            content: [
              'Move format options:',
              '  "click X, Y" - click at coordinates',
              '  "type text" - type text',
              '  "press key" - press a key',
              '',
              `Your move: "${input.move}"`,
            ].join('\n'),
          };
        }

        case 'auto_play': {
          if (!input.game) return { content: 'game parameter is required for auto_play', is_error: true };
          const strategy = findGameStrategy(input.game);
          const maxMoves = input.maxMoves || 20;

          return {
            content: [
              `=== ${strategy.name} - Auto Play ===`,
              `Maximum moves: ${maxMoves}`,
              '',
              'Auto-play will:',
              '1. Take screenshot to observe game state',
              '2. Analyze the board/screen with OCR',
              '3. Apply strategy to determine best move',
              '4. Execute the move',
              '5. Repeat until game ends or max moves reached',
              '',
              'Note: Auto-play requires explicit user permission.',
              'Use "observe" + "analyze" + "suggest" for step-by-step play.',
              '',
              `Strategy: ${strategy.name}`,
              `Actions: ${strategy.actions.join(' -> ')}`,
            ].join('\n'),
          };
        }

        case 'learn': {
          if (!input.game) return { content: 'game parameter is required', is_error: true };
          const strategy = findGameStrategy(input.game);

          return {
            content: [
              `=== Learn: ${strategy.name} ===`,
              '',
              '--- Overview ---',
              strategy.description,
              '',
              '--- Genre ---',
              strategy.genre,
              '',
              '--- Core Actions ---',
              ...strategy.actions.map((a, i) => `  ${i + 1}. ${a}`),
              '',
              '--- Expert Tips ---',
              ...strategy.tips.map((tip, i) => `  ${i + 1}. ${tip}`),
              '',
              '--- How to Use GameEngine ---',
              '1. Use "observe" to see the current game',
              '2. Use "analyze" with a question about what to do',
              '3. Use "suggest" to get a specific move recommendation',
              '4. Use "play" to execute a move',
              '5. Repeat until you win!',
              '',
              'Ask me anything about this game strategy!',
            ].join('\n'),
          };
        }

        default:
          return { content: `Unknown game action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `Game engine error: ${(error as Error).message}`, is_error: true };
    }
  },
};
