import type { Tool, ToolResult } from './base.js';
import { WebsiteBuilder } from '../builders/website.js';
import type { Website, WebsiteComponent, WebsiteTemplate } from '../builders/website.js';

let _websiteBuilder: InstanceType<typeof WebsiteBuilder> | null = null;
function getWebsiteBuilder() {
  if (!_websiteBuilder) _websiteBuilder = new WebsiteBuilder();
  return _websiteBuilder;
}

export const websiteBuilderTool: Tool = {
  name: 'WebsiteBuilder',
  description: 'Create, build, and manage websites using the Infinite OS Website Builder. Supports portfolio, SaaS, and ecommerce templates. Create websites, add pages, add components, generate code, publish, and deploy.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'get', 'add_page', 'add_component', 'generate_code', 'generate_files', 'publish', 'deploy', 'delete', 'templates', 'stats'],
        description: 'The action to perform',
      },
      name: { type: 'string', description: 'Website name' },
      description: { type: 'string', description: 'Website description' },
      template_id: { type: 'string', description: 'Template ID (for create)' },
      website_id: { type: 'string', description: 'Website ID' },
      slug: { type: 'string', description: 'Page slug (for add_page)' },
      page_title: { type: 'string', description: 'Page title (for add_page)' },
      page_id: { type: 'string', description: 'Page ID (for add_component)' },
      component_type: { type: 'string', description: 'Component type (for add_component)' },
      component_content: { type: 'string', description: 'Component content/props as JSON (for add_component)' },
      output_dir: { type: 'string', description: 'Output directory (for generate_files)' },
    },
    required: ['action'],
  },
  permission: 'ask',
  async execute(args, _ctx): Promise<ToolResult> {
    const input = args as Record<string, unknown>;
    try {
      switch (input.action) {
        case 'create': {
          if (!input.name) return bad('create requires name');
          const site = getWebsiteBuilder().createWebsite({
            name: input.name as string,
            description: (input.description as string) ?? '',
            templateId: input.template_id as string | undefined,
          });
          return json({ success: true, website: summarizeSite(site) });
        }
        case 'list':
          return json(getWebsiteBuilder().listWebsites().map(summarizeSite));
        case 'get': {
          if (!input.website_id) return bad('get requires website_id');
          const s = getWebsiteBuilder().getWebsite(input.website_id as string);
          return s ? json(summarizeSite(s)) : bad(`Website not found: ${input.website_id}`);
        }
        case 'add_page': {
          if (!input.website_id || !input.slug || !input.page_title) return bad('add_page requires website_id, slug, and page_title');
          const page = getWebsiteBuilder().addPage(input.website_id as string, input.slug as string, input.page_title as string);
          return page ? json({ success: true, page: { id: page.id, slug: page.slug, title: page.title } }) : bad('Failed to add page — website not found');
        }
        case 'add_component': {
          if (!input.website_id || !input.page_id || !input.component_type) return bad('add_component requires website_id, page_id, and component_type');
          let content: Record<string, unknown> = {};
          if (input.component_content) {
            try { content = JSON.parse(input.component_content as string); } catch { return bad('component_content must be valid JSON'); }
          }
          const comp = getWebsiteBuilder().addComponent(input.website_id as string, input.page_id as string, {
            type: input.component_type as WebsiteComponent['type'],
            name: input.component_type as string,
            props: content,
            order: 0,
          });
          return comp ? json({ success: true, component: { id: comp.id, type: comp.type } }) : bad('Failed to add component');
        }
        case 'generate_code': {
          if (!input.website_id) return bad('generate_code requires website_id');
          const code = getWebsiteBuilder().generateCode(input.website_id as string);
          return json({ success: true, code });
        }
        case 'generate_files': {
          if (!input.website_id) return bad('generate_files requires website_id');
          const files = getWebsiteBuilder().generateFiles(input.website_id as string, input.output_dir as string | undefined);
          return json({ success: true, files });
        }
        case 'publish': {
          if (!input.website_id) return bad('publish requires website_id');
          return json({ success: getWebsiteBuilder().publish(input.website_id as string) });
        }
        case 'deploy': {
          if (!input.website_id) return bad('deploy requires website_id');
          const result = getWebsiteBuilder().deploy(input.website_id as string);
          return result ? json({ success: true, url: result.url }) : bad('Deploy failed');
        }
        case 'delete': {
          if (!input.website_id) return bad('delete requires website_id');
          return json({ success: getWebsiteBuilder().deleteWebsite(input.website_id as string) });
        }
        case 'templates':
          return json(getWebsiteBuilder().getTemplates().map((t: WebsiteTemplate) => ({ id: t.id, name: t.name, description: t.description })));
        case 'stats':
          return json(getWebsiteBuilder().getStats());
        default:
          return bad(`Unknown action: ${input.action}`);
      }
    } catch (error) {
      return bad(`WebsiteBuilder error: ${(error as Error).message}`);
    }
  },
};

function summarizeSite(s: Website) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    pages: s.pages?.length ?? 0,
    deployUrl: s.deployUrl,
    createdAt: s.createdAt,
  };
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
