/**
 * Real agent runner for evaluations.
 *
 * This calls the same `runAgent` loop the app uses. It does not stub tools or
 * pre-fill answers: the agent must read, edit, and run commands inside the
 * isolated task workspace. Approval prompts are bypassed only for the life of
 * this process and only through the existing headless-exec environment flag.
 */

import type { Message } from '../../shared/types.js';
import { runAgent } from '../agent/loop.js';
import type { EvalRunner, EvalRunnerResult } from './contracts.js';

export interface AgentEvalRunnerOptions {
  provider: string;
  model: string;
}

export function createAgentEvalRunner(options: AgentEvalRunnerOptions): EvalRunner {
  return async (task, context): Promise<EvalRunnerResult> => {
    const previousYes = process.env.INFINITE_EXEC_YES;
    const previousReadonly = process.env.INFINITE_EXEC_READONLY;
    const previousEval = process.env.INFINITE_EVAL;
    process.env.INFINITE_EXEC_YES = '1';
    delete process.env.INFINITE_EXEC_READONLY;
    process.env.INFINITE_EVAL = '1';

    let success = false;
    let error: string | undefined;
    const tools: string[] = [];
    let streamedText = '';

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: task.prompt }],
      timestamp: Date.now(),
    };

    try {
      const completed = await runAgent([], userMessage, {
        sessionId: `eval-${task.id}-${Date.now()}`,
        cwd: context.workspace,
        provider: options.provider,
        model: options.model,
        signal: context.signal,
        maxTurns: task.maxTurns ?? 12,
        wallClockMs: task.timeoutMs ?? 5 * 60_000,
        onEvent: (event) => {
          const payload = event as {
            type?: string;
            name?: string;
            status?: string;
            error?: string;
            success?: boolean;
            text?: string;
          };
          if (payload.type === 'tool_use_start' && payload.name) {
            tools.push(payload.name);
            context.onProgress?.(`tool: ${payload.name}`);
          } else if (payload.type === 'provider_status' && payload.status) {
            context.onProgress?.(String(payload.status).slice(0, 160));
          } else if (payload.type === 'text_delta' && payload.text) {
            streamedText += payload.text;
          } else if (payload.type === 'done') {
            success = payload.success === true;
          } else if (payload.type === 'fallback_required') {
            error = error ?? (payload.error ? String(payload.error) : 'The agent did not reach a verified completion.');
          } else if (payload.type === 'error') {
            error = error ?? (payload.error ? String(payload.error) : 'The agent reported an error.');
          }
        },
      });

      const lastAssistant = [...completed].reverse().find((message) => message.role === 'assistant');
      const blocks = (lastAssistant?.content ?? []) as Array<{ type?: string; text?: string }>;
      const answer = blocks
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('\n\n')
        .trim();
      const output = [answer || streamedText.trim(), tools.length ? `\nTools used: ${[...new Set(tools)].join(', ')}` : '']
        .filter(Boolean)
        .join('\n');
      if (!success && !error) {
        error = answer
          ? 'The agent produced text but the loop did not report verified completion.'
          : 'The agent finished without a usable answer.';
      }
      return { success, output, ...(error ? { error } : {}) };
    } catch (caught) {
      return {
        success: false,
        output: '',
        error: (caught as Error).message,
      };
    } finally {
      if (previousYes === undefined) delete process.env.INFINITE_EXEC_YES;
      else process.env.INFINITE_EXEC_YES = previousYes;
      if (previousReadonly === undefined) delete process.env.INFINITE_EXEC_READONLY;
      else process.env.INFINITE_EXEC_READONLY = previousReadonly;
      if (previousEval === undefined) delete process.env.INFINITE_EVAL;
      else process.env.INFINITE_EVAL = previousEval;
    }
  };
}
