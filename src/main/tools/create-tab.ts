// CreateTab Tool — lets the AI create dynamic sidebar tabs with rich content
import type { Tool, ToolContext, ToolResult } from './base.js';

interface CreateTabArgs {
  title: string;
  kind: string;
  prompt: string;
  content?: string;
  icon?: string;
  color?: string;
  sections?: { title: string; content: string; type?: string; data?: Record<string, unknown> }[];
  metrics?: { label: string; value: string | number; change?: string }[];
  chartData?: { labels: string[]; datasets: { label: string; data: number[]; color?: string }[]; chartType?: string };
  tableData?: { columns: { header: string; key: string }[]; rows: Record<string, unknown>[] };
  htmlContent?: string;
  filePath?: string;
}

const VALID_KINDS = [
  'chart', 'document', 'video', 'invoice', 'data', 'dashboard', 'financial',
  'business', 'quiz', 'summary', 'research', 'lesson', 'code', 'feature',
  'custom', 'workspace',
];

const KIND_ICONS: Record<string, string> = {
  chart: '📊', document: '📄', video: '🎬', invoice: '💰', data: '📈',
  dashboard: '🖥️', financial: '💹', business: '🏢', quiz: '🧠',
  summary: '📋', research: '🔬', lesson: '📚', code: '💻', feature: '⚡',
  custom: '✨', workspace: '🛠️',
};

export const createTabTool: Tool = {
  name: 'CreateTab',
  description:
    'Create a new dynamic tab in the sidebar with rich content. Use this when you need to show the user something visual — charts, financial dashboards, invoices, data tables, video players, documents, or any custom content. The tab appears in the left sidebar and persists across sessions. Supports: chart, document, video, invoice, data, dashboard, financial, business, quiz, summary, research, lesson, code, feature, custom, workspace.',
  permission: 'allow',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Tab title (max 40 chars)' },
      kind: {
        type: 'string',
        enum: VALID_KINDS,
        description: 'Tab kind — determines icon and default actions',
      },
      prompt: { type: 'string', description: 'The original request that created this tab' },
      content: { type: 'string', description: 'Plain text content (fallback if no sections/metrics/chart)' },
      icon: { type: 'string', description: 'Custom emoji icon' },
      color: { type: 'string', description: 'Custom accent color (hex)' },
      sections: {
        type: 'array',
        description: 'Rich content sections',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            type: { type: 'string', enum: ['text', 'chart', 'table', 'list', 'code', 'metrics', 'image', 'embed'] },
            data: { type: 'object' },
          },
        },
      },
      metrics: {
        type: 'array',
        description: 'Key metric cards to display',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            value: { type: ['string', 'number'] },
            change: { type: 'string' },
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
      htmlContent: { type: 'string', description: 'Custom HTML content' },
      filePath: { type: 'string', description: 'Path to a generated file (PDF, Excel, etc.)' },
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
    };

    return {
      content: JSON.stringify({
        action: 'create_tab',
        tab: tabPayload,
        message: `Tab "${a.title}" (${a.kind}) created. It now appears in the sidebar.`,
      }),
    };
  },
};
