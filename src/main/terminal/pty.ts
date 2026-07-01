/**
 * PTY (Pseudo-Terminal) Manager
 * 
 * Provides full PTY support for interactive terminal sessions.
 * Uses node-pty for cross-platform PTY support.
 */

import { EventEmitter } from 'node:events';
import { platform } from 'node:os';

// Try to import node-pty
let ptyModule: typeof import('node-pty') | null = null;
try {
  ptyModule = require('node-pty');
} catch {
  // node-pty not available - PTY functionality will be limited
}

export interface PtyOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtyData {
  sessionId: string;
  pid: number;
  cols: number;
  rows: number;
  cwd: string;
}

type DataCallback = (data: string) => void;
type ExitCallback = (exitCode: number, signal: string) => void;

interface PtyProcess {
  pid: number;
  cols: number;
  rows: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (exit: { exitCode: number; signal: string }) => void): void;
}

interface PtyInstance {
  pty: PtyProcess;
  sessionId: string;
  dataCallbacks: Set<DataCallback>;
  exitCallbacks: Set<ExitCallback>;
}

/**
 * PTY Manager - manages multiple PTY sessions
 */
export class PtyManager extends EventEmitter {
  private instances = new Map<string, PtyInstance>();
  private sessionCounter = 0;
  private isAvailable: boolean;

  constructor() {
    super();
    this.isAvailable = ptyModule !== null;
  }

  /**
   * Check if PTY is available
   */
  isPtyAvailable(): boolean {
    return this.isAvailable;
  }

  /**
   * Create a new PTY session
   */
  createSession(options?: PtyOptions): PtyData | null {
    if (!this.isAvailable || !ptyModule) {
      console.warn('[PtyManager] node-pty not available');
      return null;
    }

    const sessionId = `pty-${++this.sessionCounter}-${Date.now()}`;
    const cols = options?.cols ?? 80;
    const rows = options?.rows ?? 24;
    const cwd = options?.cwd ?? process.cwd();

    // Determine shell based on platform
    const shell = this.getShell();
    const shellArgs = this.getShellArgs();

    // Build environment
    const env: Record<string, string> = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      ...options?.env,
    };

    // Create PTY
    const ptyProcess = ptyModule.spawn(shell, shellArgs, {
      name: options?.name ?? 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    });

    const instance: PtyInstance = {
      pty: ptyProcess,
      sessionId,
      dataCallbacks: new Set(),
      exitCallbacks: new Set(),
    };

    // Forward data to all callbacks
    ptyProcess.onData((data: string) => {
      for (const cb of instance.dataCallbacks) {
        try {
          cb(data);
        } catch {
          // Ignore callback errors
        }
      }
    });

    // Forward exit events
    ptyProcess.onExit((exitInfo: { exitCode: number; signal: string }) => {
      for (const cb of instance.exitCallbacks) {
        try {
          cb(exitInfo.exitCode, exitInfo.signal);
        } catch {
          // Ignore callback errors
        }
      }
      this.instances.delete(sessionId);
      this.emit('sessionExit', { sessionId, ...exitInfo });
    });

    this.instances.set(sessionId, instance);

    this.emit('sessionCreate', {
      sessionId,
      pid: ptyProcess.pid,
      cols,
      rows,
      cwd,
    });

    return {
      sessionId,
      pid: ptyProcess.pid,
      cols,
      rows,
      cwd,
    };
  }

  /**
   * Write data to a PTY session
   */
  write(sessionId: string, data: string): boolean {
    const instance = this.instances.get(sessionId);
    if (!instance) return false;

    try {
      instance.pty.write(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resize a PTY session
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const instance = this.instances.get(sessionId);
    if (!instance) return false;

    try {
      instance.pty.resize(cols, rows);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Register a data callback for a session
   */
  onData(sessionId: string, callback: DataCallback): () => void {
    const instance = this.instances.get(sessionId);
    if (!instance) return () => {};

    instance.dataCallbacks.add(callback);
    return () => {
      instance.dataCallbacks.delete(callback);
    };
  }

  /**
   * Register an exit callback for a session
   */
  onExit(sessionId: string, callback: ExitCallback): () => void {
    const instance = this.instances.get(sessionId);
    if (!instance) return () => {};

    instance.exitCallbacks.add(callback);
    return () => {
      instance.exitCallbacks.delete(callback);
    };
  }

  /**
   * Close a PTY session
   */
  closeSession(sessionId: string): boolean {
    const instance = this.instances.get(sessionId);
    if (!instance) return false;

    try {
      instance.pty.kill();
      this.instances.delete(sessionId);
      this.emit('sessionClose', { sessionId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close all sessions
   */
  closeAll(): void {
    for (const [, instance] of this.instances) {
      try {
        instance.pty.kill();
      } catch {
        // Ignore
      }
    }
    this.instances.clear();
    this.emit('allClosed');
  }

  /**
   * Get all active sessions
   */
  getSessions(): PtyData[] {
    const sessions: PtyData[] = [];
    for (const [sessionId, instance] of this.instances) {
      sessions.push({
        sessionId,
        pid: instance.pty.pid,
        cols: instance.pty.cols,
        rows: instance.pty.rows,
        cwd: process.cwd(),
      });
    }
    return sessions;
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): PtyData | null {
    const instance = this.instances.get(sessionId);
    if (!instance) return null;

    return {
      sessionId,
      pid: instance.pty.pid,
      cols: instance.pty.cols,
      rows: instance.pty.rows,
      cwd: process.cwd(),
    };
  }

  /**
   * Get shell executable based on platform
   */
  private getShell(): string {
    const plat = platform();
    
    if (plat === 'win32') {
      const systemRoot = process.env.SYSTEMROOT ?? 'C:\\Windows';
      const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
      return powershell;
    }
    
    // Unix-like systems
    const shell = process.env.SHELL;
    if (shell) return shell;
    
    // Fallbacks
    if (plat === 'darwin') return '/bin/zsh';
    return '/bin/bash';
  }

  /**
   * Get shell arguments based on platform
   */
  private getShellArgs(): string[] {
    const plat = platform();
    
    if (plat === 'win32') {
      // PowerShell args for better compatibility
      return ['-NoLogo', '-NoProfile', '-Command'];
    }
    
    // Login shell for Unix
    return ['-l'];
  }
}

// Singleton instance
let ptyManager: PtyManager | null = null;

export function getPtyManager(): PtyManager {
  if (!ptyManager) {
    ptyManager = new PtyManager();
  }
  return ptyManager;
}