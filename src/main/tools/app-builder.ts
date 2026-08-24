import type { Tool, ToolResult } from './base.js';
import { AppBuilder } from '../builders/app.js';
import type { AppProject, AppFile, AppTemplate } from '../builders/app.js';

let _appBuilder: InstanceType<typeof AppBuilder> | null = null;
function getAppBuilder() {
  if (!_appBuilder) _appBuilder = new AppBuilder();
  return _appBuilder;
}

export const appBuilderTool: Tool = {
  name: 'AppBuilder',
  description: 'Create, build, and manage applications using the Infinite OS App Builder. Supports React, Electron, Next.js, Express, Fastify, and React Native projects. Create projects from templates, add files, generate components/pages/APIs, build, and run.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'list', 'get', 'add_file', 'generate_component', 'generate_page', 'generate_api', 'build', 'run', 'rename', 'move', 'delete', 'templates', 'stats'],
        description: 'The action to perform',
      },
      name: { type: 'string', description: 'Project name (for create/rename)' },
      description: { type: 'string', description: 'Project description (for create)' },
      framework: { type: 'string', enum: ['react', 'electron', 'nextjs', 'express', 'fastify', 'react-native'], description: 'Framework (for create)' },
      language: { type: 'string', enum: ['typescript', 'javascript'], description: 'Language (for create, default: typescript)' },
      project_id: { type: 'string', description: 'Project ID' },
      file_path: { type: 'string', description: 'File path (for add_file)' },
      file_content: { type: 'string', description: 'File content (for add_file)' },
      file_type: { type: 'string', enum: ['component', 'page', 'util', 'store', 'api', 'config', 'test', 'style', 'asset'], description: 'File type (for add_file)' },
      component_name: { type: 'string', description: 'Component name (for generate_component)' },
      props: { type: 'array', items: { type: 'string' }, description: 'Component props (for generate_component)' },
      page_name: { type: 'string', description: 'Page name (for generate_page)' },
      route: { type: 'string', description: 'Page route (for generate_page)' },
      endpoint: { type: 'string', description: 'API endpoint (for generate_api)' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], description: 'HTTP method (for generate_api)' },
      destination: { type: 'string', description: 'Destination path (for move)' },
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
          const project = getAppBuilder().createProject({
            name: input.name as string,
            description: (input.description as string) ?? '',
            framework: (input.framework ?? 'react') as AppProject['framework'],
            language: (input.language ?? 'typescript') as AppProject['language'],
          });
          return json({ success: true, project: summarizeProject(project) });
        }
        case 'list':
          return json(getAppBuilder().listProjects().map(summarizeProject));
        case 'get': {
          if (!input.project_id) return bad('get requires project_id');
          const p = getAppBuilder().getProject(input.project_id as string);
          return p ? json(summarizeProject(p)) : bad(`Project not found: ${input.project_id}`);
        }
        case 'add_file': {
          if (!input.project_id || !input.file_path || !input.file_content) return bad('add_file requires project_id, file_path, and file_content');
          const ok = getAppBuilder().addFile(input.project_id as string, {
            path: input.file_path as string,
            content: input.file_content as string,
            type: (input.file_type as string ?? 'component') as AppFile['type'],
          });
          return ok ? json({ success: true }) : bad('Failed to add file — project not found');
        }
        case 'generate_component': {
          if (!input.project_id || !input.component_name) return bad('generate_component requires project_id and component_name');
          const code = getAppBuilder().generateComponent(input.project_id as string, input.component_name as string, (input.props as string[]) ?? []);
          return json({ success: true, code });
        }
        case 'generate_page': {
          if (!input.project_id || !input.page_name) return bad('generate_page requires project_id and page_name');
          const code = getAppBuilder().generatePage(input.project_id as string, input.page_name as string, (input.route as string) ?? '/');
          return json({ success: true, code });
        }
        case 'generate_api': {
          if (!input.project_id || !input.endpoint) return bad('generate_api requires project_id and endpoint');
          const code = getAppBuilder().generateAPI(input.project_id as string, input.endpoint as string, (input.method as string) ?? 'GET');
          return json({ success: true, code });
        }
        case 'build': {
          if (!input.project_id) return bad('build requires project_id');
          const result = getAppBuilder().buildProject(input.project_id as string);
          return json(result);
        }
        case 'run': {
          if (!input.project_id) return bad('run requires project_id');
          const project = getAppBuilder().getProject(input.project_id as string);
          if (!project) return bad(`Project not found: ${input.project_id}`);
          return json({ success: true, message: `Project "${project.name}" is ready. Output at: ${project.outputPath ?? 'not built yet'}` });
        }
        case 'rename': {
          if (!input.project_id || !input.name) return bad('rename requires project_id and name');
          const renamed = getAppBuilder().renameProject(input.project_id as string, input.name as string);
          return renamed ? json(summarizeProject(renamed)) : bad('Project not found');
        }
        case 'move': {
          if (!input.project_id || !input.destination) return bad('move requires project_id and destination');
          return json(getAppBuilder().moveProject(input.project_id as string, input.destination as string));
        }
        case 'delete': {
          if (!input.project_id) return bad('delete requires project_id');
          return json({ success: getAppBuilder().deleteProject(input.project_id as string) });
        }
        case 'templates':
          return json(getAppBuilder().getTemplates().map((t: AppTemplate) => ({ id: t.id, name: t.name, framework: t.framework, language: t.language, description: t.description })));
        case 'stats':
          return json(getAppBuilder().getStats());
        default:
          return bad(`Unknown action: ${input.action}`);
      }
    } catch (error) {
      return bad(`AppBuilder error: ${(error as Error).message}`);
    }
  },
};

function summarizeProject(p: AppProject) {
  return {
    id: p.id,
    name: p.name,
    framework: p.framework,
    language: p.language,
    status: p.status,
    files: p.files?.length ?? 0,
    outputPath: p.outputPath,
    createdAt: p.createdAt,
  };
}

function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
