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
    'YOUR CREATIVE CANVAS — build ANYTHING as a persistent sidebar tab.',
    'This is your most powerful user-facing tool. Use it to create rich, interactive experiences that live in the left sidebar under "Tabs".',
    '',
    'WHAT YOU CAN CREATE (non-exhaustive):',
    '- Websites: embed any URL via iframe (kind=website, htmlContent=url)',
    '- Images: display generated or linked images (kind=image, sections with type=image)',
    '- Videos: embed video players (kind=video, sections with type=video)',
    '- Quizzes: interactive quizzes with scoring (kind=quiz)',
    '- Charts & Graphs: bar, line, pie, doughnut with real data (kind=chart, chartData)',
    '- Dashboards: multi-metric dashboards with KPI cards (kind=dashboard, metrics)',
    '- Data Tables: sortable tables with columns and rows (kind=data, tableData)',
    '- Documents: rich text documents with sections (kind=document)',
    '- Schedules & Calendars: weekly/monthly planners (kind=schedule)',
    '- Trackers: subscriptions, expenses, habits, goals (kind=tracker)',
    '- Portfolios: project showcases, galleries (kind=portfolio)',
    '- Comparisons: side-by-side feature/price/product comparisons (kind=comparison)',
    '- Calculators: interactive tools with formulas (kind=calculator, htmlContent with JS)',
    '- Presentations: slide-like content with sections (kind=presentation)',
    '- Mind Maps: visual concept maps (kind=mindmap)',
    '- Checklists: task lists with checkboxes (kind=checklist)',
    '- Timelines: chronological event visualizations (kind=timeline)',
    '- Kanban Boards: project management boards (kind=kanban)',
    '- Invoices: professional invoices with line items (kind=invoice)',
    '- Financial Analysis: budgets, forecasts, reports (kind=financial)',
    '- Business Plans: market analysis, strategy docs (kind=business)',
    '- Code Workspaces: code snippets, documentation (kind=code)',
    '- Research Reports: sourced analysis with citations (kind=research)',
    '- Lessons & Tutorials: structured learning content (kind=lesson)',
    '- Summaries: condensed content summaries (kind=summary)',
    '- Custom HTML: any HTML/CSS/JS via htmlContent (kind=custom)',
    '',
    'WHEN TO USE THIS:',
    '- User asks to visualize, track, plan, compare, calculate, or see anything visually',
    '- User wants a website, image, video, or embedded content shown to them',
    '- User asks for a chart, graph, dashboard, or data visualization',
    '- User needs a schedule, tracker, planner, or organizer',
    '- You create something useful and want to present it as a persistent workspace',
    '- Any time a dedicated visual workspace would help the user',
    '',
    'CONTENT OPTIONS (use what fits best):',
    '- htmlContent: raw HTML/CSS/JS for maximum flexibility (iframes, embeds, custom UI)',
    '- sections: structured content blocks (text, code, lists, charts, tables, images, embeds, videos, metrics)',
    '- chartData: chart configuration with labels, datasets, and type',
    '- tableData: columns + rows for tabular data',
    '- metrics: KPI cards with labels, values, and change indicators',
    '- filePath: reference to a generated file (PDF, image, etc.)',
    '- actions: custom action buttons that send prompts back to chat',
    '',
    'KIND determines the icon. Be creative — you are not limited to the obvious.',
    'The tab appears in the left sidebar under "Tabs" and persists across sessions.',
    '',
    'CRITICAL RULES:',
    '- Do NOT add custom backgrounds, gradients, or color schemes to htmlContent. Use Infinite OS default dark theme.',
    '- Do NOT use inline styles for backgrounds (background, background-color, background-image, gradient).',
    '- Content must be functional and interactive — not just visual placeholders.',
    '- Always use the tab kind that best matches the content. Charts use chartData, tables use tableData, etc.',
    '- Do not create a colorful wrapper — just create the content the user asked for.',
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
