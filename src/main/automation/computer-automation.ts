/**
 * Computer Automation System
 * 
 * Full computer control capabilities:
 * - Mouse control (move, click, drag, scroll)
 * - Keyboard control (type, press keys, hotkeys)
 * - Screen capture and analysis
 * - Window management
 * - Application control
 * - OCR and image analysis
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';
import { randomUUID } from 'node:crypto';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MouseAction {
  type: 'move' | 'click' | 'doubleClick' | 'rightClick' | 'drag' | 'scroll';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  scrollAmount?: number;
  duration?: number;
}

export interface KeyboardAction {
  type: 'type' | 'press' | 'hold' | 'release' | 'hotkey';
  keys: string[];
  text?: string;
  delay?: number;
}

export interface WindowInfo {
  title: string;
  pid: number;
  rect: Rect;
  isFocused: boolean;
}

export interface ProcessInfo {
  name: string;
  pid: number;
  memory: number;
  cpu: number;
  windowTitle?: string;
}

// Constants
const MOUSE_EVENTS = {
  leftDown: 0x0002,
  leftUp: 0x0004,
  rightDown: 0x0008,
  rightUp: 0x0010,
  middleDown: 0x0020,
  middleUp: 0x0040,
  wheel: 0x0800,
  absolute: 0x8000,
};

const KEY_CODES: Record<string, number> = {
  backspace: 0x08, tab: 0x09, enter: 0x0D, shift: 0x10, ctrl: 0x11,
  alt: 0x12, escape: 0x1B, space: 0x20, pageup: 0x21, pagedown: 0x22,
  end: 0x23, home: 0x24, left: 0x25, up: 0x26, right: 0x27, down: 0x28,
  insert: 0x2D, delete: 0x2E, 0: 0x30, 1: 0x31, 2: 0x32, 3: 0x33, 4: 0x34,
  5: 0x35, 6: 0x36, 7: 0x37, 8: 0x38, 9: 0x39, a: 0x41, b: 0x42, c: 0x43,
  d: 0x44, e: 0x45, f: 0x46, g: 0x47, h: 0x48, i: 0x49, j: 0x4A, k: 0x4B,
  l: 0x4C, m: 0x4D, n: 0x4E, o: 0x4F, p: 0x50, q: 0x51, r: 0x52, s: 0x53,
  t: 0x54, u: 0x55, v: 0x56, w: 0x57, x: 0x58, y: 0x59, z: 0x5A,
  f1: 0x70, f2: 0x71, f3: 0x72, f4: 0x73, f5: 0x74, f6: 0x75, f7: 0x76,
  f8: 0x77, f9: 0x78, f10: 0x79, f11: 0x7A, f12: 0x7B,
};

/**
 * Computer Automation Controller
 * 
 * Provides comprehensive computer control using Windows API.
 */
export class ComputerAutomation {
  private screenshotsDir: string;
  private isWindows: boolean;
  private defaultDelay = 50;
  private actionLog: Array<{ action: string; timestamp: number; success: boolean }> = [];

  constructor() {
    this.screenshotsDir = join(homedir(), '.infinite-ai', 'screenshots');
    this.isWindows = platform() === 'win32';
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!existsSync(this.screenshotsDir)) {
      mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  // ========== MOUSE CONTROL ==========

  /**
   * Move mouse to position
   */
  async moveMouse(x: number, y: number, smooth: boolean = false): Promise<void> {
    if (smooth) {
      // Smooth movement in steps
      await this.smoothMove(x, y);
    } else {
      await this.executePowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`
      );
    }
    this.logAction(`moveMouse(${x}, ${y})`, true);
  }

  /**
   * Smooth mouse movement
   */
  private async smoothMove(targetX: number, targetY: number, steps: number = 10): Promise<void> {
    const currentPos = await this.getCursorPosition();
    const dx = (targetX - currentPos.x) / steps;
    const dy = (targetY - currentPos.y) / steps;

    for (let i = 1; i <= steps; i++) {
      const x = Math.round(currentPos.x + dx * i);
      const y = Math.round(currentPos.y + dy * i);
      await this.executePowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`
      );
      await this.delay(10);
    }
  }

