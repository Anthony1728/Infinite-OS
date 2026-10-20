/**
 * The `Rea` tool — one gateway in front of REA's 207 tools.
 *
 * Attaching every REA schema would add ~760k characters to the request, so the
 * model gets a tiny discovery surface instead:
 *
 *   action=tools                     → entry points and a search
 *   action=tools query=decompile     → the handful of relevant tools
 *   action=tools tool=open_binary    → that tool's exact schema
 *   action=call tool=open_binary ... → run it
 *
 * The distinction between tools and call is deliberate. A model that guesses
 * argument names against a stateful binary analyzer wastes a 13-second server
 * start and can leave a half-open target behind; reading the schema first is
 * both faster and more accurate.
 */

import type { Tool, ToolResult } from '../tools/base.js';
import {
  REA_SCHEMA_LIMIT,
  REA_START_HERE,
  reaClient,
  selectTools,
  suggestReaTools,
  summariseTool,
  truncateText,
  type ReaBackend,
} from './client.js';

function ok(content: string): ToolResult {
  return { content };
}

function bad(content: string): ToolResult {
  return { content, is_error: true };
}

interface ReaInput {
  action?: string;
  query?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  timeout_ms?: number;
}

export function createReaTool(backend: ReaBackend = reaClient): Tool {
  return {
    name: 'Rea',
    description: [
      "Reverse-engineer anything with REA's 207 tools: decompile, xrefs, call graphs, runtime capture, APK, firmware and website analysis.",
      'Stateful — for binaries, open_binary first, then binary_overview.',
      'Discover with action=tools&query=..., read one schema with action=tools&tool=..., execute with action=call.',
      'Evidence output can be huge: prefer detail=summary. status diagnoses Node/install; install fetches REA once. Use absolute paths.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'tools', 'call', 'install'],
          description: 'status | tools | call | install',
        },
        query: { type: 'string', description: 'tools: words describing the task' },
        tool: { type: 'string', description: 'tools: exact name for its schema; call: tool to run' },
        arguments: { type: 'object', description: 'call: tool arguments' },
        timeout_ms: { type: 'number', description: 'call: ms (default 120000)' },
      },
      required: ['action'],
    },
    permission: 'ask',

    async execute(args, ctx): Promise<ToolResult> {
      const input = (args ?? {}) as ReaInput;
      const action = typeof input.action === 'string' ? input.action : '';

      try {
        switch (action) {
          case 'status':
            return ok(backend.statusReport());

          case 'install': {
            ctx.onUpdate({ content: 'Installing REA (one time, about 260 MB)…' });
            const message = await backend.install((line) => ctx.onUpdate({ content: line }));
            return ok(message);
          }

          case 'tools': {
            ctx.onUpdate({ content: 'Reading the REA catalogue…' });
            const tools = await backend.listTools();

            // An exact name means "show me the arguments", not "search".
            if (input.tool) {
              const wanted = input.tool.trim();
              const found = tools.find((tool) => tool.name === wanted);
              if (!found) {
                const suggestions = suggestReaTools(tools, wanted);
                return bad(
                  `No REA tool named "${wanted}".` +
                    (suggestions.length ? ` Closest: ${suggestions.join(', ')}.` : '') +
                    ' Use action=tools query=<words> to find the right name.',
                );
              }
              const schema = JSON.stringify(
                { name: found.name, description: found.description, inputSchema: found.inputSchema },
                null,
                2,
              );
              const clipped = truncateText(schema, REA_SCHEMA_LIMIT);
              return ok(
                clipped.truncated
                  ? `${clipped.text}\n\nThis tool needs a very large inline payload. Prefer a summary-level alternative where one exists.`
                  : clipped.text,
              );
            }

            const query = typeof input.query === 'string' ? input.query.trim() : '';
            if (query) {
              const matches = selectTools(tools, query, 20);
              if (matches.length === 0) {
                return ok(
                  `No REA tool matches "${query}" among ${tools.length} tools. ` +
                    'Try a broader word (decompile, apk, electron, firmware, packet, web) or call action=tools with no query for the entry points.',
                );
              }
              return ok(
                [
                  `${matches.length} of ${tools.length} REA tools for "${query}":`,
                  ...matches.map((tool) => summariseTool(tool)),
                  '',
                  'Next: action=tools tool=<name> for its schema, then action=call tool=<name> arguments={...}.',
                ].join('\n'),
              );
            }

            const start = REA_START_HERE.map((name) => tools.find((tool) => tool.name === name)).filter(
              (tool): tool is NonNullable<typeof tool> => Boolean(tool),
            );
            return ok(
              [
                `${tools.length} REA tools available. Common entry points:`,
                ...start.map((tool) => summariseTool(tool)),
                '',
                'Search all of them: action=tools query=<task words>. Schema: action=tools tool=<name>.',
                'Run: action=call tool=<name> arguments={...}. Use absolute paths.',
              ].join('\n'),
            );
          }

          case 'call': {
            const name = typeof input.tool === 'string' ? input.tool.trim() : '';
            if (!name) {
              return bad('call requires tool. Use action=tools query=<words> to find the name first.');
            }
            const payload = input.arguments ?? {};
            if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
              return bad('arguments must be a JSON object, not an array or a string.');
            }

            // Connect before validating so a typo gets the real catalogue
            // rather than a guess. The connection is reused for the call.
            ctx.onUpdate({ content: `Preparing REA for ${name}…` });
            const tools = await backend.listTools();
            if (!tools.some((tool) => tool.name === name)) {
              const suggestions = suggestReaTools(tools, name);
              return bad(
                `No REA tool named "${name}".` +
                  (suggestions.length ? ` Closest: ${suggestions.join(', ')}.` : '') +
                  ' Use action=tools query=<words> to find the right name.',
              );
            }

            const timeoutMs = typeof input.timeout_ms === 'number' ? input.timeout_ms : undefined;
            const result = await backend.call(name, payload, {
              timeoutMs,
              signal: ctx.abortSignal,
            });
            return result.isError ? bad(result.text) : ok(result.text);
          }

          default:
            return bad(
              `Unknown action "${action}". Use status, tools, call or install. ` +
                'Start with action=status if REA has never been used on this PC.',
            );
        }
      } catch (error) {
        // A thrown tool kills the turn, and a stack trace tells the model
        // nothing. The client's errors are already written for a human.
        return bad(error instanceof Error ? error.message : String(error));
      }
    },
  };
}

export const reaTool = createReaTool();
