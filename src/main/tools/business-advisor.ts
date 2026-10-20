import type { Tool, ToolResult } from './base.js';
import { getBusinessOS } from '../business/crm.js';

const ACTIONS = [
  'analyze_pipeline',
  'generate_report',
  'recommendations',
  'forecast',
  'health_check',
  'compare_periods',
] as const;

export const businessAdvisorTool: Tool = {
  name: 'BusinessAdvisor',
  description:
    'AI-powered business intelligence and advisory. Analyze your CRM pipeline, generate business reports, get actionable recommendations, forecast deal outcomes, check business health, and compare performance across periods. Works with contacts, leads, deals, and invoices.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS, description: 'Advisor action to perform' },
      focus: { type: 'string', description: 'Specific area to focus on: sales, marketing, finance, operations' },
      period: { type: 'string', description: 'Time period for comparison: week, month, quarter, year' },
      question: { type: 'string', description: 'Specific business question to answer' },
    },
    required: ['action'],
  },
  permission: 'none',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action: (typeof ACTIONS)[number];
      focus?: string;
      period?: string;
      question?: string;
    };

    try {
      const bos = getBusinessOS();

      switch (input.action) {
        case 'analyze_pipeline': {
          const analytics = bos.getAnalytics();
          const leads = bos.listLeads();
          const deals = bos.listDeals();

          const response = {
            summary: {
              totalContacts: analytics.totalContacts,
              totalLeads: analytics.totalLeads,
              activeDeals: analytics.activeDeals,
              pipelineValue: analytics.pipelineValue,
              conversionRate: (analytics.conversionRate * 100).toFixed(1) + '%',
              avgDealSize: analytics.avgDealSize,
              totalRevenue: analytics.totalRevenue,
            },
            pipelineByStage: analytics.dealsByStage,
            leadsByStatus: analytics.leadsByStatus,
            topDeals: deals
              .filter((d) => !d.stage.startsWith('closed'))
              .sort((a, b) => b.value - a.value)
              .slice(0, 5)
              .map((d) => ({ title: d.title, value: d.value, stage: d.stage, probability: d.probability })),
            recentLeads: leads
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 5)
              .map((l) => ({ contactId: l.contactId, status: l.status, value: l.value, source: l.source })),
            stuckDeals: deals
              .filter((d) => !d.stage.startsWith('closed') && Date.now() - d.createdAt > 30 * 24 * 60 * 60 * 1000)
              .map((d) => ({ title: d.title, value: d.value, stage: d.stage, daysOpen: Math.floor((Date.now() - d.createdAt) / 86400000) })),
          };

          let advice = `## Pipeline Analysis\n\n`;
          advice += `**Revenue:** $${analytics.totalRevenue.toLocaleString()} | **Pipeline:** $${analytics.pipelineValue.toLocaleString()}\n`;
          advice += `**Conversion Rate:** ${(analytics.conversionRate * 100).toFixed(1)}% | **Avg Deal:** $${analytics.avgDealSize.toLocaleString()}\n\n`;

          if (analytics.conversionRate < 0.2) {
            advice += '**⚠ Low Conversion Rate.** Consider: improving lead qualification, shortening sales cycles, or revisiting pricing strategy.\n\n';
          }
          if (response.stuckDeals.length > 0) {
            advice += `**⚠ ${response.stuckDeals.length} stuck deal(s)** open for 30+ days. Review these deals and decide: escalate, discount, or close as lost.\n\n`;
          }
          if (analytics.pipelineValue === 0 && analytics.totalLeads > 0) {
            advice += '**⚠ Leads exist but no active deals.** Convert qualified leads to deals to track revenue opportunities.\n\n';
          }

          return ok(advice + '\n### Detailed Data\n```json\n' + JSON.stringify(response, null, 2) + '\n```');
        }
        case 'generate_report': {
          const analytics = bos.getAnalytics();
          const leads = bos.listLeads();
          const invoices = bos.listInvoices();

          const paidInvoices = invoices.filter((i) => i.status === 'paid');
          const overdueInvoices = invoices.filter((i) => i.status === 'overdue');
          const wonLeads = leads.filter((l) => l.status === 'won');
          const lostLeads = leads.filter((l) => l.status === 'lost');

          let report = `# Business Report\n\n`;
          report += `## Financial Overview\n`;
          report += `- Total Revenue: $${analytics.totalRevenue.toLocaleString()}\n`;
          report += `- Paid Invoices: ${paidInvoices.length}\n`;
          report += `- Overdue Invoices: ${overdueInvoices.length}\n`;
          report += `- Outstanding (overdue): $${overdueInvoices.reduce((s, i) => s + i.total, 0).toLocaleString()}\n\n`;

          report += `## Sales Pipeline\n`;
          report += `- Active Deals: ${analytics.activeDeals}\n`;
          report += `- Pipeline Value: $${analytics.pipelineValue.toLocaleString()}\n`;
          report += `- Avg Deal Size: $${analytics.avgDealSize.toLocaleString()}\n`;
          report += `- Conversion Rate: ${(analytics.conversionRate * 100).toFixed(1)}%\n\n`;

          report += `## Lead Performance\n`;
          report += `- Total Leads: ${analytics.totalLeads}\n`;
          report += `- Won: ${wonLeads.length} | Lost: ${lostLeads.length}\n`;
          for (const [status, count] of Object.entries(analytics.leadsByStatus)) {
            report += `  - ${status}: ${count}\n`;
          }

          report += `\n## Deal Pipeline\n`;
          for (const [stage, count] of Object.entries(analytics.dealsByStage)) {
            report += `- ${stage}: ${count} deal(s)\n`;
          }

          report += `\n## Key Insights\n`;
          if (overdueInvoices.length > 0) {
            report += `- **Action needed:** ${overdueInvoices.length} overdue invoice(s) totaling $${overdueInvoices.reduce((s, i) => s + i.total, 0).toLocaleString()}. Follow up with clients.\n`;
          }
          if (analytics.conversionRate > 0.5) {
            report += `- **Strong conversion rate** at ${(analytics.conversionRate * 100).toFixed(1)}%. Consider scaling lead generation.\n`;
          }
          if (analytics.activeDeals === 0) {
            report += `- **No active deals.** Focus on converting existing leads.\n`;
          }

          return ok(report);
        }
        case 'recommendations': {
          const analytics = bos.getAnalytics();
          const leads = bos.listLeads();
          const deals = bos.listDeals();
          const invoices = bos.listInvoices();

          const recommendations: string[] = [];

          // Lead recommendations
          const newLeads = leads.filter((l) => l.status === 'new');
          if (newLeads.length > 0) {
            recommendations.push(`**Follow up on ${newLeads.length} new lead(s).** New leads have the highest conversion potential in the first 48 hours.`);
          }

          // Deal recommendations
          const stuckDeals = deals.filter((d) => !d.stage.startsWith('closed') && Date.now() - d.createdAt > 14 * 86400000);
          if (stuckDeals.length > 0) {
            recommendations.push(`**Review ${stuckDeals.length} stale deal(s).** Deals open for 14+ days may need a fresh approach or re-engagement.`);
          }

          // Invoice recommendations
          const overdueInvoices = invoices.filter((i) => i.status === 'overdue');
          if (overdueInvoices.length > 0) {
            recommendations.push(`**Chase ${overdueInvoices.length} overdue invoice(s).** Outstanding payments affect cash flow. Send reminders or call clients.`);
          }

          // Pipeline recommendations
          if (analytics.pipelineValue < analytics.avgDealSize * 3 && analytics.activeDeals > 0) {
            recommendations.push(`**Pipeline is thin** at $${analytics.pipelineValue.toLocaleString()}. Add more deals to maintain a healthy 3x coverage of your avg deal size.`);
          }

          // Conversion recommendations
          if (analytics.conversionRate < 0.3 && analytics.totalLeads > 5) {
            recommendations.push(`**Improve lead qualification.** Your ${(analytics.conversionRate * 100).toFixed(1)}% conversion rate suggests leads may not be well-qualified. Refine targeting or qualification criteria.`);
          }

          if (recommendations.length === 0) {
            recommendations.push('Your business metrics look healthy. Keep maintaining current processes and look for growth opportunities.');
          }

          let response = `## Recommendations\n\n`;
          recommendations.forEach((r, i) => {
            response += `${i + 1}. ${r}\n\n`;
          });

          // Add focus-specific advice
          if (input.focus) {
            response += `\n### ${input.focus.charAt(0).toUpperCase() + input.focus.slice(1)} Focus\n`;
            response += `Provide specific, actionable advice for improving the ${input.focus} area of the business based on the current data.\n`;
          }

          return ok(response);
        }
        case 'forecast': {
          const deals = bos.listDeals();

          const activeDeals = deals.filter((d) => !d.stage.startsWith('closed'));
          const weightedPipeline = activeDeals.reduce((sum, d) => sum + d.value * d.probability, 0);
          const bestCase = activeDeals.reduce((sum, d) => sum + d.value, 0);
          const worstCase = activeDeals.reduce((sum, d) => sum + d.value * 0.1, 0);

          let forecast = `## Revenue Forecast\n\n`;
          forecast += `### Current Pipeline\n`;
          forecast += `- Active Deals: ${activeDeals.length}\n`;
          forecast += `- Weighted Pipeline: $${weightedPipeline.toLocaleString()}\n`;
          forecast += `- Best Case (all close): $${bestCase.toLocaleString()}\n`;
          forecast += `- Worst Case (10% close): $${worstCase.toLocaleString()}\n\n`;

          forecast += `### Deal Breakdown\n`;
          for (const deal of activeDeals.sort((a, b) => b.value - a.probability - (a.value * a.probability))) {
            forecast += `- **${deal.title}**: $${deal.value.toLocaleString()} (${(deal.probability * 100)}% likely) → Expected: $${(deal.value * deal.probability).toLocaleString()}\n`;
          }

          forecast += `\n### Projection\n`;
          forecast += `- Most likely revenue: **$${weightedPipeline.toLocaleString()}**\n`;
          forecast += `- Upside potential: **$${(bestCase - weightedPipeline).toLocaleString()}** additional if all deals close\n`;
          forecast += `- Downside risk: **$${(weightedPipeline - worstCase).toLocaleString()}** if most deals fall through\n`;

          return ok(forecast);
        }
        case 'health_check': {
          const analytics = bos.getAnalytics();
          const leads = bos.listLeads();
          const invoices = bos.listInvoices();

          const checks: { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }[] = [];

          // Revenue check
          checks.push({
            name: 'Revenue',
            status: analytics.totalRevenue > 0 ? 'pass' : 'warn',
            detail: `$${analytics.totalRevenue.toLocaleString()} total revenue`,
          });

          // Pipeline check
          checks.push({
            name: 'Pipeline',
            status: analytics.activeDeals > 0 ? 'pass' : analytics.totalLeads > 0 ? 'warn' : 'fail',
            detail: `${analytics.activeDeals} active deals, $${analytics.pipelineValue.toLocaleString()} pipeline value`,
          });

          // Conversion check
          checks.push({
            name: 'Conversion',
            status: analytics.conversionRate >= 0.3 ? 'pass' : analytics.conversionRate > 0 ? 'warn' : 'fail',
            detail: `${(analytics.conversionRate * 100).toFixed(1)}% lead-to-deal conversion`,
          });

          // Invoice health
          const overdueInvoices = invoices.filter((i) => i.status === 'overdue');
          checks.push({
            name: 'Invoices',
            status: overdueInvoices.length === 0 ? 'pass' : overdueInvoices.length <= 2 ? 'warn' : 'fail',
            detail: `${overdueInvoices.length} overdue invoice(s)`,
          });

          // Lead freshness
          const staleLeads = leads.filter((l) => l.status === 'new' && Date.now() - l.createdAt > 7 * 86400000);
          checks.push({
            name: 'Lead Response',
            status: staleLeads.length === 0 ? 'pass' : 'warn',
            detail: `${staleLeads.length} lead(s) older than 7 days without follow-up`,
          });

          let report = `## Business Health Check\n\n`;
          for (const check of checks) {
            const icon = check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌';
            report += `${icon} **${check.name}:** ${check.detail}\n`;
          }

          const score = checks.filter((c) => c.status === 'pass').length;
          report += `\n### Score: ${score}/${checks.length}\n`;

          if (score === checks.length) {
            report += 'Your business is in excellent health. Keep it up!';
          } else if (score >= checks.length - 1) {
            report += 'Minor issues detected. Review warnings and take corrective action.';
          } else {
            report += 'Attention needed. Several areas require immediate action.';
          }

          return ok(report);
        }
        case 'compare_periods': {
          const leads = bos.listLeads();
          const deals = bos.listDeals();

          const period = input.period ?? 'month';
          const now = Date.now();
          const periodMs: Record<string, number> = {
            week: 7 * 86400000,
            month: 30 * 86400000,
            quarter: 90 * 86400000,
            year: 365 * 86400000,
          };
          const ms = periodMs[period] ?? periodMs.month;

          const currentLeads = leads.filter((l) => l.createdAt >= now - ms);
          const previousLeads = leads.filter((l) => l.createdAt >= now - 2 * ms && l.createdAt < now - ms);
          const currentDeals = deals.filter((d) => d.createdAt >= now - ms);
          const previousDeals = deals.filter((d) => d.createdAt >= now - 2 * ms && d.createdAt < now - ms);

          let response = `## Period Comparison (${period})\n\n`;
          response += `| Metric | Current | Previous | Change |\n`;
          response += `|--------|---------|----------|--------|\n`;
          response += `| New Leads | ${currentLeads.length} | ${previousLeads.length} | ${currentLeads.length - previousLeads.length >= 0 ? '+' : ''}${currentLeads.length - previousLeads.length} |\n`;
          response += `| New Deals | ${currentDeals.length} | ${previousDeals.length} | ${currentDeals.length - previousDeals.length >= 0 ? '+' : ''}${currentDeals.length - previousDeals.length} |\n`;
          response += `| Lead Value | $${currentLeads.reduce((s, l) => s + l.value, 0).toLocaleString()} | $${previousLeads.reduce((s, l) => s + l.value, 0).toLocaleString()} |\n`;

          return ok(response);
        }
        default:
          return bad(`Unknown BusinessAdvisor action: ${input.action}`);
      }
    } catch (error) {
      return bad(`BusinessAdvisor action failed: ${(error as Error).message}`);
    }
  },
};

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}
