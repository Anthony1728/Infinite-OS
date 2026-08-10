import type { Tool, ToolResult } from './base.js';
import { getBrainTeachingManager } from '../brain/teacher.js';

const ACTIONS = [
  'search_lessons',
  'list_lessons',
  'explain',
  'quiz',
  'study_plan',
  'teaching_status',
] as const;

export const teachTool: Tool = {
  name: 'Teach',
  description:
    'Interactive teaching tool for the user. Search brain lessons, explain topics, generate quizzes, create study plans, and check the teaching system status. Uses the distilled knowledge base to teach the user anything they need to learn.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'Teaching action to perform' },
      query: { type: 'string', description: 'Search query for lessons or topic to explain/quiz/study' },
      limit: { type: 'number', description: 'Maximum number of lessons to return (default 6)' },
      difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], description: 'Quiz or study plan difficulty level' },
      question_count: { type: 'number', description: 'Number of quiz questions to generate (default 5)' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: (typeof ACTIONS)[number];
      query?: string;
      limit?: number;
      difficulty?: string;
      question_count?: number;
    };

    try {
      const teacher = getBrainTeachingManager();

      switch (input.action) {
        case 'search_lessons': {
          if (!input.query) return missing('query');
          const lessons = teacher.searchLessons(input.query, input.limit ?? 6);
          if (lessons.length === 0) {
            return ok(`No lessons found for "${input.query}". Try different keywords or start a teaching session to learn new topics.`);
          }
          const formatted = lessons.map((l, i) =>
            `[${i + 1}] ${l.title}\n    Topic: ${l.topic}\n    Q: ${l.question}\n    A: ${l.answer}\n    When to use: ${l.useWhen}`
          ).join('\n\n');
          return ok(`Found ${lessons.length} lesson(s) for "${input.query}":\n\n${formatted}`);
        }
        case 'list_lessons': {
          const lessons = teacher.getLessons(input.limit ?? 20);
          if (lessons.length === 0) {
            return ok('No lessons stored yet. The brain teaching system can generate lessons on any topic.');
          }
          const formatted = lessons.map((l, i) =>
            `[${i + 1}] ${l.title} (${l.topic})`
          ).join('\n');
          return ok(`${lessons.length} lesson(s) in the knowledge base:\n\n${formatted}`);
        }
        case 'explain': {
          if (!input.query) return missing('query');
          const lessons = teacher.searchLessons(input.query, 3);
          let response = `## Explaining: ${input.query}\n\n`;
          if (lessons.length > 0) {
            response += '### From Knowledge Base\n';
            for (const l of lessons) {
              response += `\n**${l.title}**\n${l.answer}\n`;
              if (l.example) response += `Example: ${l.example}\n`;
            }
            response += '\n';
          }
          response += '### Explanation\nProvide a clear, concise explanation of this topic tailored to the user. ';
          response += 'Use examples and analogies. If this is a technical topic, include practical applications. ';
          response += 'Ask if the user wants to go deeper or take a quiz.';
          return ok(response);
        }
        case 'quiz': {
          if (!input.query) return missing('query');
          const count = input.question_count ?? 5;
          const difficulty = input.difficulty ?? 'intermediate';
          const lessons = teacher.searchLessons(input.query, 5);

          let response = `## Quiz: ${input.query}\nDifficulty: ${difficulty}\n\n`;
          if (lessons.length > 0) {
            response += '### Reference Material\n';
            for (const l of lessons) {
              response += `- ${l.title}: ${l.answer}\n`;
            }
            response += '\n';
          }
          response += `### Generate ${count} Quiz Questions\n`;
          response += 'Create quiz questions based on the knowledge above. For each question:\n';
          response += '1. State the question clearly\n';
          response += '2. Provide 4 multiple choice options (A, B, C, D)\n';
          response += '3. After all questions, provide the answer key\n\n';
          response += 'Format each question as:\n';
          response += 'Q1: [question]\nA) [option]\nB) [option]\nC) [option]\nD) [option]\n\n';
          return ok(response);
        }
        case 'study_plan': {
          if (!input.query) return missing('query');
          const difficulty = input.difficulty ?? 'intermediate';
          const lessons = teacher.searchLessons(input.query, 10);

          let response = `## Study Plan: ${input.query}\nLevel: ${difficulty}\n\n`;
          if (lessons.length > 0) {
            response += '### Available Knowledge\n';
            for (const l of lessons) {
              response += `- ${l.title}: ${l.useWhen}\n`;
            }
            response += '\n';
          }
          response += '### Create a Structured Study Plan\n';
          response += 'Generate a study plan that includes:\n';
          response += '1. Learning objectives (what the user will know after)\n';
          response += '2. Prerequisites (what they should know first)\n';
          response += '3. Week-by-week or day-by-day breakdown\n';
          response += '4. Practice exercises for each section\n';
          response += '5. Milestones and self-assessment checkpoints\n';
          response += '6. Resources and next steps\n\n';
          response += 'Adapt the plan to the specified difficulty level.';
          return ok(response);
        }
        case 'teaching_status': {
          const status = teacher.getStatus();
          return ok(JSON.stringify({
            state: status.state,
            phase: status.phase,
            focus: status.focus,
            lessonsStored: status.totalStoredLessons,
            cyclesCompleted: status.cyclesCompleted,
            currentTopic: status.currentTopic,
            message: status.message,
          }, null, 2));
        }
        default:
          return bad(`Unknown Teach action: ${input.action}`);
      }
    } catch (error) {
      return bad(`Teach action failed: ${(error as Error).message}`);
    }
  },
};

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}

function missing(fields: string): ToolResult {
  return { content: `Teach action requires ${fields}.`, is_error: true };
}
