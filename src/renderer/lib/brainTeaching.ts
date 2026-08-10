export type BrainTeachingSource = 'curriculum' | 'topic' | 'conversation' | 'last-task' | 'online';

export type BrainTeachingCommand =
  | { action: 'start'; durationMinutes: 10 | 60; source: BrainTeachingSource; topic?: string }
  | { action: 'status' }
  | { action: 'stop' }
  | { action: 'help' };

export interface BrainTeachingStatus {
  active?: boolean;
  state?: 'idle' | 'running' | 'completed' | 'stopped';
  phase?: 'idle' | 'preparing' | 'searching' | 'reading' | 'distilling' | 'verifying' | 'saved' | 'recovering' | 'complete';
  sessionId?: string | null;
  durationMinutes?: number;
  startedAt?: number | string;
  endsAt?: number | string;
  lessonsCompleted?: number;
  lessonsLearned?: number;
  currentTopic?: string;
  focus?: string;
  topic?: string;
  source?: BrainTeachingSource;
  provider?: string;
  model?: string;
  currentProvider?: string | null;
  currentModel?: string | null;
  message?: string;
  lessonsAdded?: number;
  cyclesCompleted?: number;
  recoveryCount?: number;
  totalStoredLessons?: number;
  nextCycleAt?: number | null;
}

const HELP_TEXT =
  '**Brain teaching**\n\n' +
  '- `/teach 10m` — learn coding and general problem-solving for 10 minutes\n' +
  '- `/teach 1h` — run a one-hour teaching session\n' +
  '- `/teach 10m TypeScript` — learn a chosen topic\n' +
  '- `/teach conversation` — learn from this conversation\n' +
  '- `/teach last` — learn from the last completed task\n' +
  '- `/teach status` — see useful progress\n' +
  '- `/teach stop` — finish early and keep what was learned';

export function parseBrainTeachingCommand(text: string): BrainTeachingCommand | null {
  const trimmed = text.trim();
  const onlineLearning = /\b(?:go\s+(?:and\s+)?|start|begin|keep)\b[\s\S]{0,60}\b(?:learn|learning|research|browsing)\b[\s\S]{0,80}\b(?:online|web|internet)\b/i.test(trimmed) &&
    /\b(?:smarter|improve|knowledge|capabilit|help|learn)\b/i.test(trimmed);
  if (onlineLearning) {
    const topic = trimmed.match(/\b(?:about|on|focused on)\s+(.+?)(?:\s+(?:so|for)\s+(?:you|i|we)\b|[.!?]|$)/i)?.[1]?.trim();
    return { action: 'start', durationMinutes: 10, source: 'online', ...(topic ? { topic } : {}) };
  }
  if (/^teach (?:the )?(?:infinite )?brain (?:what you just did|from (?:this|our) conversation)[.!]?$/i.test(trimmed)) {
    return {
      action: 'start',
      durationMinutes: 10,
      source: /conversation/i.test(trimmed) ? 'conversation' : 'last-task',
    };
  }

  const naturalSession = /^(?:(?:tell|use|have)\s+[\w./:+-]+\s+(?:to\s+)?|[\w./:+-]+[,;:]?\s+)?(?:start\s+)?teach(?:ing)?\s+(?:the\s+)?(?:infinite\s+(?:ai\s+)?brain|infinite\s+ai)\s+(?:for\s+)?(10\s*(?:m|min(?:ute)?s?)|(?:1|one|an)\s*h(?:our)?s?)(?:\s+(?:about|on|based\s+on)\s+(.+))?[.!]?$/i.exec(trimmed);
  if (naturalSession) {
    const topic = naturalSession[2]?.replace(/[.!]+$/, '').trim();
    return {
      action: 'start',
      durationMinutes: /hour|\bh\b/i.test(naturalSession[1]) ? 60 : 10,
      source: topic ? 'topic' : 'curriculum',
      ...(topic ? { topic } : {}),
    };
  }

  const match = /^\/teach(?:\s+(.*))?$/i.exec(trimmed);
  if (!match) return null;

  const argument = (match[1] ?? '').trim();
  if (!argument || /^(help|\?)$/i.test(argument)) return { action: 'help' };
  if (/^status$/i.test(argument)) return { action: 'status' };
  if (/^(stop|cancel)$/i.test(argument)) return { action: 'stop' };
  if (/^(conversation|chat)$/i.test(argument)) {
    return { action: 'start', durationMinutes: 10, source: 'conversation' };
  }
  if (/^(last|last-task|last task)$/i.test(argument)) {
    return { action: 'start', durationMinutes: 10, source: 'last-task' };
  }
  if (/^(online|web|internet)$/i.test(argument)) {
    return { action: 'start', durationMinutes: 10, source: 'online' };
  }

  const duration = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b(?:\s+(.*))?$/i.exec(argument);
  if (!duration) return { action: 'help' };

  const value = Number(duration[1]);
  const unit = duration[2].toLowerCase();
  const durationMinutes = unit.startsWith('h') ? value * 60 : value;
  if (!Number.isFinite(durationMinutes) || (durationMinutes !== 10 && durationMinutes !== 60)) {
    return { action: 'help' };
  }

  const topic = duration[3]?.trim();
  return {
    action: 'start',
    durationMinutes,
    source: topic ? 'topic' : 'curriculum',
    ...(topic ? { topic } : {}),
  };
}

