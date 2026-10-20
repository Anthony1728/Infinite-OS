import type { Tool, ToolResult } from './base.js';
import { loadRegistry, searchRegistry, type CliHubEntry } from '../cli-hub/registry.js';
import { runCommand } from '../cli-hub/run.js';
import { infiniteHome } from '../profiles/home.js';
import { join } from 'node:path';

/**
 * Find, install and run agent-native CLIs.
 *
 * This is how Infinite AI gets hands on software it has never seen.
 *
 * The agent could already run a shell command, but a shell command is only
 * useful if you already know that a CLI exists, what it is called, and how it
 * is invoked. That knowledge is exactly what was missing, so in practice the
 * agent could drive a terminal and nothing else.
 *
 * Every software in this catalogue has a purpose-built command-line interface
 * that emits JSON and has an undo history — GIMP, Blender, LibreOffice,
 * Obsidian, Calibre, n8n, Audacity, Krita and dozens more. Driving those is
 * both faster and far more reliable than synthesising clicks against a window,
 * because a window moves and a command does not.
 *
 * Read-only actions need no permission. Installing software and running it are
 * `ask`, because both change the machine.
 */

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}

function json(value: unknown): ToolResult {
  return { content: JSON.stringify(value, null, 2) };
}

/** The shape an agent needs to decide whether this is the right CLI. */
function summarise(entry: CliHubEntry) {
  return {
    name: entry.name,
    display_name: entry.display_name,
    description: entry.description,
    category: entry.category,
    version: entry.version,
    // Stated plainly so the agent can tell the user what is needed first,
    // rather than running an install that fails on a missing dependency.
    requires: entry.requires,
  };
}

