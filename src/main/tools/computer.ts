import type { Tool, ToolResult } from './base.js';
import { getComputerAutomation } from '../automation/computer-automation.js';
import { getAutomationDisplayState } from '../automation/display-policy.js';
import { settings } from '../settings/store.js';

const ACTIONS = [
  'mouse_click',
  'mouse_move',
  'double_click',
  'right_click',
  'drag',
  'scroll',
  'type_text',
  'key_press',
  'hotkey',
  'screenshot',
  'visual_observe',
  'visual_click',
  'visual_type',
  'desktop_state',
  'launch_app',
  'close_app',
  'open_url',
  'list_windows',
  'focus_window',
  'list_processes',
  'get_clipboard',
  'set_clipboard',
] as const;

export const computerTool: Tool = {
  name: 'Computer',
  description:
    'Control the local computer. Use visual_observe before coordinate actions when screen context matters; it returns a fresh live frame plus active-window, cursor, focused-control, and visible Windows UI element labels/bounds. visual_click and visual_type capture before/after frames and verify target bounds/cursor state. Supports mouse, keyboard, applications, URLs, windows, processes, and clipboard operations.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'Computer action to perform' },
      x: { type: 'number', description: 'Target X coordinate' },
      y: { type: 'number', description: 'Target Y coordinate' },
      from_x: { type: 'number', description: 'Drag start X coordinate' },
      from_y: { type: 'number', description: 'Drag start Y coordinate' },
      amount: { type: 'number', description: 'Scroll amount; positive scrolls up and negative scrolls down' },
      button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
      text: { type: 'string', description: 'Text, key, hotkey sequence, URL, or clipboard value' },
      app: { type: 'string', description: 'Application name or executable path' },
      title: { type: 'string', description: 'Window title or partial title' },
      smooth: { type: 'boolean', description: 'Use smooth mouse movement' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: (typeof ACTIONS)[number];
      x?: number;
      y?: number;
      from_x?: number;
      from_y?: number;
      amount?: number;
      button?: 'left' | 'right' | 'middle';
      text?: string;
      app?: string;
      title?: string;
      smooth?: boolean;
    };
    const computer = getComputerAutomation();
    const display = getAutomationDisplayState();
    const foregroundActions = new Set([
      'mouse_click', 'mouse_move', 'double_click', 'right_click', 'drag', 'scroll',
      'type_text', 'key_press', 'hotkey', 'visual_click', 'visual_type', 'launch_app',
      'open_url', 'focus_window',
    ]);
    // Never open a NEW Chrome window via Computer — always use browser_extension in the EXISTING Chrome.
    // This is a hard product rule, even in Full System Access.
    const isChromeLaunch = input.action === 'launch_app' && /chrome|edge|browser/i.test(String((input as Record<string, unknown>).app ?? (input as Record<string, unknown>).title ?? (input as Record<string, unknown>).name ?? ''));
    const isBrowserOpenUrl = input.action === 'open_url';
    if (isChromeLaunch || isBrowserOpenUrl) {
      return {
        content: `Never open Chrome via Computer — use browser_extension (new_tab + navigate) in the user's EXISTING Chrome. It keeps their sessions and is 10x faster. If the bridge is temporarily unreachable, the browser_extension tool will auto-retry then fall back to Operator (CDP) — don't ask the user to fix it. For desktop apps like Notepad/VS Code, launch_app is fine.`,
        is_error: true,
      };
    }
    // Full system access has NO restrictions for true PC control — bypass the background guard.
    // But browser Chrome is already blocked above, so this only affects Notepad, VS Code, etc.
    const p = settings.get('permissionProfile') as string | undefined;
    const m = settings.get('permissionMode') as string | undefined;
    const isFullAccess = p === ':full-system-access' || p === 'fullSystemAccess' || p === 'full-system-access' || p === 'full_system_access' || m === 'fullSystemAccess' || m === 'bypassPermissions';
    if (!isFullAccess && display.mode === 'background' && foregroundActions.has(input.action)) {
      return {
        content: `The ${input.action} action needs the desktop to be visible, but Infinite OS is in background mode. Fix it yourself: try Operator for browser work, or a direct API/shell/file tool. Only if nothing else works, briefly note the limitation — don't ask the user to change settings.`,
        is_error: true,
      };
    }

    try {
      switch (input.action) {
        case 'mouse_move':
          if (input.x == null || input.y == null) return missing('x and y');
          await computer.moveMouse(input.x, input.y, input.smooth);
          return ok(`Moved the mouse to (${input.x}, ${input.y}).`);
        case 'mouse_click':
          if (input.x == null || input.y == null) return missing('x and y');
          await computer.click(input.x, input.y, input.button ?? 'left');
          return ok(`Clicked ${input.button ?? 'left'} at (${input.x}, ${input.y}).`);
        case 'double_click':
          if (input.x == null || input.y == null) return missing('x and y');
          await computer.doubleClick(input.x, input.y);
          return ok(`Double-clicked at (${input.x}, ${input.y}).`);
        case 'right_click':
          if (input.x == null || input.y == null) return missing('x and y');
          await computer.rightClick(input.x, input.y);
          return ok(`Right-clicked at (${input.x}, ${input.y}).`);
        case 'drag':
          if (input.from_x == null || input.from_y == null || input.x == null || input.y == null)
            return missing('from_x, from_y, x, and y');
          await computer.drag(input.from_x, input.from_y, input.x, input.y);
          return ok(`Dragged from (${input.from_x}, ${input.from_y}) to (${input.x}, ${input.y}).`);
        case 'scroll':
          if (input.x == null || input.y == null || input.amount == null) return missing('x, y, and amount');
          await computer.scroll(input.x, input.y, input.amount);
          return ok(`Scrolled ${input.amount} at (${input.x}, ${input.y}).`);
        case 'type_text':
          if (!input.text) return missing('text');
          await computer.typeText(input.text);
          return ok(`Typed ${input.text.length} characters.`);
        case 'key_press':
          if (!input.text) return missing('text');
          await computer.pressKey(input.text);
          return ok(`Pressed ${input.text}.`);
        case 'hotkey':
          if (!input.text) return missing('text');
          await computer.hotkey(...input.text.split('+').map((key) => key.trim()));
          return ok(`Pressed hotkey ${input.text}.`);
        case 'screenshot': {
          const capture = await computer.captureScreen();
          return ok(`Screenshot saved to ${capture.path} (${capture.width}x${capture.height}).`);
        }
        case 'visual_observe': {
          const [frame, state, interactiveElements] = await Promise.all([
            computer.captureLiveFrame(),
            computer.getDesktopState(),
            computer.getInteractiveElements(),
          ]);
          return ok(JSON.stringify({
            frame: { path: frame.path, width: frame.width, height: frame.height, timestamp: Date.now() },
            state,
            interactiveElements,
          }, null, 2));
        }
        case 'visual_click': {
          if (input.x == null || input.y == null) return missing('x and y');
          const before = await computer.captureLiveFrame();
          const state = await computer.getDesktopState();
          if (input.x < 0 || input.y < 0 || input.x >= state.screen.width || input.y >= state.screen.height) {
            return { content: `Refused visual click outside screen bounds ${state.screen.width}x${state.screen.height}.`, is_error: true };
          }
          await computer.moveMouse(input.x, input.y, true);
          const cursor = await computer.getCursorPosition();
          if (Math.abs(cursor.x - input.x) > 2 || Math.abs(cursor.y - input.y) > 2) {
            return { content: `Mouse verification failed: cursor is at (${cursor.x}, ${cursor.y}), not (${input.x}, ${input.y}).`, is_error: true };
          }
          await computer.click(input.x, input.y, input.button ?? 'left');
          const after = await computer.captureLiveFrame();
          const afterState = await computer.getDesktopState();
          return ok(JSON.stringify({ clicked: { x: input.x, y: input.y, button: input.button ?? 'left' }, before: before.path, after: after.path, activeWindow: afterState.activeWindow, focusedElement: afterState.focusedElement }, null, 2));
        }
        case 'visual_type': {
          if (!input.text) return missing('text');
          const before = await computer.captureLiveFrame();
          const beforeState = await computer.getDesktopState();
          if (!beforeState.focusedElement && !beforeState.activeWindow) return { content: 'No active target for typing. Use visual_observe and focus a window first.', is_error: true };
          await computer.typeText(input.text);
          const after = await computer.captureLiveFrame();
          const afterState = await computer.getDesktopState();
          return ok(JSON.stringify({ typedCharacters: input.text.length, before: before.path, after: after.path, activeWindow: afterState.activeWindow, focusedElement: afterState.focusedElement }, null, 2));
        }
        case 'desktop_state':
          return ok(JSON.stringify(await computer.getDesktopState(), null, 2));
        case 'launch_app':
          if (!input.app && !input.text) return missing('app');
          await computer.openApp(input.app || input.text!);
          return ok(`Opened ${input.app || input.text}.`);
        case 'close_app':
          if (!input.app && !input.text) return missing('app');
          await computer.closeApp(input.app || input.text!);
          return ok(`Closed ${input.app || input.text}.`);
        case 'open_url':
          if (!input.text) return missing('text containing the URL');
          await computer.openApp('chrome');
          // Poll for window instead of blind sleep — max 3s
          for (let i = 0; i < 6; i++) {
            await new Promise((r) => setTimeout(r, 500));
            try { await computer.focusWindow('Chrome'); break; } catch { /* retry */ }
          }
          await computer.hotkey('ctrl', 'l');
          await computer.typeText(input.text, 4);
          await computer.pressKey('enter');
          return ok(`Physically launched Chrome, focused the address bar, typed ${input.text}, and pressed Enter.`);
        case 'list_windows':
          return ok(JSON.stringify(await computer.getWindows(), null, 2));
        case 'focus_window':
          if (!input.title && !input.text) return missing('title');
          return ok((await computer.focusWindow(input.title || input.text!))
            ? `Focused ${input.title || input.text}.`
            : `Could not focus ${input.title || input.text}.`);
        case 'list_processes':
          return ok(JSON.stringify(await computer.getProcesses(), null, 2));
        case 'get_clipboard':
          return ok((await computer.getClipboard()) || '(clipboard is empty)');
        case 'set_clipboard':
          if (input.text == null) return missing('text');
          await computer.setClipboard(input.text);
          return ok('Clipboard updated.');
        default:
          return { content: `Unknown computer action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `Computer action failed: ${(error as Error).message}`, is_error: true };
    }
  },
};

function ok(content: string): ToolResult {
  return { content };
}

function missing(fields: string): ToolResult {
  return { content: `Computer action requires ${fields}.`, is_error: true };
}