type TeachingContextMessage = {
  role: string;
  content: Array<{ type: string; text?: string }>;
};

function contextLine(message: TeachingContextMessage): string {
  const text = message.content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text?.trim())
    .filter(Boolean)
    .join('\n');
  return text ? `${message.role === 'assistant' ? 'Assistant result' : 'User request'}:\n${text}` : '';
}

export function buildBrainTeachingContext(
  messages: TeachingContextMessage[],
  source: BrainTeachingSource,
): string | undefined {
  if (source === 'curriculum' || source === 'topic' || source === 'online') return undefined;
  if (source === 'conversation') {
    const context = messages.slice(-16).map(contextLine).filter(Boolean).join('\n\n');
    return context ? context.slice(-8_000) : undefined;
  }

  let assistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant' && contextLine(messages[index])) {
      assistantIndex = index;
      break;
    }
  }
  if (assistantIndex < 0) return undefined;
  let userIndex = -1;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && contextLine(messages[index])) {
      userIndex = index;
      break;
    }
  }
  const pair = [userIndex >= 0 ? messages[userIndex] : null, messages[assistantIndex]].filter(
    (message): message is TeachingContextMessage => Boolean(message),
  );
  return pair.map(contextLine).filter(Boolean).join('\n\n').slice(-8_000) || undefined;
}

function lessonCount(status: BrainTeachingStatus): number {
  return Math.max(0, status.lessonsCompleted ?? status.lessonsLearned ?? 0);
}

function remainingMinutes(status: BrainTeachingStatus): number | null {
  if (!status.endsAt) return status.durationMinutes ?? null;
  const end = typeof status.endsAt === 'number' ? status.endsAt : Date.parse(status.endsAt);
  if (!Number.isFinite(end)) return status.durationMinutes ?? null;
  return Math.max(0, Math.ceil((end - Date.now()) / 60_000));
}

export function formatBrainTeachingResult(
  action: BrainTeachingCommand['action'],
  status: BrainTeachingStatus = {},
): string {
  if (action === 'help') return HELP_TEXT;

  const learned = lessonCount(status);
  if (action === 'start' && status.active === false) {
    return brainTeachingUnavailableMessage();
  }
  if (action === 'stop') {
    return `**Brain teaching complete.** ${learned ? `${learned} useful lesson${learned === 1 ? '' : 's'} saved` : 'Everything learned so far was saved'}.`;
  }

  if (action === 'status' && status.active === false) {
    return `**Brain teaching is idle.** ${learned ? `${learned} lesson${learned === 1 ? '' : 's'} are available in memory. ` : ''}Start a focused session with \`/teach 10m\` or \`/teach 1h\`.`;
  }

  if (action === 'start') {
    const minutes = status.durationMinutes ?? remainingMinutes(status) ?? 10;
    const topic = status.topic ?? status.focus;
    const focus = topic ? ` focused on **${topic}**` : '';
    const source = status.source === 'conversation'
      ? ' It is distilling useful knowledge from this conversation.'
      : status.source === 'last-task'
        ? ' It is distilling the approach and result from the last completed task.'
        : status.source === 'online'
          ? ' It is actively searching the web, reading sources, and distilling verified lessons.'
          : '';
    return `**Brain teaching started for ${minutes === 60 ? '1 hour' : `${minutes} minutes`}**${focus}.${source} It is learning in the background from your configured AI models and will switch automatically when needed. Use \`/teach status\` for progress or \`/teach stop\` to finish early.`;
  }

  const remaining = remainingMinutes(status);
  const details = [
    `${learned} lesson${learned === 1 ? '' : 's'} saved`,
    remaining !== null ? `${remaining} minute${remaining === 1 ? '' : 's'} remaining` : null,
    status.currentTopic ? `learning **${status.currentTopic}**` : null,
    status.provider || status.model ? `using ${[status.provider, status.model].filter(Boolean).join(' · ')}` : null,
  ].filter(Boolean);
  return `**Brain teaching is active.** ${details.join(' · ')}.`;
}

export function brainTeachingUnavailableMessage(): string {
  return '**Brain teaching is not ready yet.** Add at least one working API key in Settings, then try `/teach 10m` again.';
}
