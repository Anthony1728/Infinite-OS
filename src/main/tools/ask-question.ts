import type { Tool, ToolContext, ToolResult } from './base.js';
import { askUserQuestions } from '../agent/question-prompt.js';

export const askQuestionTool: Tool = {
  name: 'AskUserQuestion',
  description: [
    'Ask the user 1-4 clarifying questions as interactive multi-choice cards (2-5 options each plus a free-text custom answer).',
    'This tool BLOCKS: it returns only when the user has answered every question (or skipped).',
    'Use it BEFORE making an irreversible or high-effort choice the user must own: which stack/framework, which model/provider, approve scope, pick between designs.',
    'Do NOT use it for trivia you can decide yourself or that is already answered in the request — ask once, with concrete options, then continue the original task with the answers.',
  ].join(' '),
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '1-4 questions to ask',
        items: {
          type: 'object',
          properties: {
            header: { type: 'string', description: 'Very short label (max 30 chars)' },
            question: { type: 'string', description: 'Complete question' },
            multiple: { type: 'boolean', description: 'Allow selecting multiple choices' },
            options: {
              type: 'array',
              description: 'Available choices (2-5)',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Display text (1-5 words, concise)' },
                  description: { type: 'string', description: 'Explanation of choice' },
                },
                required: ['label', 'description'],
              },
            },
          },
          required: ['question', 'header', 'options'],
        },
      },
    },
    required: ['questions'],
  },

  async execute(args: unknown, ctx: ToolContext): Promise<ToolResult> {
    const { questions } = args as {
      questions: Array<{ header: string; question: string; multiple?: boolean; options: Array<{ label: string; description: string }> }>;
    };
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return { content: 'No questions provided', is_error: true };
    }

    const normalized = questions.slice(0, 4).map((q) => ({
      header: String(q.header ?? 'Question').slice(0, 30),
      question: String(q.question ?? '').slice(0, 500),
      multiple: !!q.multiple,
      options: (Array.isArray(q.options) ? q.options : [])
        .map((o) => ({ label: String(o?.label ?? '').slice(0, 120), description: String(o?.description ?? '').slice(0, 200) }))
        .filter((o) => o.label.length > 0)
        .slice(0, 5),
      allowCustom: true,
    }));

    const resolution = await askUserQuestions(normalized, {
      sessionId: ctx.sessionId,
      signal: ctx.abortSignal,
    });

    if (resolution.timedOut) {
      return {
        content: 'No answer received in time (user may be away). Proceed with your best judgment on the least risky option and note the assumption.',
        is_error: true,
      };
    }

    const parts: string[] = [];
    for (const [qid, answer] of Object.entries(resolution.answers)) {
      const idx = Number(qid.split('-')[1]);
      const spec = questions[idx];
      parts.push(`${spec?.header ?? 'Question'}: ${answer}`);
    }
    for (const qid of Object.keys(resolution.skipped)) {
      const idx = Number(qid.split('-')[1]);
      const spec = questions[idx];
      parts.push(`${spec?.header ?? 'Question'}: [skipped by user]`);
    }

    return {
      content: [
        'The user answered via the question cards:',
        ...parts,
        '',
        'Continue the original task now using these answers. Do not re-ask unless a new decision is genuinely required.',
      ].join('\n'),
    };
  },
};
