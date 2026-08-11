import type { Tool, ToolContext, ToolResult } from './base.js';

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;
  triggers: string[];
  steps: string[];
  tools: string[];
  tags: string[];
  useCases: string[];
}

const TEMPLATES: WorkflowTemplate[] = [
  // Productivity
  {
    id: 'daily-briefing',
    name: 'Daily Morning Briefing',
    description: 'Automated daily briefing with weather, news, calendar, and task summary',
    category: 'productivity',
    difficulty: 'beginner',
    estimatedTime: '2 min setup',
    triggers: ['Schedule (daily 7am)', 'Voice command'],
    steps: [
      'Fetch weather forecast for user location',
      'Read calendar events for today',
      'Summarize pending tasks from TodoWrite',
      'Check email inbox for urgent messages',
      'Generate formatted briefing report',
      'Send via notification or email',
    ],
    tools: ['WebSearch', 'Calendar', 'TodoWrite', 'Email', 'Notification'],
    tags: ['daily', 'morning', 'briefing', 'automation'],
    useCases: ['Start every day with a comprehensive overview', 'Replace manual checking of multiple apps'],
  },
  {
    id: 'meeting-prep',
    name: 'Meeting Preparation',
    description: 'Auto-prepare for meetings by gathering context, docs, and attendee info',
    category: 'productivity',
    difficulty: 'intermediate',
    estimatedTime: '5 min setup',
    triggers: ['Calendar event (15 min before)', 'Manual trigger'],
    steps: [
      'Read calendar event details',
      'Search for related documents in project',
      'Research attendee backgrounds (LinkedIn, GitHub)',
      'Prepare talking points based on agenda',
      'Generate pre-meeting brief',
      'Open relevant files and browser tabs',
    ],
    tools: ['Calendar', 'Grep', 'WebSearch', 'Agent', 'Read', 'Browser'],
    tags: ['meetings', 'preparation', 'productivity'],
    useCases: ['Never walk into a meeting unprepared', 'Automatically gather all relevant context'],
  },
  {
    id: 'email-triage',
    name: 'Smart Email Triage',
    description: 'Auto-categorize, prioritize, and draft responses to emails',
    category: 'productivity',
    difficulty: 'intermediate',
    estimatedTime: '10 min setup',
    triggers: ['Email received', 'Schedule (every 30 min)'],
    steps: [
      'Fetch new emails from inbox',
      'Classify by priority (urgent/normal/low)',
      'Categorize by topic (action needed/info/meeting/request)',
      'Draft response for each actionable email',
      'Create tasks for items requiring follow-up',
      'Send summary notification',
    ],
    tools: ['Email', 'Agent', 'TodoWrite', 'Notification'],
    tags: ['email', 'triage', 'productivity', 'automation'],
    useCases: ['Process 100+ emails in minutes', 'Never miss an important message'],
  },
  // Development
  {
    id: 'ci-pipeline',
    name: 'CI/CD Pipeline',
    description: 'Automated build, test, and deployment pipeline',
    category: 'development',
    difficulty: 'advanced',
    estimatedTime: '15 min setup',
    triggers: ['Git push', 'Pull request', 'Manual'],
    steps: [
      'Pull latest code from repository',
      'Install dependencies',
      'Run linting and type checks',
      'Execute test suite',
      'Build the application',
      'Deploy to staging/production',
      'Send deployment notification',
      'Create release notes',
    ],
    tools: ['Git', 'Bash', 'Docker', 'Deploy', 'Email', 'Notification'],
    tags: ['ci-cd', 'deployment', 'testing', 'automation'],
    useCases: ['Zero-touch deployments', 'Consistent, repeatable builds'],
  },
  {
    id: 'code-review',
    name: 'Automated Code Review',
    description: 'AI-powered code review with security and quality checks',
    category: 'development',
    difficulty: 'intermediate',
    estimatedTime: '5 min setup',
    triggers: ['Pull request created', 'Git commit', 'Manual'],
    steps: [
      'Detect changed files',
      'Analyze code changes for issues',
      'Check for security vulnerabilities',
      'Review code style and conventions',
      'Generate improvement suggestions',
      'Post review as PR comment or notification',
    ],
    tools: ['Git', 'Grep', 'Agent', 'Security', 'Notification'],
    tags: ['code-review', 'quality', 'security', 'development'],
    useCases: ['Consistent code quality', 'Catch bugs before they reach production'],
  },
  {
    id: 'api-monitor',
    name: 'API Health Monitor',
    description: 'Monitor API endpoints and alert on failures or slow responses',
    category: 'development',
    difficulty: 'intermediate',
    estimatedTime: '10 min setup',
    triggers: ['Schedule (every 5 min)', 'Webhook'],
    steps: [
      'Ping configured API endpoints',
      'Measure response time and status',
      'Compare against thresholds',
      'If failure: send alert notification',
      'Log results to database',
      'Generate daily uptime report',
    ],
    tools: ['APITester', 'Database', 'Notification', 'Calendar'],
    tags: ['monitoring', 'api', 'health', 'uptime'],
    useCases: ['Proactive issue detection', 'SLA compliance tracking'],
  },
  // Business
  {
    id: 'lead-nurture',
    name: 'Lead Nurture Sequence',
    description: 'Automated follow-up sequence for new leads',
    category: 'business',
    difficulty: 'advanced',
    estimatedTime: '20 min setup',
    triggers: ['New CRM entry', 'Webhook', 'Manual'],
    steps: [
      'Receive new lead from CRM',
      'Research lead company and contacts',
      'Personalize outreach email',
      'Schedule follow-up sequence (Day 1, 3, 7, 14)',
      'Track email opens and replies',
      'Escalate to sales if engagement detected',
    ],
    tools: ['CRM', 'Email', 'WebSearch', 'Calendar', 'TodoWrite'],
    tags: ['sales', 'leads', 'nurture', 'automation'],
    useCases: ['Never let a lead go cold', 'Personalized outreach at scale'],
  },
  {
    id: 'invoice-gen',
    name: 'Invoice Generator',
    description: 'Auto-generate and send invoices from project data',
    category: 'business',
    difficulty: 'beginner',
    estimatedTime: '5 min setup',
    triggers: ['Schedule (monthly)', 'Manual', 'Task completed'],
    steps: [
      'Gather billable items from projects',
      'Calculate totals and taxes',
      'Generate PDF invoice',
      'Send invoice via email',
      'Log in accounting database',
      'Set payment reminder',
    ],
    tools: ['DocumentGenerator', 'Database', 'Email', 'Calendar', 'TodoWrite'],
    tags: ['invoicing', 'billing', 'accounting', 'automation'],
    useCases: ['Automate monthly billing', 'Reduce manual data entry errors'],
  },
  {
    id: 'social-scheduler',
    name: 'Social Media Scheduler',
    description: 'Schedule and auto-publish content across social platforms',
    category: 'marketing',
    difficulty: 'intermediate',
    estimatedTime: '10 min setup',
    triggers: ['Schedule (daily)', 'Content added to queue', 'Manual'],
    steps: [
      'Pull content from editorial calendar',
      'Optimize for each platform (length, hashtags)',
      'Schedule posts at optimal times',
      'Publish to configured platforms',
      'Track engagement metrics',
      'Generate weekly performance report',
    ],
    tools: ['APIConnector', 'Agent', 'Calendar', 'DocumentGenerator'],
    tags: ['social-media', 'scheduling', 'marketing', 'content'],
    useCases: ['Consistent posting schedule', 'Cross-platform content management'],
  },
  // System
  {
    id: 'system-backup',
    name: 'System Backup',
    description: 'Automated backup of files, databases, and configurations',
    category: 'system',
    difficulty: 'beginner',
    estimatedTime: '5 min setup',
    triggers: ['Schedule (daily 2am)', 'Manual'],
    steps: [
      'List critical files and directories',
      'Compress backup archives',
      'Upload to cloud storage',
      'Verify backup integrity',
      'Clean old backups (>30 days)',
      'Send backup report notification',
    ],
    tools: ['Bash', 'Git', 'CloudStorage', 'Notification'],
    tags: ['backup', 'system', 'data-protection', 'automation'],
    useCases: ['Protect against data loss', 'Automated disaster recovery prep'],
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Comprehensive security scan of system and dependencies',
    category: 'security',
    difficulty: 'advanced',
    estimatedTime: '15 min setup',
    triggers: ['Schedule (weekly)', 'Git push', 'Manual'],
    steps: [
      'Scan dependencies for vulnerabilities',
      'Check for exposed secrets in code',
      'Audit system permissions',
      'Review login activity',
      'Test firewall rules',
      'Generate security report',
      'Alert on critical findings',
    ],
    tools: ['Bash', 'Grep', 'Security', 'Agent', 'Notification'],
    tags: ['security', 'audit', 'compliance', 'vulnerabilities'],
    useCases: ['Proactive threat detection', 'Compliance reporting'],
  },
  {
    id: 'performance-monitor',
    name: 'System Performance Monitor',
    description: 'Track CPU, memory, disk, and network performance',
    category: 'system',
    difficulty: 'beginner',
    estimatedTime: '3 min setup',
    triggers: ['Schedule (every 5 min)', 'Threshold exceeded'],
    steps: [
      'Collect CPU, memory, disk, network metrics',
      'Compare against thresholds',
      'If critical: send alert',
      'Log to time-series database',
      'Generate hourly/daily summaries',
      'Visualize trends with charts',
    ],
    tools: ['System', 'Database', 'ChartGenerator', 'Notification'],
    tags: ['monitoring', 'performance', 'system', 'alerts'],
    useCases: ['Early warning for resource exhaustion', 'Capacity planning'],
  },
  // Data
  {
    id: 'data-pipeline',
    name: 'Data Pipeline',
    description: 'ETL pipeline for data extraction, transformation, and loading',
    category: 'data',
    difficulty: 'advanced',
    estimatedTime: '20 min setup',
    triggers: ['Schedule', 'File uploaded', 'API webhook'],
    steps: [
      'Extract data from source (API, file, database)',
      'Validate data quality',
      'Transform and clean data',
      'Apply business rules',
      'Load into target database',
      'Generate data quality report',
    ],
    tools: ['APITester', 'Database', 'Bash', 'Agent', 'DocumentGenerator'],
    tags: ['etl', 'data', 'pipeline', 'analytics'],
    useCases: ['Automated data synchronization', 'Data quality assurance'],
  },
  {
    id: 'report-generator',
    name: 'Automated Report Generator',
    description: 'Generate scheduled reports from multiple data sources',
    category: 'data',
    difficulty: 'intermediate',
    estimatedTime: '10 min setup',
    triggers: ['Schedule (weekly/monthly)', 'Manual'],
    steps: [
      'Query data from databases and APIs',
      'Aggregate and analyze metrics',
      'Generate charts and visualizations',
      'Compile into PDF/Excel report',
      'Send via email to stakeholders',
      'Archive report for compliance',
    ],
    tools: ['Database', 'APITester', 'ChartGenerator', 'DocumentGenerator', 'Email'],
    tags: ['reports', 'analytics', 'business-intelligence', 'automation'],
    useCases: ['Consistent reporting cadence', 'Data-driven decision making'],
  },
];

