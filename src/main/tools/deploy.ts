import type { Tool, ToolResult } from './base.js';
import { deploySystem, type DeployTarget } from '../deploy/index.js';

export const deployTool: Tool = {
  name: 'Deploy',
  description: 'Detect, build, test, and deploy projects through validated command pipelines and targets including local, Vercel, Netlify, Docker, AWS, Azure, GCP, SSH, and FTP environments.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['detect', 'create_target', 'list_targets', 'create_pipeline', 'run_pipeline', 'cancel_pipeline', 'list_pipelines'] },
      path: { type: 'string' }, name: { type: 'string' }, target_type: { type: 'string' }, config: { type: 'object' }, project_id: { type: 'string' }, target_id: { type: 'string' }, commands: { type: 'array', items: { type: 'string' } }, pipeline_id: { type: 'string' },
    },
    required: ['action'],
  },
  permission: 'ask',
  async execute(args, ctx): Promise<ToolResult> {
    const input = args as { action: string; path?: string; name?: string; target_type?: DeployTarget['type']; config?: Record<string, string>; project_id?: string; target_id?: string; commands?: string[]; pipeline_id?: string };
    try {
      if (input.action === 'detect') return json(await deploySystem.detectProjectType(input.path ?? ctx.cwd));
      if (input.action === 'create_target') return input.name && input.target_type ? json(deploySystem.createTarget(input.name, input.target_type, input.config ?? {})) : bad('create_target requires name and target_type.');
      if (input.action === 'list_targets') return json(deploySystem.listTargets());
      if (input.action === 'create_pipeline') return input.name && input.project_id && input.target_id && input.commands ? json(await deploySystem.createPipeline(input.name, input.project_id, input.target_id, input.commands)) : bad('create_pipeline requires name, project_id, target_id, and commands.');
      if (input.action === 'run_pipeline') return input.pipeline_id ? json(await deploySystem.runPipeline(input.pipeline_id, input.path ?? ctx.cwd)) : bad('run_pipeline requires pipeline_id.');
      if (input.action === 'cancel_pipeline') return json({ cancelled: Boolean(input.pipeline_id && deploySystem.cancelPipeline(input.pipeline_id)) });
      if (input.action === 'list_pipelines') return json(deploySystem.listPipelines());
      return bad(`Unknown Deploy action: ${input.action}`);
    } catch (error) { return bad((error as Error).message); }
  },
};
function json(value: unknown): ToolResult { return { content: JSON.stringify(value, null, 2) }; }
function bad(content: string): ToolResult { return { content, is_error: true }; }
