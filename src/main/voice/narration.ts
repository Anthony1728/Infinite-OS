// Narration for the optional communication-model split.
//
// THE PROBLEM
//
// Voice used one model for everything: understand the user, decide what to do,
// run twenty tools, and say the result. That model is chosen to be good at work,
// which is not the same as being good at talking. A big work model answers a
// spoken sentence slowly, and its written answer reads badly out loud.
//
// THE SPLIT (optional)
//
// The user can pick a fast communication model. It talks. The model already
// selected in Settings → Provider keeps doing the work — same tools, same
// permissions, same plan-mode gate — and this module takes what actually
// happened and asks the communication model to say it.
//
// Crucially the narration is built from REAL activity: the tool names, their
// inputs and whether they errored. It is never a summary of what we hoped
// happened. That is the whole point — the user is being told what the agent did
// while it was doing it, so it has to be true.
//
// If no communication model is set, nothing here runs and the behaviour is
// exactly what it was before.

import { getProvider } from '../providers/registry.js';
import { settings } from '../settings/store.js';
import type { AgentEvent } from '../agents/types.js';

export interface CommunicationModel {
  provider: string;
  model: string;
}

export interface ToolActivity {
  name: string;
  detail: string;
  status: 'running' | 'done' | 'error';
}

/**
 * The communication model, if the user chose one and it differs from the model
 * doing the work. Returns null when narration should be skipped.
 */
export function resolveCommunicationModel(execution: CommunicationModel): CommunicationModel | null {
  const provider = settings.get<string>('voiceCommunicationProvider');
  const model = settings.get<string>('voiceCommunicationModel');
  if (!provider || !model) return null;
  // Same model on both sides would add a round trip for no benefit.
  if (provider === execution.provider && model === execution.model) return null;
  return { provider, model };
}

/** Turn raw stream events into the short, honest activity list narration is built from. */
export function collectActivity(events: AgentEvent[]): ToolActivity[] {
  const out: ToolActivity[] = [];
  for (const event of events) {
    if (event.type === 'tool_use_start') {
      // The start event carries no input; the end event does.
      out.push({ name: event.name, detail: '', status: 'running' });
    } else if (event.type === 'tool_use_end') {
      const running = [...out].reverse().find((a) => a.status === 'running' && a.name === event.name);
      if (running) running.detail = describeInput(event.input);
    } else if (event.type === 'tool_result') {
      const running = [...out].reverse().find((a) => a.status === 'running');
      if (running) {
        running.status = event.is_error ? 'error' : 'done';
      }
    }
  }
  return out.slice(0, 12);
}

/** A short, speakable description of what a tool was pointed at. */
function describeInput(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of ['command', 'url', 'path', 'query', 'pattern', 'name', 'message']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      const text = value.trim();
      // Spoken output should not be a 400-character shell command.
      return text.length > 70 ? `${text.slice(0, 70)}…` : text;
    }
  }
  return '';
}

/** Render the activity as a compact briefing for the communication model. */
function briefActivity(activity: ToolActivity[]): string {
  if (activity.length === 0) return '';
  const lines = activity.map((item) => {
    const mark = item.status === 'error' ? 'FAILED' : item.status === 'running' ? 'doing' : 'done';
    return `- ${item.name} (${mark})${item.detail ? `: ${item.detail}` : ''}`;
  });
  return lines.join('\n');
}

const NARRATION_SYSTEM = [
  'You are the voice of an AI agent that just finished working. You speak to one person, out loud.',
  '',
  'You are given what actually happened — the tools that ran and their real results — and sometimes the raw written answer.',
  '',
  'Say it in at most two sentences. Lead with the outcome. Plain spoken English only:',
  '- no markdown, no bullet characters, no code fences, no URLs read out character by character',
  '- no "I will", no "Let me", no restating the question, no filler',
  '- past tense for what is already done; the present tense only if work is genuinely still running',
  '- if something failed, say plainly what failed and what happens next',
  '- if nothing happened, say so in one short sentence',
  '',
  'Never invent a result, a file, or a number that is not in what you were given. If it is not there, do not say it.',
].join('\n');

/**
 * Ask the communication model to say what happened.
 *
 * Falls back to the raw answer if the narration model is unavailable or fails:
 * the user must always hear something, and silence would look like a crash.
 */
export async function narrateResult(input: {
  communication: CommunicationModel;
  userText: string;
  activity: ToolActivity[];
  answer: string;
  failure?: string;
}): Promise<string> {
  const provider = getProvider(input.communication.provider);
  if (!provider) return input.answer;

  const activity = briefActivity(input.activity);
  const user = [
    activity ? `Tools that actually ran:\n${activity}` : 'No tools were needed for this.',
    input.failure ? `Something failed: ${input.failure}` : '',
    input.answer ? `The written answer from the agent was:\n${input.answer.slice(0, 1500)}` : 'There was no written answer.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const result = await provider.streamChat(
      {
        model: input.communication.model,
        cwd: process.cwd(),
        // Content blocks, not a bare string — the provider layer requires the
        // structured form.
        messages: [{ id: 'narration', role: 'user', content: [{ type: 'text', text: user }], timestamp: Date.now() }],
        system: NARRATION_SYSTEM,
        stream: true,
        signal: AbortSignal.timeout(30_000),
      },
      settings.get<string>('apiKey') ?? '',
    );

    let text = '';
    for await (const chunk of result) {
      if (chunk.type === 'text_delta' && chunk.text) text += chunk.text;
    }
    const spoken = text.trim();
    // A narration model that says nothing useful must not silence the answer.
    return spoken.length > 0 ? spoken : input.answer;
  } catch {
    return input.answer;
  }
}