export const cliHubTool: Tool = {
  name: 'CliHub',
  description: [
    'Find, install and run command-line interfaces for real software, so you can actually operate applications.',
    'The catalogue covers GIMP, Blender, LibreOffice, Obsidian, Calibre, Audacity, Krita, Obs Studio, n8n, ComfyUI and many more.',
    'These CLIs are the reliable way to drive that software: they return structured output and hold an undo history, which synthesised clicks against a window cannot.',
    'Start with action=search and the software or task in plain words ("edit a photo", "convert a pdf", "edit a video").',
    'Use action=info for one CLI, action=install to install it, then action=run to drive it.',
    'action=run passes argv, not a shell string: run={"name":"gimp","args":["--help"]} to discover its commands.',
    'Everything else in Infinite OS still applies: once a CLI is installed you can also call it directly with the bash tool.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'info', 'install', 'run', 'installed', 'categories'],
        description: 'What to do',
      },
      query: { type: 'string', description: 'For search: words describing the software or the task' },
      name: { type: 'string', description: 'CLI name, as returned by search or info' },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'For run: the arguments, passed as argv. Do not build a shell string.',
      },
      limit: { type: 'number', description: 'Maximum search results (default 10)' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args): Promise<ToolResult> {
    const input = args as {
      action?: string;
      query?: string;
      name?: string;
      args?: string[];
      limit?: number;
    };

    const catalog = await loadRegistry(join(infiniteHome(), 'cache', 'cli-hub'));
    // A refresh failure is reported but is not fatal: a cached catalogue from
    // yesterday still describes what is installed on this machine.
    if (catalog.error) {
      const wrapped = catalog.fromCache
        ? bad(`${catalog.error} Run action=installed to see what you can use right now.`)
        : bad(`The CLI catalogue could not be loaded: ${catalog.error}`);
      if (catalog.registry.clis.length === 0) return wrapped;
    }

    const registry = catalog.registry;

    switch (input.action) {
      case 'categories': {
        const counts = new Map<string, number>();
        for (const entry of registry.clis) {
          const key = entry.category ?? 'other';
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return ok([...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`).join(', '));
      }

      case 'search': {
        if (!input.query) return bad('search requires a query. Describe the software or the task in plain words.');
        const found = searchRegistry(registry, input.query, input.limit ?? 10);
        if (found.length === 0) {
          return bad(
            `No CLI in the catalogue matches "${input.query}". ` +
            `It covers ${registry.clis.length} applications. Try a broader word, or action=categories to see the areas it covers. ` +
            'If the software has no CLI here, say so rather than guessing a command.',
          );
        }
        return json(found.map(summarise));
      }

      case 'info': {
        if (!input.name) return bad('info requires a name.');
        const entry = registry.clis.find(c => c.name === input.name);
        if (!entry) return bad(`No CLI named "${input.name}". Use search to find one.`);
        return json({
          ...entry,
          // Both commands spelled out: the agent should never have to
          // reconstruct them, because a reconstructed install command is the
          // easiest way to install something the user did not agree to.
          install_command: entry.install_cmd,
          run_command: entry.entry_point,
        });
      }

      case 'installed': {
        // The catalogue describes what *could* be installed. This reports what
        // actually is, so the agent does not tell the user to install something
        // that is already there.
        const results = await Promise.all(
          registry.clis.map(async entry => {
            if (!entry.entry_point) return null;
            const probe = await runCommand(`${entry.entry_point} --help`, { timeoutMs: 8000 });
            return { name: entry.name, entry_point: entry.entry_point, installed: probe.ok };
          }),
        );
        const installed = results.filter(r => r?.installed).map(r => r!.name);
        const missing = results.filter(r => r && !r.installed).length;
        return ok(
          installed.length === 0
            ? `None of the ${results.length} catalogued CLIs is installed yet. ${missing} are not. Use search, then install.`
            : `Installed (${installed.length} of ${registry.clis.length}): ${installed.join(', ')}\n\nNot installed: ${missing}`,
        );
      }

      case 'install': {
        if (!input.name) return bad('install requires a name.');
        const entry = registry.clis.find(c => c.name === input.name);
        if (!entry) return bad(`No CLI named "${input.name}". Use search to find one.`);
        if (!entry.install_cmd) return bad(`${entry.display_name} has no install command in the catalogue.`);

        // Stated before running, not after. The user must be able to see what
        // is about to be installed on their machine, which is the whole reason
        // this action asks.
        const preamble =
          `Installing ${entry.display_name} (${entry.version ?? 'unversioned'}).\n` +
          `Runs: ${entry.install_cmd}\n` +
          (entry.requires ? `This needs: ${entry.requires}\n` : '') +
          (entry.description ? `${entry.description}\n` : '');

        const result = await runCommand(entry.install_cmd, { timeoutMs: 10 * 60 * 1000 });
        if (!result.ok) {
          return bad(
            `${preamble}\nInstallation failed${result.code !== null ? ` (exit ${result.code})` : ''}.\n` +
            `${result.stderr.trim() || result.stdout.trim() || 'No output.'}\n` +
            (entry.requires ? `\nIt requires: ${entry.requires}` : ''),
          );
        }
        return ok(
          `${preamble}\nInstalled. Run it with action=run name="${entry.name}", or call \`${entry.entry_point}\` directly with the bash tool.`,
        );
      }

      case 'run': {
        if (!input.name) return bad('run requires a name.');
        const entry = registry.clis.find(c => c.name === input.name);
        if (!entry) return bad(`No CLI named "${input.name}". Use search to find one.`);
        if (!entry.entry_point) return bad(`${entry.display_name} has no entry point in the catalogue.`);
        if (input.args?.some(a => typeof a !== 'string')) {
          return bad('args must be an array of strings.');
        }

        // Passed as argv, not joined into a string. An argument is then exactly what
        // the caller sent, so a filename with a space in it stays one argument
        // instead of being split in two — which is the normal case for an image
        // or a document, not an edge case.
        const argv = [entry.entry_point, ...(input.args ?? [])];
        const result = await runCommand(argv, { timeoutMs: 5 * 60 * 1000 });

        const header = [entry.entry_point, ...(input.args ?? [])].join(' ');
        if (!result.ok) {
          // A CLI that is simply not installed is the common case and deserves
          // a plain answer rather than an errno.
          const hint = /not installed or not on PATH/.test(result.stderr)
            ? `\n\n${entry.display_name} is not installed. Run action=install name="${entry.name}" first.`
            : '';
          return bad(
            `${header} failed${result.code !== null ? ` (exit ${result.code})` : ''}.\n` +
            `${(result.stderr.trim() || result.stdout.trim() || 'No output.')}${hint}`,
          );
        }
        return ok(`${header}\n${result.stdout.trim() || result.stderr.trim() || '(no output)'}`);
      }

      default:
        return bad(`Unknown action "${input.action}". Use search, info, install, run, installed or categories.`);
    }
  },
};