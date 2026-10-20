/**
 * WorkerVault tool — credential access for a running Worker.
 *
 * Two hard rules, enforced in execute() rather than left to the prompt:
 * 1. Only a session that IS a worker run (ctx.sessionId == workflowId) may use
 *    this tool. A chat session gets a refusal, even with the schema attached.
 * 2. Only credentials the user explicitly authorized to that worker resolve,
 *    and secrets are typed into the focused field by keystrokes — they never
 *    appear in the tool result, the transcript, or the action log.
 *
 * permission: 'allow' — the per-credential authorization made in the Workers
 * vault UI is the consent boundary, so unattended scheduled runs work.
 */

import type { Tool, ToolResult } from './base.js';
import { getWorkerManager, type Worker } from '../workers/manager.js';
import { getCredentialVault } from '../workers/vault.js';
import { getComputerAutomation } from '../automation/computer-automation.js';

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

function bad(message: string): ToolResult {
  return { content: message, is_error: true };
}

export const workerVaultTool: Tool = {
  name: 'WorkerVault',
  description:
    'Use passwords the user has explicitly authorized to THIS worker (per-worker login authorization). Actions: list returns the authorized credential labels/usernames (never secrets); type types the saved username or password into the currently focused field by keystrokes, optionally pressing Enter. Call it only from inside a running worker — chat sessions are refused. Secrets never appear in output, transcripts, or logs.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'type'], description: 'list = authorized credentials; type = enter one into the focused field' },
      credential: { type: 'string', description: 'Credential label or ID from list (type)' },
      field: { type: 'string', enum: ['username', 'password', 'token'], description: 'Which stored value to type (type)' },
      submit: { type: 'boolean', description: 'Press Enter after typing (type)' },
    },
    required: ['action'],
  },
  permission: 'allow',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action?: string; credential?: string; field?: 'username' | 'password' | 'token'; submit?: boolean };
    try {
      // Rule 1: this session must be an actual worker run.
      const manager = getWorkerManager();
      const worker: Worker | null = manager.findByWorkflowId(ctx.sessionId) ?? null;
      if (!worker) {
        return bad('WorkerVault only works inside a running worker. Ask the user to save the credential in Workers → Vault and authorize it to that worker.');
      }

      const vault = getCredentialVault();
      if (input.action === 'list') {
        const entries = vault.list(worker.id);
        if (!entries.length) {
          return json({ entries: [], note: 'No credentials are authorized to this worker yet. The user must add one in Workers → Vault and authorize this worker.' });
        }
        return json({ entries });
      }

      if (input.action === 'type') {
        // Rule 2: only credentials authorized to this worker.
        const needle = String(input.credential ?? '').trim().toLowerCase();
        if (!needle) return bad('credential (label or ID) is required.');
        const allowed = vault.list(worker.id);
        const entry = allowed.find((item) => item.id === needle || item.label.toLowerCase() === needle);
        if (!entry) {
          return bad(`No credential "${input.credential}" is authorized to worker "${worker.name}".`);
        }
        const { entry: full, secret } = vault.resolveSecret(entry.id, worker.id);
        const field = input.field ?? 'password';
        const computer = getComputerAutomation();
        if (field === 'username') {
          if (!full.username) return bad(`Credential "${full.label}" has no stored username.`);
          await computer.typeText(full.username);
        } else {
          // password AND token both never touch the log.
          await computer.typeSecret(secret);
        }
        if (input.submit) await computer.pressKey('enter');
        return json({
          typed: field,
          credential: full.label,
          submit: Boolean(input.submit),
          note: 'Secret was entered as keystrokes and was not recorded anywhere.',
        });
      }

      return bad(`Unknown vault action: ${input.action}`);
    } catch (error) {
      return { content: error instanceof Error ? error.message : String(error), is_error: true };
    }
  },
};