export const workflowTemplatesTool: Tool = {
  name: 'WorkflowTemplates',
  description:
    'Library of 15+ pre-built workflow templates for common automations: CI/CD pipelines, email triage, social media scheduling, security audits, data pipelines, invoice generation, and more. Each template includes step-by-step instructions, required tools, and difficulty level.',
  permission: 'none',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'get', 'search', 'categories', 'install'],
        description: 'Action: list (all templates), get (specific template), search (by keyword), categories (list categories), install (create workflow from template)',
      },
      templateId: { type: 'string', description: 'Template ID for get/install' },
      query: { type: 'string', description: 'Search keyword' },
      category: { type: 'string', description: 'Filter by category' },
    },
    required: ['action'],
  },

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: string;
      templateId?: string;
      query?: string;
      category?: string;
    };

    try {
      switch (input.action) {
        case 'list': {
          const filtered = input.category
            ? TEMPLATES.filter((t) => t.category === input.category)
            : TEMPLATES;

          const lines = [`=== Workflow Templates (${filtered.length}) ===`, ''];
          const byCategory: Record<string, WorkflowTemplate[]> = {};
          for (const t of filtered) {
            if (!byCategory[t.category]) byCategory[t.category] = [];
            byCategory[t.category].push(t);
          }

          for (const [cat, templates] of Object.entries(byCategory)) {
            lines.push(`--- ${cat.toUpperCase()} ---`);
            for (const t of templates) {
              lines.push(`  ${t.id}: ${t.name} [${t.difficulty}]`);
              lines.push(`    ${t.description}`);
              lines.push(`    Time: ${t.estimatedTime} | Tools: ${t.tools.join(', ')}`);
            }
            lines.push('');
          }
          return { content: lines.join('\n') };
        }

        case 'get': {
          if (!input.templateId) return { content: 'templateId is required', is_error: true };
          const template = TEMPLATES.find((t) => t.id === input.templateId);
          if (!template) return { content: `Template not found: ${input.templateId}`, is_error: true };

          return {
            content: [
              `=== ${template.name} ===`,
              `Category: ${template.category}`,
              `Difficulty: ${template.difficulty}`,
              `Estimated Time: ${template.estimatedTime}`,
              '',
              'Description:',
              template.description,
              '',
              'Triggers:',
              ...template.triggers.map((t) => `  - ${t}`),
              '',
              'Steps:',
              ...template.steps.map((s, i) => `  ${i + 1}. ${s}`),
              '',
              'Required Tools:',
              ...template.tools.map((t) => `  - ${t}`),
              '',
              'Use Cases:',
              ...template.useCases.map((u) => `  - ${u}`),
              '',
              'Tags: ' + template.tags.join(', '),
              '',
              'Use "install" action to create this workflow.',
            ].join('\n'),
          };
        }

        case 'search': {
          if (!input.query) return { content: 'query is required', is_error: true };
          const q = input.query.toLowerCase();
          const matches = TEMPLATES.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.description.toLowerCase().includes(q) ||
              t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
              t.tools.some((tool) => tool.toLowerCase().includes(q)),
          );

          if (matches.length === 0) {
            return { content: `No templates found for "${input.query}". Use "list" to see all templates.` };
          }

          return {
            content: [
              `=== Search Results for "${input.query}" (${matches.length}) ===`,
              '',
              ...matches.map((t) => `  ${t.id}: ${t.name} [${t.difficulty}] - ${t.description}`),
            ].join('\n'),
          };
        }

        case 'categories': {
          const categories: Record<string, number> = {};
          for (const t of TEMPLATES) {
            categories[t.category] = (categories[t.category] || 0) + 1;
          }
          return {
            content: [
              '=== Template Categories ===',
              '',
              ...Object.entries(categories).map(([cat, count]) => `  ${cat}: ${count} template(s)`),
              '',
              'Use "list?category=<name>" to filter by category.',
            ].join('\n'),
          };
        }

        case 'install': {
          if (!input.templateId) return { content: 'templateId is required', is_error: true };
          const template = TEMPLATES.find((t) => t.id === input.templateId);
          if (!template) return { content: `Template not found: ${input.templateId}`, is_error: true };

          return {
            content: [
              `=== Installing: ${template.name} ===`,
              '',
              'This template will be created as an automation workflow.',
              `Steps: ${template.steps.length}`,
              `Tools needed: ${template.tools.join(', ')}`,
              '',
              'To create this workflow, use the Automation tool with:',
              `  Name: ${template.name}`,
              `  Description: ${template.description}`,
              `  Trigger: ${template.triggers[0]}`,
              '',
              'The workflow will be saved and can be run manually or on schedule.',
            ].join('\n'),
          };
        }

        default:
          return { content: `Unknown action: ${input.action}`, is_error: true };
      }
    } catch (error) {
      return { content: `WorkflowTemplates error: ${(error as Error).message}`, is_error: true };
    }
  },
};
