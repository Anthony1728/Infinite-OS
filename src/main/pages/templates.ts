/**
 * Page and database templates.
 *
 * Templates are just seed data. Every id is generated once when the template
 * is applied, then normal store normalisation takes over. That keeps template
 * code out of the persistence path and makes duplicating a template behave
 * exactly like duplicating any other page.
 */

import {
  type DatabaseProperty,
  type DatabaseRow,
  type DatabaseView,
  type PageBlock,
  type PageCover,
  type PageDatabase,
  type PageKind,
  type PageTemplateId,
} from '../../shared/pages.js';

export interface TemplateSeed {
  id: string;
  parentId: string | null;
  kind: PageKind;
  title: string;
  icon: string;
  cover: PageCover | null;
  blocks: PageBlock[];
  database?: PageDatabase;
  order: number;
}

export interface TemplateResult {
  rootId: string;
  seeds: TemplateSeed[];
}

type IdFactory = () => string;

interface BuildContext {
  id: IdFactory;
  now: number;
}

function block(
  ctx: BuildContext,
  type: PageBlock['type'],
  html = '',
  extra: Partial<PageBlock> = {},
): PageBlock {
  const created: PageBlock = { id: ctx.id(), type, html, depth: 0, ...extra };
  if (type === 'todo') created.checked = extra.checked ?? false;
  if (type === 'toggle') created.collapsed = extra.collapsed ?? false;
  if (type === 'code') created.language = extra.language ?? 'plain text';
  return created;
}

function todo(ctx: BuildContext, html: string, depth = 0): PageBlock {
  return block(ctx, 'todo', html, { checked: false, depth });
}

