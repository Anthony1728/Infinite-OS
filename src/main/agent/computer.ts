/**
 * Computer Control Agent
 *
 * Controls the desktop environment:
 * - Mouse movement and clicks
 * - Keyboard input
 * - Screen capture
 * - Application management
 * - Window management
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

function psExec(command: string, timeout = 30_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
      reject(new Error('powershell timed out'));
    }, timeout);
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) return;
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `powershell exited with code ${code}`));
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export interface ComputerConfig {
  screenCaptureDir: string;
  actionDelay: number;
  enableMouse: boolean;
  enableKeyboard: boolean;
  enableScreenCapture: boolean;
}

export interface MouseAction {
  id: string;
  type: 'move' | 'click' | 'doubleClick' | 'rightClick' | 'drag' | 'scroll';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
  scrollAmount?: number;
  timestamp: number;
  success: boolean;
}

export interface KeyboardAction {
  id: string;
  type: 'type' | 'press' | 'hotkey' | 'release';
  keys: string[];
  text?: string;
  timestamp: number;
  success: boolean;
}

export interface ScreenCapture {
  id: string;
  path: string;
  width: number;
  height: number;
  timestamp: number;
  imageData?: string;
}

export interface ApplicationRecord {
  id: string;
  name: string;
  path: string;
  pid?: number;
  windowTitle?: number;
  launched: number;
  status: 'running' | 'stopped' | 'error';
}

export class ComputerControlAgent {
  private config: ComputerConfig;
  private mouseActions: MouseAction[] = [];
  private keyboardActions: KeyboardAction[] = [];
  private captures: ScreenCapture[] = [];
  private applications: Map<string, ApplicationRecord> = new Map();
  private dataDir: string;

  constructor(config?: Partial<ComputerConfig>) {
    this.config = {
      screenCaptureDir: config?.screenCaptureDir ?? join(homedir(), '.infinite-ai', 'screenshots'),
      actionDelay: config?.actionDelay ?? 100,
      enableMouse: config?.enableMouse ?? true,
      enableKeyboard: config?.enableKeyboard ?? true,
      enableScreenCapture: config?.enableScreenCapture ?? true,
    };
    this.dataDir = join(homedir(), '.infinite-ai', 'computer');
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    for (const dir of [this.dataDir, this.config.screenCaptureDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  private loadData(): void {
    try {
      const appsPath = join(this.dataDir, 'applications.json');
      if (existsSync(appsPath)) {
        const data = JSON.parse(readFileSync(appsPath, 'utf-8'));
        this.applications = new Map(data);
      }
      const actionsPath = join(this.dataDir, 'actions.json');
      if (existsSync(actionsPath)) {
        const data = JSON.parse(readFileSync(actionsPath, 'utf-8'));
        this.mouseActions = data.mouse ?? [];
        this.keyboardActions = data.keyboard ?? [];
      }
    } catch { /* silent */ }
  }

  private async saveData(): Promise<void> {
    try {
      const appEntries = JSON.stringify(Array.from(this.applications.entries()));
      const actionData = JSON.stringify({ mouse: this.mouseActions.slice(-500), keyboard: this.keyboardActions.slice(-500) });
      const { writeFile } = await import('fs/promises');
      await Promise.all([
        writeFile(join(this.dataDir, 'applications.json'), appEntries),
        writeFile(join(this.dataDir, 'actions.json'), actionData),
      ]);
    } catch { /* silent */ }
  }

  // Mouse control
  async moveMouse(x: number, y: number): Promise<MouseAction> {
    const action: MouseAction = {
      id: randomUUID(),
      type: 'move',
      x,
      y,
      timestamp: Date.now(),
      success: true,
    };

    try {
      if (process.platform === 'win32') {
        // Use PowerShell to move mouse on Windows
        await psExec(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`);
      }
    } catch {
      action.success = false;
    }

    this.mouseActions.push(action);
    if (this.mouseActions.length > 500) this.mouseActions.shift();
    void this.saveData();
    return action;
  }

  async clickMouse(x: number, y: number, button: 'left' | 'right' | 'middle' = 'left'): Promise<MouseAction> {
    // Move first
    await this.moveMouse(x, y);

    const action: MouseAction = {
      id: randomUUID(),
      type: 'click',
      x,
      y,
      button,
      timestamp: Date.now(),
      success: true,
    };

    try {
      if (process.platform === 'win32') {
        // Use PowerShell with user32.dll for mouse clicks
        const btn = button === 'left' ? '2' : button === 'right' ? '8' : '16';
        await psExec(`Add-Type @' using System; using System.Runtime.InteropServices; public class Mouse { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo); }'@; [Mouse]::mouse_event(${btn}, 0, 0, 0, 0); Start-Sleep -Milliseconds 50; [Mouse]::mouse_event(4, 0, 0, 0, 0)`);
      }
    } catch {
      action.success = false;
    }

    this.mouseActions.push(action);
    void this.saveData();
    return action;
  }

  async doubleClick(x: number, y: number): Promise<MouseAction> {
    await this.clickMouse(x, y);
    return this.clickMouse(x, y);
  }

  async rightClick(x: number, y: number): Promise<MouseAction> {
    return this.clickMouse(x, y, 'right');
  }

  async scroll(x: number, y: number, amount: number): Promise<MouseAction> {
    const action: MouseAction = {
      id: randomUUID(),
      type: 'scroll',
      x,
      y,
      scrollAmount: amount,
      timestamp: Date.now(),
      success: true,
    };

    try {
      if (process.platform === 'win32') {
        // Move mouse to position first
        await this.moveMouse(x, y);
        // Use user32.dll mouse_event for scroll (MOUSEEVENTF_WHEEL = 0x0800)
        const scrollDelta = amount * 120;
        await psExec(`Add-Type @' using System; using System.Runtime.InteropServices; public class Mouse { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo); }'@; [Mouse]::mouse_event(0x0800, 0, 0, ${scrollDelta}, 0)`);
      }
    } catch {
      action.success = false;
    }

    this.mouseActions.push(action);
    if (this.mouseActions.length > 500) this.mouseActions.shift();
    void this.saveData();
    return action;
  }

  // Keyboard control
  async typeText(text: string): Promise<KeyboardAction> {
    const action: KeyboardAction = {
      id: randomUUID(),
      type: 'type',
      keys: [],
      text,
      timestamp: Date.now(),
      success: true,
    };

    try {
      if (process.platform === 'win32') {
        await psExec(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}')`);
      }
    } catch {
      action.success = false;
    }

    this.keyboardActions.push(action);
    void this.saveData();
    return action;
  }

  async pressKey(...keys: string[]): Promise<KeyboardAction> {
    const action: KeyboardAction = {
      id: randomUUID(),
      type: 'press',
      keys,
      timestamp: Date.now(),
      success: true,
    };

    try {
      if (process.platform === 'win32') {
        const keyMap: Record<string, string> = {
          enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', backspace: '{BACKSPACE}',
          delete: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
          home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
          ctrl: '^', alt: '%', shift: '+',
        };
        const sendKeys = keys.map((k) => keyMap[k.toLowerCase()] ?? k).join('');
        await psExec(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${sendKeys}')`);
      }
    } catch {
      action.success = false;
    }

    this.keyboardActions.push(action);
    void this.saveData();
    return action;
  }

  async hotkey(...keys: string[]): Promise<KeyboardAction> {
    return this.pressKey(...keys);
  }

  // Screen capture
  async captureScreen(): Promise<ScreenCapture> {
    const id = randomUUID();
    const path = join(this.config.screenCaptureDir, `capture-${id}.png`);

    const capture: ScreenCapture = {
      id,
      path,
      width: 1920,
      height: 1080,
      timestamp: Date.now(),
    };

    try {
      if (process.platform === 'win32') {
        if (!existsSync(this.config.screenCaptureDir)) {
          mkdirSync(this.config.screenCaptureDir, { recursive: true });
        }
        
        // Combined: get dimensions + screenshot in a single PowerShell call
        const result = await psExec(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height); $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save('${path.replace(/\\/g, '\\\\')}'); $bmp.Dispose(); $gfx.Dispose(); Write-Output "W=$($bounds.Width) H=$($bounds.Height)"`);
        const dimMatch = result.stdout.match(/W=(\d+)\s+H=(\d+)/);
        if (dimMatch) {
          capture.width = parseInt(dimMatch[1]);
          capture.height = parseInt(dimMatch[2]);
        }
      }
    } catch {
      // Return a capture object even on error
    }

    this.captures.push(capture);
    if (this.captures.length > 100) this.captures.shift();
    void this.saveData();

    // Read and return base64 image data
    let imageData = '';
    try {
      if (existsSync(path)) {
        imageData = readFileSync(path).toString('base64');
      }
    } catch { /* silent */ }

    return { ...capture, imageData };
  }

  // Lightweight live-feed frame: overwrites a single fixed file so a continuous
  // stream does not accumulate thousands of PNGs on disk.
  async captureLiveFrame(): Promise<ScreenCapture> {
    const path = join(this.config.screenCaptureDir, 'live-frame.png');
    const capture: ScreenCapture = { id: 'live', path, width: 1920, height: 1080, timestamp: Date.now() };
    try {
      if (process.platform === 'win32') {
        if (!existsSync(this.config.screenCaptureDir)) {
          mkdirSync(this.config.screenCaptureDir, { recursive: true });
        }
        // Combined: get dimensions + screenshot in a single PowerShell call
        const result = await psExec(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height); $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen(0, 0, 0, 0, $bmp.Size); $bmp.Save('${path.replace(/\\/g, '\\\\')}'); $bmp.Dispose(); $gfx.Dispose(); Write-Output "W=$($bounds.Width) H=$($bounds.Height)"`);
        const dimMatch = result.stdout.match(/W=(\d+)\s+H=(\d+)/);
        if (dimMatch) {
          capture.width = parseInt(dimMatch[1]);
          capture.height = parseInt(dimMatch[2]);
        }
      }
    } catch {
      // Return a capture object even on error
    }

    let imageData = '';
    try {
      if (existsSync(path)) {
        imageData = readFileSync(path).toString('base64');
      }
    } catch {
      // silent
    }

    return { ...capture, imageData };
  }

  async getScreenSize(): Promise<{ width: number; height: number }> {
    try {
      if (process.platform === 'win32') {
        const result = await psExec(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds`);
        const match = result.stdout.match(/Width=(\d+).*Height=(\d+)/s);
        if (match) {
          return { width: parseInt(match[1]), height: parseInt(match[2]) };
        }
      }
    } catch { /* silent */ }
    return { width: 1920, height: 1080 };
  }

  async getWindowList(): Promise<Array<{ title: string; pid: number; rect?: { x: number; y: number; width: number; height: number } }>> {
    try {
      if (process.platform === 'win32') {
        const result = await psExec(`Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object ProcessName, Id, MainWindowTitle | ConvertTo-Json`);
        const processes = JSON.parse(result.stdout);
        return (Array.isArray(processes) ? processes : [processes]).map((p: { MainWindowTitle?: string; ProcessName?: string; Id?: number }) => ({
          title: p.MainWindowTitle || p.ProcessName || 'Unknown',
          pid: p.Id || 0,
        }));
      }
    } catch { /* silent */ }
    return [];
  }

  // Application management
  async openApplication(name: string, path?: string): Promise<ApplicationRecord> {
    const app: ApplicationRecord = {
      id: randomUUID(),
      name,
      path: path ?? name,
      launched: Date.now(),
      status: 'running',
    };

    try {
      if (process.platform === 'win32') {
        const cmd = path ? `start "" "${path}"` : `start "" "${name}"`;
        await psExec(cmd);
      }
    } catch {
      app.status = 'error';
    }

    this.applications.set(app.id, app);
    void this.saveData();
    return app;
  }

  async closeApplication(appId: string): Promise<boolean> {
    const app = this.applications.get(appId);
    if (!app) return false;

    try {
      if (process.platform === 'win32' && app.name) {
        await psExec(`taskkill /IM "${app.name}" /F 2>nul`);
      }
      app.status = 'stopped';
      void this.saveData();
      return true;
    } catch {
      return false;
    }
  }

  getRecentMouseActions(count: number = 20): MouseAction[] {
    return this.mouseActions.slice(-count);
  }

  getRecentKeyboardActions(count: number = 20): KeyboardAction[] {
    return this.keyboardActions.slice(-count);
  }

  getCaptures(count: number = 10): ScreenCapture[] {
    return this.captures.slice(-count);
  }

  getApplications(): ApplicationRecord[] {
    return Array.from(this.applications.values());
  }

  getStats(): {
    totalMouseActions: number;
    totalKeyboardActions: number;
    totalCaptures: number;
    runningApps: number;
  } {
    return {
      totalMouseActions: this.mouseActions.length,
      totalKeyboardActions: this.keyboardActions.length,
      totalCaptures: this.captures.length,
      runningApps: Array.from(this.applications.values()).filter((a) => a.status === 'running').length,
    };
  }
}

