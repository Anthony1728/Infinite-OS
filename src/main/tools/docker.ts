// Docker Tool — container and image management
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { Tool, ToolContext, ToolResult } from './base.js';

const execAsync = promisify(exec);

interface DockerArgs {
  action: 'run' | 'stop' | 'start' | 'restart' | 'rm' | 'rmi' | 'ps' | 'images' | 'logs' | 'exec' | 'build' | 'compose_up' | 'compose_down' | 'compose_ps' | 'compose_logs' | 'pull' | 'push' | 'inspect' | 'stats' | 'network_ls' | 'volume_ls' | 'prune';
  container?: string;
  image?: string;
  tag?: string;
  command?: string;
  detach?: boolean;
  ports?: string[];
  volumes?: string[];
  env?: Record<string, string>;
  name?: string;
  composeFile?: string;
  buildContext?: string;
  dockerfile?: string;
  follow?: boolean;
  tail?: number;
  interactive?: boolean;
  tty?: boolean;
}

async function runDocker(args: string[], timeout = 60000): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`docker ${args.join(' ')}`, { timeout, maxBuffer: 10 * 1024 * 1024 });
    return stdout || stderr;
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    throw new Error(err.stderr || err.message || 'Docker command failed');
  }
}

export const dockerTool: Tool = {
  name: 'Docker',
  description:
    'Manage Docker containers and images: run, stop, start, restart, remove, build, compose, logs, exec, stats. Full container lifecycle management.',
  permission: 'ask',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['run', 'stop', 'start', 'restart', 'rm', 'rmi', 'ps', 'images', 'logs', 'exec', 'build', 'compose_up', 'compose_down', 'compose_ps', 'compose_logs', 'pull', 'push', 'inspect', 'stats', 'network_ls', 'volume_ls', 'prune'],
        description: 'Docker action',
      },
      container: { type: 'string', description: 'Container name or ID' },
      image: { type: 'string', description: 'Image name (e.g., nginx:latest)' },
      tag: { type: 'string', description: 'Image tag' },
      command: { type: 'string', description: 'Command to run in container' },
      detach: { type: 'boolean', description: 'Run in background (default true)' },
      ports: { type: 'array', items: { type: 'string' }, description: 'Port mappings (e.g., ["8080:80"])' },
      volumes: { type: 'array', items: { type: 'string' }, description: 'Volume mounts (e.g., ["/host:/container"])' },
      env: { type: 'object', description: 'Environment variables', additionalProperties: { type: 'string' } },
      name: { type: 'string', description: 'Container name' },
      composeFile: { type: 'string', description: 'Docker Compose file path' },
      buildContext: { type: 'string', description: 'Build context directory' },
      dockerfile: { type: 'string', description: 'Dockerfile path' },
      follow: { type: 'boolean', description: 'Follow logs (stream)' },
      tail: { type: 'number', description: 'Number of log lines to show' },
      interactive: { type: 'boolean', description: 'Interactive mode for exec' },
      tty: { type: 'boolean', description: 'Allocate TTY' },
    },
    required: ['action'],
  },

  async execute(args: unknown, _ctx: ToolContext): Promise<ToolResult> {
    const a = args as DockerArgs;

    try {
      switch (a.action) {
        case 'run': {
          if (!a.image) return { content: 'Image is required', is_error: true };
          const cmd = ['run'];
          if (a.detach !== false) cmd.push('-d');
          if (a.name) cmd.push('--name', a.name);
          if (a.ports) a.ports.forEach((p) => cmd.push('-p', p));
          if (a.volumes) a.volumes.forEach((v) => cmd.push('-v', v));
          if (a.env) Object.entries(a.env).forEach(([k, v]) => cmd.push('-e', `${k}=${v}`));
          if (a.tty) cmd.push('-t');
          if (a.interactive) cmd.push('-i');
          cmd.push(a.image);
          if (a.command) cmd.push(...a.command.split(' '));
          const output = await runDocker(cmd);
          return { content: `Container started:\n${output.trim()}` };
        }

        case 'stop': {
          if (!a.container) return { content: 'Container is required', is_error: true };
          const output = await runDocker(['stop', a.container]);
          return { content: `Container stopped: ${a.container}\n${output.trim()}` };
        }

        case 'start': {
          if (!a.container) return { content: 'Container is required', is_error: true };
          const output = await runDocker(['start', a.container]);
          return { content: `Container started: ${a.container}\n${output.trim()}` };
        }

        case 'restart': {
          if (!a.container) return { content: 'Container is required', is_error: true };
          const output = await runDocker(['restart', a.container]);
          return { content: `Container restarted: ${a.container}\n${output.trim()}` };
        }

        case 'rm': {
          if (!a.container) return { content: 'Container is required', is_error: true };
          const output = await runDocker(['rm', '-f', a.container]);
          return { content: `Container removed: ${a.container}\n${output.trim()}` };
        }

        case 'rmi': {
          if (!a.image) return { content: 'Image is required', is_error: true };
          const output = await runDocker(['rmi', '-f', a.image]);
          return { content: `Image removed: ${a.image}\n${output.trim()}` };
        }

        case 'ps': {
          const output = await runDocker(['ps', '-a', '--format', 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}']);
          return { content: `Containers:\n${output}` };
        }

        case 'images': {
          const output = await runDocker(['images', '--format', 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}']);
          return { content: `Images:\n${output}` };
        }

        case 'logs': {
          if (!a.container) return { content: 'Container is required', is_error: true };
          const cmd = ['logs'];
          if (a.follow) cmd.push('-f');
          if (a.tail) cmd.push('--tail', String(a.tail));
          cmd.push(a.container);
          const output = await runDocker(cmd, a.follow ? 300000 : 60000);
          return { content: `Logs for ${a.container}:\n${output.slice(-5000)}` };
        }

        case 'exec': {
          if (!a.container || !a.command) return { content: 'Container and command required', is_error: true };
          const cmd = ['exec'];
          if (a.interactive) cmd.push('-i');
          if (a.tty) cmd.push('-t');
          cmd.push(a.container, ...a.command.split(' '));
          const output = await runDocker(cmd);
          return { content: `Exec output:\n${output}` };
        }

        case 'build': {
          if (!a.buildContext) return { content: 'Build context is required', is_error: true };
          const cmd = ['build'];
          if (a.tag) cmd.push('-t', a.tag);
          if (a.dockerfile) cmd.push('-f', a.dockerfile);
          cmd.push(a.buildContext);
          const output = await runDocker(cmd, 300000);
          return { content: `Build output:\n${output.slice(-5000)}` };
        }

        case 'compose_up': {
          const composeFile = a.composeFile || 'docker-compose.yml';
          const output = await runDocker(['compose', '-f', composeFile, 'up', '-d'], 300000);
          return { content: `Compose up:\n${output}` };
        }

        case 'compose_down': {
          const composeFile = a.composeFile || 'docker-compose.yml';
          const output = await runDocker(['compose', '-f', composeFile, 'down']);
          return { content: `Compose down:\n${output}` };
        }

        case 'compose_ps': {
          const composeFile = a.composeFile || 'docker-compose.yml';
          const output = await runDocker(['compose', '-f', composeFile, 'ps']);
          return { content: `Compose services:\n${output}` };
        }

        case 'compose_logs': {
          const composeFile = a.composeFile || 'docker-compose.yml';
          const cmd = ['compose', '-f', composeFile, 'logs'];
          if (a.follow) cmd.push('-f');
          if (a.tail) cmd.push('--tail', String(a.tail));
          const output = await runDocker(cmd, a.follow ? 300000 : 60000);
          return { content: `Compose logs:\n${output.slice(-5000)}` };
        }

        case 'pull': {
          if (!a.image) return { content: 'Image is required', is_error: true };
          const output = await runDocker(['pull', a.image], 300000);
          return { content: `Pulled: ${a.image}\n${output}` };
        }

        case 'push': {
          if (!a.image) return { content: 'Image is required', is_error: true };
          const output = await runDocker(['push', a.image], 300000);
          return { content: `Pushed: ${a.image}\n${output}` };
        }

        case 'inspect': {
          if (!a.container) return { content: 'Container or image required', is_error: true };
          const output = await runDocker(['inspect', '--format', '{{json .}}', a.container]);
          return { content: `Inspect:\n${output.slice(0, 5000)}` };
        }

        case 'stats': {
          const output = await runDocker(['stats', '--no-stream', '--format', 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}']);
          return { content: `Container stats:\n${output}` };
        }

        case 'network_ls': {
          const output = await runDocker(['network', 'ls', '--format', 'table {{.ID}}\t{{.Name}}\t{{.Driver}}\t{{.Scope}}']);
          return { content: `Docker networks:\n${output}` };
        }

        case 'volume_ls': {
          const output = await runDocker(['volume', 'ls', '--format', 'table {{.Name}}\t{{.Driver}}\t{{.Mountpoint}}']);
          return { content: `Docker volumes:\n${output}` };
        }

        case 'prune': {
          const output = await runDocker(['system', 'prune', '-f']);
          return { content: `System pruned:\n${output}` };
        }

        default:
          return { content: `Unknown action: ${a.action}`, is_error: true };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { content: `Docker error: ${msg}`, is_error: true };
    }
  },
};
