// CreateTab Tool — the AI's creative canvas: build ANYTHING as a sidebar tab
import type { Tool, ToolContext, ToolResult } from './base.js';

interface CreateTabArgs {
  title: string;
  kind: string;
  prompt: string;
  content?: string;
  icon?: string;
  color?: string;
  sections?: { title: string; content: string; type?: string; data?: Record<string, unknown>; htmlContent?: string }[];
  metrics?: { label: string; value: string | number; change?: string; color?: string }[];
  chartData?: { labels: string[]; datasets: { label: string; data: number[]; color?: string }[]; chartType?: string };
  tableData?: { columns: { header: string; key: string }[]; rows: Record<string, unknown>[] };
  htmlContent?: string;
  filePath?: string;
  actions?: { label: string; prompt: string }[];
  metadata?: Record<string, unknown>;
}

const VALID_KINDS = [
  'chart', 'document', 'video', 'invoice', 'data', 'dashboard', 'financial',
  'business', 'quiz', 'summary', 'research', 'lesson', 'code', 'feature',
  'custom', 'workspace', 'website', 'image', 'embed', 'media',
  'schedule', 'tracker', 'portfolio', 'comparison', 'calculator',
  'presentation', 'mindmap', 'checklist', 'timeline', 'kanban',
];

const KIND_ICONS: Record<string, string> = {
  chart: '📊', document: '📄', video: '🎬', invoice: '💰', data: '📈',
  dashboard: '🖥️', financial: '💹', business: '🏢', quiz: '🧠',
  summary: '📋', research: '🔬', lesson: '📚', code: '💻', feature: '⚡',
  custom: '✨', workspace: '🛠️', website: '🌐', image: '🖼️', embed: '🔗', media: '🎞️',
  schedule: '📅', tracker: '📍', portfolio: '💼', comparison: '⚖️', calculator: '🧮',
  presentation: '🎯', mindmap: '🗺️', checklist: '✅', timeline: '⏳', kanban: '📋',
};

export const createTabTool: Tool = {
  name: 'CreateTab',
  description: [
    'YOUR CREATIVE CANVAS — build ANYTHING as a persistent sidebar tab under "Tabs" (websites, images, video, quizzes, charts, dashboards, tables, documents, schedules, trackers, portfolios, comparisons, calculators, presentations, mindmaps, checklists, timelines, kanban, invoices, reports, lessons, summaries, custom HTML).',
    'Use when the user asks to visualize, track, plan, compare, calculate, or see anything visually — or when a dedicated visual workspace helps.',
    'CONTENT: htmlContent (raw HTML/CSS/JS, max flexibility) | sections (text/code/lists/charts/tables/images/embeds/videos/metrics) | chartData (labels+datasets+type) | tableData (columns+rows) | metrics (KPI cards) | filePath (generated file ref) | actions (buttons that send prompts to chat).',
    'RULES: no custom backgrounds/gradients/inline background styles — use the Infinite OS dark theme. Content must be functional and interactive. Match kind to content (charts→chartData, tables→tableData).',
  ].join(' '),
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tab title (max 40 chars)' },
      kind: {
        type: 'string',
        enum: VALID_KINDS,
        description: 'Tab kind — determines icon and default presentation',
      },
      prompt: { type: 'string', description: 'The original user request or purpose of this tab' },
      content: { type: 'string', description: 'Plain text content (fallback if no sections/htmlContent)' },
      icon: { type: 'string', description: 'Custom emoji icon override' },
      color: { type: 'string', description: 'Custom accent color (hex, e.g. #8b5cf6)' },
      sections: {
        type: 'array',
        description: 'Structured content blocks',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string', enum: ['text', 'chart', 'table', 'list', 'code', 'metrics', 'image', 'embed', 'video', 'media', 'website', 'html'] },
            data: { type: 'object' },
            htmlContent: { type: 'string', description: 'Custom HTML for this section (use with type=html)' },
          },
        },
      },
      metrics: {
        type: 'array',
        description: 'Key metric cards (KPIs)',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: ['string', 'number'] },
            change: { type: 'string' },
            color: { type: 'string' },
          },
        },
      },
      chartData: {
        type: 'object',
        description: 'Chart configuration',
        properties: {
          labels: { type: 'array', items: { type: 'string' } },
          datasets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                data: { type: 'array', items: { type: 'number' } },
                color: { type: 'string' },
              },
            },
          },
          chartType: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut'] },
        },
      },
      tableData: {
        type: 'object',
        description: 'Table data',
        properties: {
          columns: { type: 'array', items: { type: 'object', properties: { header: { type: 'string' }, key: { type: 'string' } } } },
          rows: { type: 'array', items: { type: 'object' } },
        },
      },
      htmlContent: { type: 'string', description: 'Full custom HTML content for the tab (iframes, embeds, custom UI)' },
      filePath: { type: 'string', description: 'Path to a generated file' },
      actions: {
        type: 'array',
        description: 'Custom action buttons (label + prompt to send to chat)',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            prompt: { type: 'string' },
          },
        },
      },
      metadata: { type: 'object', description: 'Extra metadata for the tab' },
    },
    required: ['title', 'kind', 'prompt'],
  },

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as CreateTabArgs;

    if (!a.title) return { content: 'Title is required', is_error: true };
    if (!a.kind) return { content: 'Kind is required', is_error: true };
    if (!VALID_KINDS.includes(a.kind)) {
      return { content: `Invalid kind: ${a.kind}. Valid kinds: ${VALID_KINDS.join(', ')}`, is_error: true };
    }

    const icon = a.icon || KIND_ICONS[a.kind] || '✨';

    const tabPayload = {
      title: a.title,
      kind: a.kind,
      prompt: a.prompt,
      content: a.content,
      icon,
      color: a.color,
      sections: a.sections,
      metrics: a.metrics,
      chartData: a.chartData,
      tableData: a.tableData,
      htmlContent: a.htmlContent,
      filePath: a.filePath,
      actions: a.actions,
      metadata: a.metadata,
    };

    return {
      content: JSON.stringify({
        action: 'create_tab',
        tab: tabPayload,
        message: `Tab "${a.title}" (${a.kind}) created. It now appears in the sidebar under "Tabs".`,
      }),
    };
  },
};