  /**
   * Get current cursor position
   */
  async getCursorPosition(): Promise<Point> {
    const result = await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; $p = [System.Windows.Forms.Cursor]::Position; Write-Output "$($p.X),$($p.Y)"`
    );
    const [x, y] = result.split(',').map(Number);
    return { x, y };
  }

  /**
   * Click at position
   */
  async click(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<void> {
    await this.moveMouse(x, y);
    await this.delay(this.defaultDelay);
    
    const downFlag = button === 'left' ? MOUSE_EVENTS.leftDown : 
                     button === 'right' ? MOUSE_EVENTS.rightDown : MOUSE_EVENTS.middleDown;
    const upFlag = button === 'left' ? MOUSE_EVENTS.leftUp : 
                   button === 'right' ? MOUSE_EVENTS.rightUp : MOUSE_EVENTS.middleUp;

    await this.mouseEvent(downFlag);
    await this.delay(10);
    await this.mouseEvent(upFlag);
    this.logAction(`click(${x}, ${y}, ${button})`, true);
  }

  /**
   * Double click at position
   */
  async doubleClick(x: number, y: number): Promise<void> {
    await this.click(x, y);
    await this.delay(50);
    await this.click(x, y);
    this.logAction(`doubleClick(${x}, ${y})`, true);
  }

  /**
   * Right click at position
   */
  async rightClick(x: number, y: number): Promise<void> {
    await this.click(x, y, 'right');
  }

  /**
   * Drag from one position to another
   */
  async drag(fromX: number, fromY: number, toX: number, toY: number, holdTime: number = 100): Promise<void> {
    await this.moveMouse(fromX, fromY);
    await this.delay(this.defaultDelay);
    
    // Hold down left button
    await this.mouseEvent(MOUSE_EVENTS.leftDown);
    await this.delay(holdTime);
    
    // Move to destination
    await this.smoothMove(toX, toY);
    await this.delay(this.defaultDelay);
    
    // Release left button
    await this.mouseEvent(MOUSE_EVENTS.leftUp);
    this.logAction(`drag(${fromX},${fromY} -> ${toX},${toY})`, true);
  }

  /**
   * Scroll at position
   */
  async scroll(x: number, y: number, amount: number): Promise<void> {
    await this.moveMouse(x, y);
    await this.delay(this.defaultDelay);
    
    const scrollAmount = Math.round(amount * 120); // WHEEL_DELTA = 120
    await this.mouseEvent(MOUSE_EVENTS.wheel, 0, scrollAmount);
    this.logAction(`scroll(${x}, ${y}, ${amount})`, true);
  }

  /**
   * Hover over element (move and wait)
   */
  async hover(x: number, y: number, duration: number = 500): Promise<void> {
    await this.moveMouse(x, y);
    await this.delay(duration);
    this.logAction(`hover(${x}, ${y}, ${duration})`, true);
  }

  private async mouseEvent(flags: number, dx: number = 0, dy: number = 0): Promise<void> {
    await this.executePowerShell(
      `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
}
"@
[Mouse]::mouse_event(${flags}, ${dx}, ${dy}, 0, 0)`
    );
  }

  // ========== KEYBOARD CONTROL ==========

  /**
   * Type text
   */
  async typeText(text: string, delay: number = 0): Promise<void> {
    // Escape special characters
    const escaped = text.replace(/[{}()\[\]^~]/g, (c) => `{${c}}`);
    await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`
    );
    if (delay > 0) await this.delay(delay);
    this.logAction(`typeText("${text.substring(0, 20)}...")`, true);
  }

  /**
   * Press a single key
   */
  async pressKey(key: string): Promise<void> {
    const vk = KEY_CODES[key.toLowerCase()];
    if (!vk) {
      // Try as SendKeys format
      await this.executePowerShell(
        `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{${key}}')`
      );
    } else {
      await this.keybdEvent(vk, 0);
      await this.delay(10);
      await this.keybdEvent(vk, 2);
    }
    this.logAction(`pressKey(${key})`, true);
  }

  /**
   * Press hotkey combination (e.g., "ctrl+c", "alt+tab")
   */
  async hotkey(...keys: string[]): Promise<void> {
    const vkCodes = keys.map(k => KEY_CODES[k.toLowerCase()]).filter(Boolean);
    
    // Press all keys
    for (const vk of vkCodes) {
      await this.keybdEvent(vk, 0);
      await this.delay(20);
    }
    await this.delay(50);
    
    // Release all keys in reverse
    for (const vk of [...vkCodes].reverse()) {
      await this.keybdEvent(vk, 2);
      await this.delay(20);
    }
    
    this.logAction(`hotkey(${keys.join('+')})`, true);
  }

  /**
   * Hold keys down
   */
  async holdKey(key: string): Promise<void> {
    const vk = KEY_CODES[key.toLowerCase()];
    if (vk) {
      await this.keybdEvent(vk, 0);
    }
  }

  /**
   * Release held key
   */
  async releaseKey(key: string): Promise<void> {
    const vk = KEY_CODES[key.toLowerCase()];
    if (vk) {
      await this.keybdEvent(vk, 2);
    }
  }

  private async keybdEvent(vk: number, flags: number): Promise<void> {
    await this.executePowerShell(
      `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Keyboard {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte vk, byte scan, int flags, int extraInfo);
}
"@
[Keyboard]::keybd_event(${vk}, 0, ${flags}, 0)`
    );
  }

  /**
   * Type with virtual key codes for special characters
   */
  async typeSpecial(char: string): Promise<void> {
    const charCode = char.charCodeAt(0);
    await this.keybdEvent(charCode, 0);
    await this.delay(10);
    await this.keybdEvent(charCode, 2);
  }

  // ========== SCREEN CAPTURE ==========

  /**
   * Capture the entire screen
   */
  async captureScreen(): Promise<{ path: string; base64: string; width: number; height: number }> {
    const { width, height } = await this.getScreenSize();
    const id = randomUUID();
    const path = join(this.screenshotsDir, `screen-${id}.png`);

    await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap(${width}, ${height}); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save('${path.replace(/\\/g, '\\\\')}'); $bmp.Dispose(); $g.Dispose()`
    );

    const base64 = readFileSync(path).toString('base64');
    this.logAction('captureScreen()', true);
    return { path, base64, width, height };
  }

  /**
   * Capture a region of the screen
   */
  async captureRegion(x: number, y: number, width: number, height: number): Promise<{ path: string; base64: string }> {
    const id = randomUUID();
    const path = join(this.screenshotsDir, `region-${id}.png`);

    await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bmp = New-Object System.Drawing.Bitmap(${width}, ${height}); $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(${x}, ${y}, 0, 0, $bmp.Size); $bmp.Save('${path.replace(/\\/g, '\\\\')}'); $bmp.Dispose(); $g.Dispose()`
    );

    const base64 = readFileSync(path).toString('base64');
    return { path, base64 };
  }

  /**
   * Get screen size
   */
  async getScreenSize(): Promise<{ width: number; height: number }> {
    const result = await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; $s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output "$($s.Width)x$($s.Height)"`
    );
    const [width, height] = result.split('x').map(Number);
    return { width, height };
  }

  // ========== WINDOW MANAGEMENT ==========

  /**
   * Get list of all windows
   */
  async getWindows(): Promise<WindowInfo[]> {
    const result = await this.executePowerShell(
      `Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | ForEach-Object {
        $rect = [System.Windows.Forms.Form]::ActiveForm.Bounds
        Write-Output "$($_.MainWindowTitle)|$($_.Id)|$($rect.X)|$($rect.Y)|$($rect.Width)|$($rect.Height)"
      }`
    );

    if (!result) return [];
    
    return result.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [title, pid, x, y, w, h] = line.split('|');
        return {
          title: title?.trim() || 'Unknown',
          pid: parseInt(pid) || 0,
          rect: {
            x: parseInt(x) || 0,
            y: parseInt(y) || 0,
            width: parseInt(w) || 0,
            height: parseInt(h) || 0,
          },
          isFocused: false,
        };
      });
  }

  /**
   * Find window by title
   */
  async findWindow(title: string): Promise<WindowInfo | null> {
    const windows = await this.getWindows();
    return windows.find(w => w.title.toLowerCase().includes(title.toLowerCase())) || null;
  }

  /**
   * Focus a window by title
   */
  async focusWindow(title: string): Promise<boolean> {
    const result = await this.executePowerShell(
      `Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*'} | Select-Object -First 1 | ForEach-Object {
        $hwnd = (Get-Process -Id $_.Id).MainWindowHandle
        if ($hwnd) { [void][System.Windows.Forms.Form]::Capture($hwnd); [System.Windows.Forms.Form]::Activate($hwnd) }
      }`
    );
    return !!result;
  }

  /**
   * Minimize a window
   */
  async minimizeWindow(title: string): Promise<boolean> {
    await this.executePowerShell(
      `(Get-Process | Where-Object {$_.MainWindowTitle -like '*${title}*'})[0].CloseMainWindow()`
    );
    return true;
  }

  // ========== APPLICATION MANAGEMENT ==========

  /**
   * Open an application
   */
  async openApp(name: string): Promise<boolean> {
    await this.executePowerShell(`Start-Process "${name}"`);
    this.logAction(`openApp(${name})`, true);
    return true;
  }

  /**
   * Open URL in default browser
   */
  async openUrl(url: string): Promise<boolean> {
    await this.executePowerShell(`Start-Process "${url}"`);
    this.logAction(`openUrl(${url})`, true);
    return true;
  }

  /**
   * Close an application by name
   */
  async closeApp(name: string): Promise<boolean> {
    await this.executePowerShell(`Stop-Process -Name "${name}" -Force -ErrorAction SilentlyContinue`);
    this.logAction(`closeApp(${name})`, true);
    return true;
  }

  /**
   * Get running processes
   */
  async getProcesses(): Promise<ProcessInfo[]> {
    const result = await this.executePowerShell(
      `Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 20 | ForEach-Object {
        Write-Output "$($_.ProcessName)|$($_.Id)|$($_.WorkingSet64)|$($_.CPU)"
      }`
    );

    if (!result) return [];

    return result.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [name, pid, memory, cpu] = line.split('|');
        return {
          name: name?.trim() || 'Unknown',
          pid: parseInt(pid) || 0,
          memory: parseInt(memory) || 0,
          cpu: parseFloat(cpu) || 0,
        };
      });
  }

  // ========== CLIPBOARD ==========

  /**
   * Get clipboard text
   */
  async getClipboard(): Promise<string> {
    const result = await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::GetText()`
    );
    return result || '';
  }

  /**
   * Set clipboard text
   */
  async setClipboard(text: string): Promise<void> {
    await this.executePowerShell(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText('${text.replace(/'/g, "''")}')`
    );
    this.logAction('setClipboard()', true);
  }

  // ========== SYSTEM OPERATIONS ==========

  /**
   * Execute a shell command
   */
  async execute(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const args = this.isWindows
        ? ['-NoProfile', '-Command', command]
        : ['-c', command];
      
      const child = spawn('powershell.exe', args, {
        cwd,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on('error', (err) => {
        resolve({ stdout: '', stderr: err.message, exitCode: 1 });
      });
    });
  }

  /**
   * Take screenshot and save
   */
  async saveScreenshot(filename: string): Promise<string> {
    const { base64 } = await this.captureScreen();
    const path = join(this.screenshotsDir, filename);
    writeFileSync(path, Buffer.from(base64, 'base64'));
    return path;
  }

  // ========== HELPER METHODS ==========

  private async executePowerShell(command: string): Promise<string> {
    return new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
        windowsHide: true,
      });

      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.on('close', () => resolve(stdout.trim()));
      child.on('error', () => resolve(''));
    });
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private logAction(action: string, success: boolean): void {
    this.actionLog.push({ action, timestamp: Date.now(), success });
    if (this.actionLog.length > 1000) this.actionLog.shift();
  }

  getActionLog(count: number = 50): Array<{ action: string; timestamp: number; success: boolean }> {
    return this.actionLog.slice(-count);
  }

  getStats(): {
    totalActions: number;
    successRate: number;
    screenshotsCount: number;
  } {
    const total = this.actionLog.length;
    const success = this.actionLog.filter(a => a.success).length;
    return {
      totalActions: total,
      successRate: total > 0 ? (success / total) * 100 : 0,
      screenshotsCount: 0,
    };
  }
}

// Singleton
let computerAutomation: ComputerAutomation | null = null;

export function getComputerAutomation(): ComputerAutomation {
  if (!computerAutomation) {
    computerAutomation = new ComputerAutomation();
  }
  return computerAutomation;
}