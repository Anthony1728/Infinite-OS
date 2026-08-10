/**
 * Debug Console Subsystem
 * 
 * Provides debugging capabilities for code execution.
 * Implements a basic debug adapter protocol.
 */

import { EventEmitter } from 'node:events';
import { spawn, ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';

export interface Breakpoint {
  id: string;
  filePath: string;
  line: number;
  condition?: string;
  enabled: boolean;
}

export interface StackFrame {
  id: number;
  name: string;
  filePath: string;
  line: number;
  column: number;
}

export interface Scope {
  name: string;
  variables: Array<{ name: string; value: string; type: string }>;
}

export interface DebugEvent {
  type: 'breakpoint' | 'step' | 'exception' | 'output' | 'terminated' | 'paused' | 'continued';
  data: unknown;
  timestamp: number;
}

interface DebugSession {
  id: string;
  process: ChildProcess | null;
  breakpoints: Map<string, Breakpoint[]>;
  stopped: boolean;
  exitCode: number | null;
}

/**
 * Debug Adapter
 * 
 * Provides debugging capabilities for Node.js and other processes.
 */
export class DebugAdapter extends EventEmitter {
  private sessions = new Map<string, DebugSession>();
  private currentSession: string | null = null;

  constructor() {
    super();
  }

  /**
   * Start debugging a file
   */
  start(filePath: string, breakPoints: string[] = []): {
    sessionId: string;
    pid: number;
    error?: string;
  } {
    const sessionId = randomUUID();

    // Use node --inspect for debugging
    const child = spawn('node', ['--inspect', filePath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
      windowsHide: true,
    });

    const session: DebugSession = {
      id: sessionId,
      process: child,
      breakpoints: new Map(),
      stopped: false,
      exitCode: null,
    };

    // Capture output
    child.stdout?.on('data', (data) => {
      const output = data.toString();
      this.emitEvent('output', { output, category: 'stdout' });
    });

    child.stderr?.on('data', (data) => {
      const output = data.toString();
      this.emitEvent('output', { output, category: 'stderr' });
    });

    child.on('exit', (code) => {
      session.exitCode = code;
      this.emitEvent('terminated', { exitCode: code });
    });

    child.on('error', (err) => {
      this.emitEvent('exception', { error: err.message });
    });

    this.sessions.set(sessionId, session);
    this.currentSession = sessionId;

    // Set initial breakpoints
    if (breakPoints.length > 0) {
      this.setBreakpoints(filePath, breakPoints.map(l => parseInt(String(l))));
    }

    return {
      sessionId,
      pid: child.pid ?? 0,
    };
  }

  /**
   * Stop debugging
   */
  stop(sessionId?: string): boolean {
    const id = sessionId ?? this.currentSession;
    if (!id) return false;

    const session = this.sessions.get(id);
    if (!session || !session.process) return false;

    session.process.kill();
    this.sessions.delete(id);

    if (this.currentSession === id) {
      this.currentSession = null;
    }

    return true;
  }

  /**
   * Get debug status
   */
  getStatus(sessionId?: string): {
    isRunning: boolean;
    isPaused: boolean;
    sessionId: string | null;
    breakpoints: number;
    exitCode: number | null;
  } {
    const id = sessionId ?? this.currentSession;

    if (!id) {
      return {
        isRunning: false,
        isPaused: false,
        sessionId: null,
        breakpoints: 0,
        exitCode: null,
      };
    }

    const session = this.sessions.get(id);
    if (!session) {
      return {
        isRunning: false,
        isPaused: false,
        sessionId: id,
        breakpoints: 0,
        exitCode: null,
      };
    }

    return {
      isRunning: session.process !== null && !session.stopped,
      isPaused: session.stopped,
      sessionId: id,
      breakpoints: Array.from(session.breakpoints.values()).flat().length,
      exitCode: session.exitCode,
    };
  }

  /**
   * Set breakpoints for a file
   */
  setBreakpoints(filePath: string, lines: number[]): Breakpoint[] {
    const id = this.currentSession;
    if (!id) return [];

    const session = this.sessions.get(id);
    if (!session) return [];

    const breakpoints: Breakpoint[] = lines.map((line) => ({
      id: randomUUID(),
      filePath,
      line,
      enabled: true,
    }));

    session.breakpoints.set(filePath, breakpoints);
    return breakpoints;
  }

  /**
   * List breakpoints
   */
  listBreakpoints(filePath?: string): Breakpoint[] {
    const id = this.currentSession;
    if (!id) return [];

    const session = this.sessions.get(id);
    if (!session) return [];

    if (filePath) {
      return session.breakpoints.get(filePath) ?? [];
    }

    return Array.from(session.breakpoints.values()).flat();
  }

  /**
   * Evaluate an expression
   */
  evaluate(expression: string): { ok: boolean; result?: string; error?: string } {
    // Note: Full evaluation requires debugger protocol
    // This is a simplified version
    try {
      // Keep fallback evaluation isolated from the Electron main-process scope.
      // A real attached debug session should replace this with its protocol API.
      const result = runInNewContext(expression, Object.create(null), {
        timeout: 1_000,
        contextCodeGeneration: { strings: false, wasm: false },
      });
      return {
        ok: true,
        result: JSON.stringify(result, null, 2),
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Step actions (in, out, over)
   */
  step(action: 'in' | 'out' | 'over'): boolean {
    // Note: Full step control requires debugger protocol
    // This would send the appropriate commands to the debuggee
    this.emitEvent('continued', { action });
    return true;
  }

  /**
   * Continue execution
   */
  continue(): boolean {
    const id = this.currentSession;
    if (!id) return false;

    const session = this.sessions.get(id);
    if (!session) return false;

    session.stopped = false;
    this.emitEvent('continued', {});
    return true;
  }

  /**
   * Pause execution
   */
  pause(): boolean {
    const id = this.currentSession;
    if (!id) return false;

    const session = this.sessions.get(id);
    if (!session || !session.process) return false;

    // Send SIGSTOP to pause
    session.process.kill('SIGSTOP');
    session.stopped = true;
    this.emitEvent('paused', {});
    return true;
  }

  /**
   * Get stack trace
   */
  getStackTrace(): StackFrame[] {
    // Note: Full stack trace requires debugger protocol
    return [
      {
        id: 0,
        name: 'main',
        filePath: 'unknown',
        line: 0,
        column: 0,
      },
    ];
  }

  /**
   * Get scope variables
   */
  getScopes(_frameId: number): Scope[] {
    // Note: Full scope inspection requires debugger protocol
    return [
      {
        name: 'Local',
        variables: [],
      },
      {
        name: 'Global',
        variables: [],
      },
    ];
  }

  private emitEvent(type: DebugEvent['type'], data: unknown): void {
    this.emit(type, data);
    this.emit('event', {
      type,
      data,
      timestamp: Date.now(),
    } as DebugEvent);
  }
}

// Singleton
let adapter: DebugAdapter | null = null;

export function getDebugAdapter(): DebugAdapter {
  if (!adapter) {
    adapter = new DebugAdapter();
  }
  return adapter;
}
