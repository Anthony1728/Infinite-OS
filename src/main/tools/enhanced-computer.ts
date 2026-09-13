import type { Tool, ToolResult } from './base.js';
import { getComputerAutomation } from '../automation/computer-automation.js';
import { getOCR } from '../ocr/index.js';

export const enhancedComputerTool: Tool = {
  name: 'EnhancedComputer',
  description:
    'Enhanced desktop control with OCR text recognition, visual element detection, multi-monitor support, clipboard history, window snapping, and screenshot analysis. BUT prefer PCLiveMap first: PCLiveMap gives screenshot-free vectors (50 UIA elements with values, focused control, ALL windows) at ~500-950 tokens — 13-15x cheaper and 50x faster than screenshots. Only use EnhancedComputer read_screen/find_element/screenshot_ocr when PCLiveMap vectors cannot see (canvas/game/3D/scanned PDF with no UIA names) — and say why in one line.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'read_screen',
          'find_element',
          'find_and_click',
          'find_and_type',
          'screenshot_ocr',
          'multi_monitor',
          'clipboard_history',
          'snap_window',
          'minimize_all',
          'restore_windows',
          'get_system_tray',
          'task_switch',
          'virtual_desktops',
        ],
        description: 'Enhanced computer action',
      },
      text: { type: 'string', description: 'Text to find on screen or type' },
      monitor: { type: 'number', description: 'Monitor index (0-based)' },
      direction: { type: 'string', enum: ['left', 'right', 'up', 'down'], description: 'Snap direction' },
      windowTitle: { type: 'string', description: 'Window title to snap' },
      region: {
        type: 'object',
        description: 'Screen region {x, y, width, height}',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      prompt: { type: 'string', description: 'AI analysis prompt for screenshots' },
    },
    required: ['action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      text?: string;
      monitor?: number;
      direction?: string;
      windowTitle?: string;
      region?: { x: number; y: number; width: number; height: number };
      prompt?: string;
    };

    const computer = getComputerAutomation();
    const ocr = getOCR();

    try {
      switch (input.action) {
        case 'read_screen': {
          const capture = await computer.captureScreen();
          const text = await ocr.recognizeText(capture.path);
          return {
            content: [
              `=== Screen OCR Result ===`,
              `Screenshot: ${capture.path}`,
              `Dimensions: ${capture.width}x${capture.height}`,
              '',
              '--- Detected Text ---',
              text || '(no text detected)',
            ].join('\n'),
          };
        }

        case 'find_element': {
          if (!input.text) return { content: 'text parameter required to find element', is_error: true };
          const capture = await computer.captureScreen();
          const screenText = await ocr.recognizeText(capture.path);

          const lines = screenText.split('\n');
          const matches: Array<{ line: number; text: string; position: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.toLowerCase().includes(input.text.toLowerCase())) {
              matches.push({
                line: i + 1,
                text: lines[i]!,
                position: `Approximate Y: ${Math.round(((i + 1) / lines.length) * capture.height)}`,
              });
            }
          }

          if (matches.length === 0) {
            return {
              content: [
                `Could not find "${input.text}" on screen.`,
                'Screen text detected:',
                screenText.slice(0, 1000),
              ].join('\n'),
            };
          }

          return {
            content: [
              `=== Found ${matches.length} match(es) for "${input.text}" ===`,
              '',
              ...matches.map((m) => `Line ${m.line}: "${m.text}" (${m.position})`),
              '',
              'Use "find_and_click" to click on the element.',
            ].join('\n'),
          };
        }

        case 'find_and_click': {
          if (!input.text) return { content: 'text parameter required', is_error: true };
          const capture = await computer.captureScreen();
          const screenText = await ocr.recognizeText(capture.path);
          const lines = screenText.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.toLowerCase().includes(input.text.toLowerCase())) {
              const y = Math.round(((i + 0.5) / lines.length) * capture.height);
              const x = Math.round(capture.width / 2);
              await computer.click(x, y, 'left');
              return {
                content: [
                  `Found "${input.text}" and clicked at (${x}, ${y})`,
                  `Line ${i + 1}: "${lines[i]}"`,
                ].join('\n'),
              };
            }
          }

          return { content: `Could not find "${input.text}" on screen`, is_error: true };
        }

        case 'find_and_type': {
          if (!input.text) return { content: 'text parameter required', is_error: true };
          const capture = await computer.captureScreen();
          const screenText = await ocr.recognizeText(capture.path);

          if (screenText.toLowerCase().includes(input.text.toLowerCase())) {
            const lines = screenText.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (lines[i]!.toLowerCase().includes(input.text.toLowerCase())) {
                const y = Math.round(((i + 0.5) / lines.length) * capture.height);
                const x = Math.round(capture.width / 2);
                await computer.click(x, y, 'left');
                await new Promise((r) => setTimeout(r, 200));
                await computer.hotkey('ctrl', 'a');
                await computer.typeText(input.text);
                return {
                  content: `Found input field with "${input.text}", clicked, selected all, and typed replacement.`,
                };
              }
            }
          }

          await computer.typeText(input.text);
          return { content: `Typed ${input.text.length} characters at current cursor position.` };
        }

        case 'screenshot_ocr': {
          const capture = await computer.captureScreen();
          let result: string;

          if (input.region) {
            const regionPath = capture.path.replace('.png', '_region.png');
            const psScript = `
              Add-Type -AssemblyName System.Drawing
              $img = [System.Drawing.Image]::FromFile('${capture.path.replace(/\\/g, '\\\\')}')
              $rect = New-Object System.Drawing.Rectangle(${input.region.x}, ${input.region.y}, ${input.region.width}, ${input.region.height})
              $bmp = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
              $graphics = [System.Drawing.Graphics]::FromImage($bmp)
              $graphics.DrawImage($img, $rect, New-Object System.Drawing.Rectangle(0, 0, $rect.Width, $rect.Height), [System.Drawing.GraphicsUnit]::Pixel)
              $bmp.Save('${regionPath.replace(/\\/g, '\\\\')}')
              $graphics.Dispose()
              $bmp.Dispose()
              $img.Dispose()
            `;
            const { execSync } = await import('node:child_process');
            execSync(`powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
            result = await ocr.recognizeText(regionPath);
          } else {
            result = await ocr.recognizeText(capture.path);
          }

          return {
            content: [
              `=== OCR Result ===`,
              `Screenshot: ${capture.path}`,
              input.region ? `Region: ${input.region.x},${input.region.y} ${input.region.width}x${input.region.height}` : 'Full screen',
              '',
              '--- Detected Text ---',
              result || '(no text detected)',
            ].join('\n'),
          };
        }

        case 'multi_monitor': {
          const { execSync } = await import('node:child_process');
          const psScript = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
              "$($_.DeviceName) | Primary: $($_.Primary) | Bounds: $($_.Bounds) | WorkingArea: $($_.WorkingArea)"
            }
          `;
          const output = execSync(`powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
          const monitors = output.trim().split('\n').filter(Boolean);

          if (input.monitor !== undefined) {
            const monitor = monitors[input.monitor];
            if (!monitor) return { content: `Monitor ${input.monitor} not found. ${monitors.length} monitor(s) available.`, is_error: true };
            return { content: `Monitor ${input.monitor}: ${monitor.trim()}` };
          }

          return {
            content: [
              `=== ${monitors.length} Monitor(s) Detected ===`,
              '',
              ...monitors.map((m, i) => `[${i}] ${m.trim()}`),
            ].join('\n'),
          };
        }

        case 'clipboard_history': {
          const { execSync } = await import('node:child_process');
            const psScript = `
              Add-Type -AssemblyName System.Windows.Forms
              $clip = [System.Windows.Forms.Clipboard]
              $result = @()
              if ($clip.ContainsText()) { $result += "Text: $($clip.GetText().Substring(0, [Math]::Min(200, $clip.GetText().Length)))" }
              if ($clip.ContainsImage()) { $result += "Image: $($clip.GetImage().Width)x$($clip.GetImage().Height)" }
              if ($clip.ContainsFileDropList()) { $result += "Files: $($clip.GetFileDropList() -join ', ')" }
              $result -join [char]10
            `;
            const output = execSync(`powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
          return { content: `=== Clipboard Contents ===\n${output.trim() || '(empty)'}` };
        }

        case 'snap_window': {
          const windows = await computer.getWindows();
          let targetWindow = windows.find((w) =>
            input.windowTitle && w.title.toLowerCase().includes(input.windowTitle.toLowerCase())
          );

          if (!targetWindow && windows.length > 0) {
            targetWindow = windows[0];
          }

          if (!targetWindow) return { content: 'No window found to snap', is_error: true };

          await computer.focusWindow(targetWindow.title);

          const { execSync } = await import('node:child_process');
          const dirMap: Record<string, string> = {
            left: '{LEFT}',
            right: '{RIGHT}',
            up: '{UP}',
            down: '{DOWN}',
          };
          const key = dirMap[input.direction || 'left'] || '{LEFT}';
          execSync(`powershell.exe -NoProfile -Command "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('${targetWindow.title.replace(/'/g, "''")}'); Start-Sleep -Milliseconds 100; $wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys('^%${key === '{LEFT}' ? 'l' : key === '{RIGHT}' ? 'r' : key === '{UP}' ? 'u' : 'd'}')"`, { stdio: 'pipe' });

          return { content: `Snapped "${targetWindow.title}" to ${input.direction || 'left'}` };
        }

        case 'minimize_all': {
          const { execSync } = await import('node:child_process');
          execSync('powershell.exe -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'{LWIN}d\')"', { stdio: 'pipe' });
          return { content: 'Minimized all windows (Show Desktop)' };
        }

        case 'restore_windows': {
          const { execSync } = await import('node:child_process');
          execSync('powershell.exe -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'^+{ESC}\')"', { stdio: 'pipe' });
          return { content: 'Opened Task Manager (restore from there)' };
        }

        case 'get_system_tray': {
          const { execSync } = await import('node:child_process');
          const psScript = `
            Get-Process | Where-Object {$_.MainWindowTitle -eq "" -and $_.Path -ne $null} |
            Select-Object -First 20 Name, Id, Path |
            ForEach-Object { "$($_.Name) (PID: $($_.Id)) - $($_.Path)" }
          `;
          const output = execSync(`powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
          return {
            content: [
              '=== Background Processes (System Tray Candidates) ===',
              '',
              output.trim() || '(none found)',
            ].join('\n'),
          };
        }

        case 'task_switch': {
          const { execSync } = await import('node:child_process');
          execSync('powershell.exe -NoProfile -Command "$wshell = New-Object -ComObject WScript.Shell; $wshell.SendKeys(\'%\')"', { stdio: 'pipe' });
          await new Promise((r) => setTimeout(r, 500));
          const windows = await computer.getWindows();
          return {
            content: [
              '=== Task Switcher Opened ===',
              'Visible windows:',
              ...windows.slice(0, 10).map((w) => `  - ${w.title}`),
            ].join('\n'),
          };
        }

        case 'virtual_desktops': {
          const { execSync } = await import('node:child_process');
          const psScript = `
            Add-Type @"
            using System;
            using System.Runtime.InteropServices;
            public class VirtualDesktop {
              [DllImport("user32.dll")]
              public static extern IntPtr GetForegroundWindow();
              [DllImport("user32.dll")]
              public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
            }
"@
            $hwnd = [VirtualDesktop]::GetForegroundWindow()
            $sb = New-Object System.Text.StringBuilder 256
            [VirtualDesktop]::GetWindowText($hwnd, $sb, 256) | Out-Null
            "Current window: $($sb.ToString())"
          `;
          const output = execSync(`powershell.exe -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, { encoding: 'utf-8' });
          return { content: `=== Virtual Desktop Info ===\n${output.trim()}` };
        }

        default:
          return { content: `Unknown enhanced action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `Enhanced computer action failed: ${(error as Error).message}`, is_error: true };
    }
  },
};
