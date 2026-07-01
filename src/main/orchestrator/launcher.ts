/**
 * Orchestrator Launcher
 * 
 * Utility to start the orchestrator server from the Electron main process.
 * Can be called during app startup or on-demand.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';

let orchestratorProcess: ChildProcess | null = null;

export interface OrchestratorOptions {
  port?: number;
  host?: string;
  silent?: boolean;
}

export function startOrchestrator(options: OrchestratorOptions = {}): ChildProcess {
  if (orchestratorProcess) {
    console.log('[Orchestrator] Already running');
    return orchestratorProcess;
  }

  const env = {
    ...process.env,
    ORCHESTRATOR_PORT: String(options.port ?? 3001),
    ORCHESTRATOR_HOST: options.host ?? '127.0.0.1',
  };

  // Try to run the compiled server
  const serverPath = join(import.meta.dirname ?? __dirname, 'server.js');

  orchestratorProcess = fork(serverPath, [], {
    env,
    stdio: options.silent ? 'ignore' : 'pipe',
    detached: false,
  });

  orchestratorProcess.on('error', (err) => {
    console.error('[Orchestrator] Failed to start:', err.message);
    orchestratorProcess = null;
  });

  orchestratorProcess.on('exit', (code) => {
    console.log(`[Orchestrator] Exited with code ${code}`);
    orchestratorProcess = null;
  });

  if (!options.silent) {
    orchestratorProcess.stdout?.on('data', (data) => {
      console.log(`[Orchestrator] ${data.toString().trim()}`);
    });
    orchestratorProcess.stderr?.on('data', (data) => {
      console.error(`[Orchestrator] ${data.toString().trim()}`);
    });
  }

  console.log('[Orchestrator] Started');
  return orchestratorProcess;
}

export function stopOrchestrator(): void {
  if (orchestratorProcess) {
    orchestratorProcess.kill('SIGTERM');
    orchestratorProcess = null;
    console.log('[Orchestrator] Stopped');
  }
}

export function isOrchestratorRunning(): boolean {
  return orchestratorProcess !== null && !orchestratorProcess.killed;
}

export async function waitForOrchestrator(timeout = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch('http://127.0.0.1:3001/api/health');
      if (response.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

