import type { Tool, ToolContext, ToolResult } from './base.js';

export const askQuestionTool: Tool = {
  name: 'AskUserQuestion',
  description: [
    'Ask the user a clarifying question with beautiful multi-choice options — OpenCode-style.',
    'Use this when your request is underspecified and you need the user to choose. For example, when the user says "2 models" without saying which two and what action, ask them to pick.',
    'You can ask 1-4 questions at once, each with 2-5 options plus an automatic "Type your own answer" custom input. The UI renders as beautiful Infinite OS glass cards (dark, rounded, violet→cyan gradient).',
    'The user\'s selection is sent back to you as a new user message and as a tool result, so you can continue the original task immediately after they answer. Always continue the original task after asking — do not stop.',
    'Example: user says "2 models" → ask: header="Model selection", question="Which 2 models and what should I do with them?", options=[{label:"Compare Gemma 4 31B vs Nemotron 3 Super", description:"Side-by-side compare page"}, {label:"Use OpenCode Zen + Ollama as paired models", description:"Enable pair mode"}, {label:"Run a quick test through both", description:"Benchmark"}].',
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

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const { questions } = args as {
      questions: Array<{ header: string; question: string; multiple?: boolean; options: Array<{ label: string; description: string }> }>;
    };
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return { content: 'No questions provided', is_error: true };
    }
    // Return the questions as structured JSON — the renderer will turn each into a
    // beautiful `type: question` block (Infinite OS glass, violet→cyan) with an
    // automatic "Type your own answer" custom input as the last option.
    // The user's selection will appear as the next user message; continue then.
    return {
      content: JSON.stringify({
        questions: questions.slice(0, 4).map((q, idx) => ({
          questionId: `q-${Date.now()}-${idx}`,
          header: q.header.slice(0, 30),
          question: q.question,
          multiple: !!q.multiple,
          options: q.options.slice(0, 5),
          allowCustom: true,
        })),
        hint: 'Rendered as beautiful multi-choice cards in chat. Wait for the user to select or type a custom answer, then continue the original task with that choice.',
      }),
    };
  },
};