function option(id: string, name: string, color: string) {
  return { id, name, color };
}

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function row(
  ctx: BuildContext,
  values: Record<string, string | number | boolean | string[] | null>,
  order: number,
): DatabaseRow {
  return {
    id: ctx.id(),
    values,
    order,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
}

function table(
  ctx: BuildContext,
  properties: DatabaseProperty[],
  rows: DatabaseRow[],
  extraViews: DatabaseView[] = [],
): PageDatabase {
  const views: DatabaseView[] = [
    { id: ctx.id(), name: 'Table', type: 'table' },
    { id: ctx.id(), name: 'Board', type: 'board', boardGroupBy: properties.find((p) => p.type === 'status')?.id },
    ...extraViews,
  ];
  return { properties, rows, views, defaultViewId: views[0]!.id };
}

function taskDatabase(ctx: BuildContext): PageDatabase {
  const properties: DatabaseProperty[] = [
    { id: 'title', name: 'Task', type: 'title' },
    {
      id: 'status',
      name: 'Status',
      type: 'status',
      options: [
        option('task-todo', 'Not started', 'zinc'),
        option('task-doing', 'In progress', 'sky'),
        option('task-done', 'Done', 'green'),
        option('task-blocked', 'Blocked', 'red'),
      ],
    },
    {
      id: 'priority',
      name: 'Priority',
      type: 'select',
      options: [
        option('priority-low', 'Low', 'zinc'),
        option('priority-medium', 'Medium', 'amber'),
        option('priority-high', 'High', 'red'),
      ],
    },
    { id: 'owner', name: 'Owner', type: 'text' },
    { id: 'due', name: 'Due', type: 'date' },
    { id: 'notes', name: 'Notes', type: 'text' },
  ];
  const rows = [
    row(ctx, { title: 'Define the outcome', status: 'task-done', priority: 'priority-high', owner: 'You', due: localDate(-2) }, 0),
    row(ctx, { title: 'Break the work into milestones', status: 'task-doing', priority: 'priority-high', owner: 'You', due: localDate(2) }, 1),
    row(ctx, { title: 'Assign owners and dates', status: 'task-todo', priority: 'priority-medium', owner: '', due: localDate(5) }, 2),
    row(ctx, { title: 'Ship the first version', status: 'task-todo', priority: 'priority-medium', owner: '', due: localDate(12) }, 3),
  ];
  return table(ctx, properties, rows, [
    { id: ctx.id(), name: 'Calendar', type: 'calendar', datePropertyId: 'due' },
    { id: ctx.id(), name: 'List', type: 'list' },
  ]);
}

function crmDatabase(ctx: BuildContext): PageDatabase {
  const properties: DatabaseProperty[] = [
    { id: 'title', name: 'Person', type: 'title' },
    {
      id: 'stage',
      name: 'Stage',
      type: 'status',
      options: [
        option('crm-lead', 'Lead', 'zinc'),
        option('crm-qualified', 'Qualified', 'sky'),
        option('crm-proposal', 'Proposal', 'amber'),
        option('crm-won', 'Won', 'green'),
        option('crm-lost', 'Lost', 'red'),
      ],
    },
    { id: 'company', name: 'Company', type: 'text' },
    { id: 'email', name: 'Email', type: 'email' },
    { id: 'next', name: 'Next step', type: 'text' },
    { id: 'followup', name: 'Follow-up', type: 'date' },
    { id: 'value', name: 'Value', type: 'number' },
  ];
  const rows = [
    row(ctx, { title: 'Maya Chen', stage: 'crm-qualified', company: 'Northstar Labs', email: 'maya@northstar.example', next: 'Send the pilot scope', followup: localDate(1), value: 12000 }, 0),
    row(ctx, { title: 'Jon Bell', stage: 'crm-proposal', company: 'Fieldwork', email: 'jon@fieldwork.example', next: 'Review pricing call', followup: localDate(3), value: 24000 }, 1),
    row(ctx, { title: 'Priya Raman', stage: 'crm-lead', company: 'Kite & Co', email: 'priya@kite.example', next: 'Intro call', followup: localDate(6), value: 8000 }, 2),
    row(ctx, { title: 'Owen Park', stage: 'crm-won', company: 'Harbor Studio', email: 'owen@harbor.example', next: 'Kickoff', followup: localDate(8), value: 18000 }, 3),
  ];
  return table(ctx, properties, rows, [{ id: ctx.id(), name: 'List', type: 'list' }]);
}

function contentDatabase(ctx: BuildContext): PageDatabase {
  const properties: DatabaseProperty[] = [
    { id: 'title', name: 'Title', type: 'title' },
    {
      id: 'status',
      name: 'Status',
      type: 'status',
      options: [
        option('content-idea', 'Idea', 'zinc'),
        option('content-draft', 'Drafting', 'amber'),
        option('content-review', 'Review', 'violet'),
        option('content-scheduled', 'Scheduled', 'sky'),
        option('content-published', 'Published', 'green'),
      ],
    },
    {
      id: 'channel',
      name: 'Channel',
      type: 'select',
      options: [
        option('channel-blog', 'Blog', 'violet'),
        option('channel-newsletter', 'Newsletter', 'sky'),
        option('channel-video', 'YouTube', 'red'),
        option('channel-social', 'Social', 'pink'),
      ],
    },
    { id: 'publish', name: 'Publish date', type: 'date' },
    { id: 'owner', name: 'Owner', type: 'text' },
    { id: 'notes', name: 'Notes', type: 'text' },
  ];
  const rows = [
    row(ctx, { title: 'The quiet advantage of a personal OS', status: 'content-draft', channel: 'channel-blog', publish: localDate(4), owner: 'You' }, 0),
    row(ctx, { title: 'Five workflows worth automating', status: 'content-idea', channel: 'channel-newsletter', publish: localDate(9), owner: 'You' }, 1),
    row(ctx, { title: 'Build a second brain that actually works', status: 'content-scheduled', channel: 'channel-video', publish: localDate(12), owner: 'You' }, 2),
    row(ctx, { title: 'October field notes', status: 'content-published', channel: 'channel-social', publish: localDate(-3), owner: 'You' }, 3),
  ];
  return table(ctx, properties, rows, [
    { id: ctx.id(), name: 'Calendar', type: 'calendar', datePropertyId: 'publish' },
    { id: ctx.id(), name: 'Gallery', type: 'gallery' },
  ]);
}

function okrDatabase(ctx: BuildContext): PageDatabase {
  const properties: DatabaseProperty[] = [
    { id: 'title', name: 'Objective', type: 'title' },
    { id: 'owner', name: 'Owner', type: 'text' },
    {
      id: 'quarter',
      name: 'Quarter',
      type: 'select',
      options: [option('q-now', 'This quarter', 'violet'), option('q-next', 'Next quarter', 'sky')],
    },
    { id: 'progress', name: 'Progress', type: 'number' },
    {
      id: 'status',
      name: 'Health',
      type: 'status',
      options: [option('okr-track', 'On track', 'green'), option('okr-risk', 'At risk', 'amber'), option('okr-off', 'Off track', 'red'), option('okr-done', 'Done', 'sky')],
    },
    { id: 'keyresults', name: 'Key results', type: 'text' },
  ];
  const rows = [
    row(ctx, { title: 'Make Infinite OS feel instant every day', owner: 'You', quarter: 'q-now', progress: 62, status: 'okr-track', keyresults: 'Cold start under 2s; agent first token under 1s; zero broken primary actions' }, 0),
    row(ctx, { title: 'Turn Pages into the home for all thinking', owner: 'You', quarter: 'q-now', progress: 45, status: 'okr-risk', keyresults: 'Weekly active use; 80% of new notes created in Pages' }, 1),
    row(ctx, { title: 'Ship one deeply useful release per month', owner: 'You', quarter: 'q-now', progress: 80, status: 'okr-track', keyresults: 'Release notes written; artifacts rebuilt; user-visible polish' }, 2),
  ];
  return table(ctx, properties, rows, [{ id: ctx.id(), name: 'List', type: 'list' }]);
}

function readingDatabase(ctx: BuildContext): PageDatabase {
  const properties: DatabaseProperty[] = [
    { id: 'title', name: 'Book', type: 'title' },
    { id: 'author', name: 'Author', type: 'text' },
    {
      id: 'status',
      name: 'Status',
      type: 'status',
      options: [option('book-next', 'To read', 'zinc'), option('book-reading', 'Reading', 'sky'), option('book-done', 'Finished', 'green')],
    },
    { id: 'rating', name: 'Rating', type: 'number' },
    { id: 'finished', name: 'Finished', type: 'date' },
    { id: 'takeaways', name: 'Takeaways', type: 'text' },
  ];
  const rows = [
    row(ctx, { title: 'The Creative Act', author: 'Rick Rubin', status: 'book-reading', rating: 5, takeaways: 'Attention is the practice.' }, 0),
    row(ctx, { title: 'Thinking in Systems', author: 'Donella Meadows', status: 'book-done', rating: 5, finished: localDate(-20), takeaways: 'Stocks, flows, and leverage points.' }, 1),
    row(ctx, { title: 'The Art of Doing Science and Engineering', author: 'Richard Hamming', status: 'book-next', rating: 0 }, 2),
  ];
  return table(ctx, properties, rows, [
    { id: ctx.id(), name: 'Gallery', type: 'gallery' },
    { id: ctx.id(), name: 'Finished', type: 'calendar', datePropertyId: 'finished' },
  ]);
}

function habitDatabase(ctx: BuildContext): PageDatabase {
  const properties: DatabaseProperty[] = [
    { id: 'title', name: 'Habit', type: 'title' },
    { id: 'cadence', name: 'Cadence', type: 'select', options: [option('habit-daily', 'Daily', 'emerald'), option('habit-weekly', 'Weekly', 'sky')] },
    { id: 'streak', name: 'Streak', type: 'number' },
    { id: 'done', name: 'Done today', type: 'checkbox' },
    { id: 'notes', name: 'Notes', type: 'text' },
  ];
  const rows = [
    row(ctx, { title: 'Write for 30 minutes', cadence: 'habit-daily', streak: 12, done: true }, 0),
    row(ctx, { title: 'Walk outside', cadence: 'habit-daily', streak: 24, done: false }, 1),
    row(ctx, { title: 'Weekly review', cadence: 'habit-weekly', streak: 6, done: false }, 2),
  ];
  return table(ctx, properties, rows);
}

function pageSeed(
  ctx: BuildContext,
  parentId: string | null,
  title: string,
  icon: string,
  blocks: PageBlock[],
  cover: PageCover | null = null,
  order = 0,
  kind: PageKind = 'page',
  database?: PageDatabase,
): TemplateSeed {
  return { id: ctx.id(), parentId, kind, title, icon, cover, blocks, database, order };
}

export function buildTemplate(
  templateId: PageTemplateId,
  parentId: string | null,
  idFactory: IdFactory,
  now = Date.now(),
): TemplateResult | null {
  const ctx: BuildContext = { id: idFactory, now };

  if (templateId === 'blank') {
    const page = pageSeed(ctx, parentId, 'Untitled', '📄', [block(ctx, 'paragraph')]);
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'meeting') {
    const page = pageSeed(
      ctx,
      parentId,
      'Meeting notes',
      '🗓️',
      [
        block(ctx, 'callout', '<strong>Meeting:</strong> &nbsp; <strong>Attendees:</strong> &nbsp; <strong>Date:</strong>', { icon: '🗓️', tone: 'sky' }),
        block(ctx, 'heading2', 'Agenda'),
        block(ctx, 'bulleted', 'Context and goal'),
        block(ctx, 'bulleted', 'Open questions'),
        block(ctx, 'bulleted', 'Decisions needed'),
        block(ctx, 'heading2', 'Notes'),
        block(ctx, 'paragraph', ''),
        block(ctx, 'heading2', 'Decisions'),
        block(ctx, 'bulleted', ''),
        block(ctx, 'heading2', 'Action items'),
        todo(ctx, 'Owner — action — due date'),
      ],
      { type: 'gradient', value: 'linear-gradient(120deg, #082f49 0%, #0e7490 55%, #67e8f9 100%)' },
    );
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'weekly') {
    const page = pageSeed(
      ctx,
      parentId,
      'Weekly review',
      '🧭',
      [
        block(ctx, 'callout', 'A 15-minute reset. Keep it honest, short, and specific.', { icon: '🧭', tone: 'emerald' }),
        block(ctx, 'heading2', 'What moved'),
        block(ctx, 'bulleted', ''),
        block(ctx, 'heading2', 'What stalled'),
        block(ctx, 'bulleted', ''),
        block(ctx, 'heading2', 'What I learned'),
        block(ctx, 'paragraph', ''),
        block(ctx, 'heading2', 'Next week'),
        todo(ctx, 'One meaningful outcome'),
        todo(ctx, 'One thing to protect'),
        todo(ctx, 'One thing to drop'),
      ],
      { type: 'gradient', value: 'linear-gradient(120deg, #052e16 0%, #15803d 55%, #bef264 100%)' },
    );
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'wiki') {
    const page = pageSeed(
      ctx,
      parentId,
      'Team wiki',
      '🏛️',
      [
        block(ctx, 'callout', 'This is the front door. Keep answers findable and links short.', { icon: '🏛️', tone: 'amber' }),
        block(ctx, 'heading2', 'Start here'),
        block(ctx, 'bulleted', 'How we work'),
        block(ctx, 'bulleted', 'Who does what'),
        block(ctx, 'bulleted', 'Current priorities'),
        block(ctx, 'heading2', 'How we work'),
        block(ctx, 'paragraph', 'Write down decisions where the work happens. Prefer a short page over a long thread. Link the source, not a screenshot.'),
        block(ctx, 'heading2', 'Current priorities'),
        block(ctx, 'numbered', 'Ship the most important thing'),
        block(ctx, 'numbered', 'Keep the core paths fast and reliable'),
        block(ctx, 'numbered', 'Leave the workspace cleaner than you found it'),
        block(ctx, 'heading2', 'Useful pages'),
        block(ctx, 'paragraph', 'Use [[Project plan]] and [[Meeting notes]] as starting points.'),
      ],
      { type: 'gradient', value: 'linear-gradient(120deg, #1c1917 0%, #78350f 55%, #fbbf24 100%)' },
    );
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'project') {
    const dbId = ctx.id();
    const root = pageSeed(
      ctx,
      parentId,
      'Project plan',
      '🚀',
      [
        block(ctx, 'callout', '<strong>Outcome:</strong> What does done look like? &nbsp; <strong>Owner:</strong> You &nbsp; <strong>Deadline:</strong> —', { icon: '🚀', tone: 'violet' }),
        block(ctx, 'heading2', 'Overview'),
        block(ctx, 'paragraph', 'Describe the problem, the people affected, and the smallest version worth shipping.'),
        block(ctx, 'heading2', 'Milestones'),
        todo(ctx, 'Scope locked'),
        todo(ctx, 'First version shipped'),
        todo(ctx, 'Feedback collected'),
        block(ctx, 'heading2', 'Tasks'),
        block(ctx, 'child_database', '', { pageId: dbId }),
      ],
      { type: 'gradient', value: 'linear-gradient(120deg, #1e1b4b 0%, #6d28d9 55%, #e879f9 100%)' },
    );
    const database = pageSeed(
      ctx,
      root.id,
      'Tasks',
      '✅',
      [block(ctx, 'paragraph', 'Every task here is a row. Open a row to write notes without leaving the project.')],
      null,
      0,
      'database',
      taskDatabase(ctx),
    );
    return { rootId: root.id, seeds: [root, database] };
  }

  if (templateId === 'task') {
    const page = pageSeed(ctx, parentId, 'Task tracker', '✅', [block(ctx, 'paragraph', '')], { type: 'gradient', value: 'linear-gradient(120deg, #052e16 0%, #047857 55%, #6ee7b7 100%)' }, 0, 'database', taskDatabase(ctx));
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'crm') {
    const page = pageSeed(ctx, parentId, 'CRM', '🤝', [block(ctx, 'paragraph', '')], { type: 'gradient', value: 'linear-gradient(120deg, #3f1d2b 0%, #be123c 55%, #fda4af 100%)' }, 0, 'database', crmDatabase(ctx));
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'content') {
    const page = pageSeed(ctx, parentId, 'Content calendar', '📣', [block(ctx, 'paragraph', '')], { type: 'gradient', value: 'linear-gradient(120deg, #431407 0%, #c2410c 55%, #fcd34d 100%)' }, 0, 'database', contentDatabase(ctx));
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'okr') {
    const page = pageSeed(ctx, parentId, 'OKRs', '🎯', [block(ctx, 'paragraph', '')], { type: 'gradient', value: 'linear-gradient(120deg, #2e1065 0%, #7c3aed 55%, #c4b5fd 100%)' }, 0, 'database', okrDatabase(ctx));
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'reading') {
    const page = pageSeed(ctx, parentId, 'Reading list', '📚', [block(ctx, 'paragraph', '')], { type: 'gradient', value: 'linear-gradient(120deg, #0c4a6e 0%, #0284c7 55%, #7dd3fc 100%)' }, 0, 'database', readingDatabase(ctx));
    return { rootId: page.id, seeds: [page] };
  }

  if (templateId === 'habit') {
    const page = pageSeed(ctx, parentId, 'Habit tracker', '🌱', [block(ctx, 'paragraph', '')], { type: 'gradient', value: 'linear-gradient(120deg, #14532d 0%, #16a34a 55%, #bbf7d0 100%)' }, 0, 'database', habitDatabase(ctx));
    return { rootId: page.id, seeds: [page] };
  }

  return null;
}
