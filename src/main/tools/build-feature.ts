import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { getCheckpointManager } from '../checkpoint/manager.js';
import { applySelfEdit } from '../self-apply.js';
import { guardSelfModification } from '../agent/self-modification.js';
import { findInfiniteRepoRoot } from './backup.js';
import type { Tool, ToolResult } from './base.js';

interface FeatureChange {
  path: string;
  content?: string;
  old_text?: string;
  new_text?: string;
  replace_all?: boolean;
}

interface PreparedChange {
  path: string;
  absolutePath: string;
  originalContent?: string;
  newContent: string;
  operation: 'create' | 'modify';
}

const MAX_FILES = 40;
const MAX_FILE_BYTES = 1_500_000;

/**
 * Make the edit actually take effect.
 *
 * Without this, a feature the agent just built sits inert. The packaged app runs
 * a prebuilt renderer, so a new component or theme gets written to disk and is
 * never shown until someone restarts Infinite OS by hand. This tool used to end
 * with "Restart or reload the application if the changed feature is not
 * hot-reloaded" — which is exactly the complaint that self-extension does not
 * feel connected to anything.
 *
 * Dev needs nothing: HMR is already live. A packaged build rebuilds and
 * relaunches. An installed build with no checkout has nothing to rebuild, and
 * says so rather than pretending.
 *
 * Relaunching is completing an action the user already consented to —
 * `BuildFeature` requires explicit permission before it writes anything — so it
 * is not a new decision, only the last step of the one already made.
 */
async function applyStep(repoRoot: string | null): Promise<string> {
  try {
    // Read the real packaged flag from electron rather than guessing from an
    // environment variable that nothing sets. Getting this wrong means either
    // rebuilding needlessly in dev or silently not applying in a packaged
    // build — which is the failure this whole step exists to prevent.
    let isPackaged = false;
    try {
      const { app } = await import('electron');
      isPackaged = Boolean(app?.isPackaged);
    } catch {
      // Headless (tests, exec): treat as not packaged, which takes the
      // hot-reload branch and changes nothing.
    }
    const result = await applySelfEdit({ isPackaged, repoRoot });
    return result.applied
      ? 'Rebuilt and relaunched — the change is live now.'
      : result.message;
  } catch (error) {
    // The code is written and already passed validation. Failing to *apply* it
    // is not a failed build, so this must not roll anything back or report
    // is_error — that would discard good work over a restart problem.
    return (
      'The change is saved and validated but could not be applied automatically: ' +
      `${(error as Error).message}. Restart Infinite OS to load it.`
    );
  }
}

export const buildFeatureTool: Tool = {
  name: 'BuildFeature',
  description: [
    'Atomically add, fix, or improve any feature in Infinite OS itself or the current workspace.',
    'This is your primary self-improvement tool: use it whenever the user says "improve Infinite OS", "add a feature", "fix this", "make it better", or asks for a capability that does not exist yet.',
    'It creates and modifies files, UI components and tools, with automatic rollback checkpoints, workspace sandboxing and typecheck/test/build validation.',
    'A successful build applies itself (dev: hot reload; packaged: rebuild and relaunch) — report what the apply step said instead of telling the user to restart the app.',
    'Inspect the code first, then use BuildFeature instead of separate Write/Edit for any multi-file or UI change.',
    'If you still cannot do it, create a Tab explaining the next step and add the missing capability with BuildFeature.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short feature name' },
      description: { type: 'string', description: 'What the feature adds and why' },
      changes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FILES,
        description:
          'Atomic code changes. Supply content for a full write, or old_text and new_text for an exact edit.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to the workspace' },
            content: { type: 'string', description: 'Complete new file content' },
            old_text: { type: 'string', description: 'Exact existing text to replace' },
            new_text: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', default: false },
          },
          required: ['path'],
        },
      },
      validation: {
        type: 'string',
        enum: ['typecheck', 'test', 'build', 'none'],
        default: 'typecheck',
        description: 'Safe validation command to run after applying the feature',
      },
    },
    required: ['name', 'description', 'changes'],
  },
  permission: 'ask',

  async execute(args, ctx): Promise<ToolResult> {
    const input = args as {
      name: string;
      description: string;
      changes: FeatureChange[];
      validation?: 'typecheck' | 'test' | 'build' | 'none';
    };

    if (!input.name?.trim() || !input.description?.trim()) {
      return { content: 'Feature name and description are required.', is_error: true };
    }
    if (!Array.isArray(input.changes) || input.changes.length === 0 || input.changes.length > MAX_FILES) {
      return { content: `A feature must contain between 1 and ${MAX_FILES} file changes.`, is_error: true };
    }

    try {
      const prepared = await prepareChanges(ctx.cwd, input.changes);
      const taskId = `feature:${Date.now()}:${input.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 48)}`;
      const checkpoint = getCheckpointManager().create({
        taskId,
        name: `Before: ${input.name.trim()}`,
        description: input.description.trim(),
        state: {
          status: 'pending',
          progress: 0,
          currentStep: 0,
          totalSteps: prepared.length + 1,
          cwd: resolve(ctx.cwd),
          history: [],
          variables: { featureName: input.name.trim(), validation: input.validation ?? 'typecheck' },
          modifiedFiles: prepared.map((change) => ({
            path: change.absolutePath,
            originalContent: change.originalContent,
            newContent: change.newContent,
            operation: change.operation,
          })),
        },
        metadata: { kind: 'feature-build', files: prepared.map((change) => change.path) },
      });

      try {
        // Checked BEFORE anything is written, not per file inside the loop.
        // Validating as it goes would leave a half-applied feature when the
        // guard trips on the third file, which is worse than refusing the whole
        // build up front.
        // `?? ctx.cwd` matters: without it, a build started from the repo root
        // found no repo root and skipped the guard entirely — which is the
        // case the guard exists for.
        const repoRootForGuard = findInfiniteRepoRoot(ctx.cwd) ?? ctx.cwd;
        {
          for (const change of prepared) {
            const operation = existsSync(change.absolutePath) ? 'modify' : 'create';
            const guard = guardSelfModification(repoRootForGuard, change.absolutePath, operation);
            if (!guard.allowed) {
              return {
                content:
                  `Feature "${input.name}" was not applied: it would change a protected file.\n\n` +
                  `${guard.reason ?? ''}\n\n` +
                  `Files in this change: ${prepared.map((c) => c.path).join(', ')}\n` +
                  'Nothing was written. Split the change, or turn self-protection off in Settings if you mean to do this.',
                is_error: true,
              };
            }
          }
        }

        for (const change of prepared) {
          if (ctx.abortSignal.aborted) throw new Error('Feature build cancelled before completion.');
          await mkdir(dirname(change.absolutePath), { recursive: true });
          await writeFile(change.absolutePath, change.newContent, 'utf8');
          ctx.onUpdate({ content: `Applied ${change.path}` });
        }
      } catch (error) {
        const rollback = getCheckpointManager().rollback(checkpoint.id);
        return {
          content: [
            `Feature "${input.name}" could not be applied and was rolled back.`,
            (error as Error).message,
            ...(rollback.rollbackActions ?? []),
          ].join('\n\n'),
          is_error: true,
        };
      }

      const validation = input.validation ?? 'typecheck';
      const validationResult = await validateFeature(ctx.cwd, validation, ctx.abortSignal);
      if (!validationResult.ok) {
        const rollback = getCheckpointManager().rollback(checkpoint.id);
        return {
          content: [
            `Feature "${input.name}" did not pass ${validation} validation and was rolled back.`,
            validationResult.output,
            `Checkpoint: ${checkpoint.id}`,
            ...(rollback.rollbackActions ?? []),
          ].join('\n\n'),
          is_error: true,
        };
      }

      // Applied before the summary is returned, so the user is told the
      // truth about whether their feature is live yet rather than being told
      // to go and restart the app themselves.
      const applyNote = await applyStep(findInfiniteRepoRoot(ctx.cwd));

      return {
        content: [
          `Feature "${input.name}" was baked into the workspace successfully.`,
          `Changed ${prepared.length} file${prepared.length === 1 ? '' : 's'}: ${prepared.map((change) => change.path).join(', ')}`,
          validation === 'none' ? 'Validation was skipped.' : `${validation} validation passed.`,
          `Rollback checkpoint: ${checkpoint.id}`,
          applyNote,
        ].join('\n\n'),
      };
    } catch (error) {
      return { content: `Feature build failed before completion: ${(error as Error).message}`, is_error: true };
    }
  },
};

export const rollbackFeatureTool: Tool = {
  name: 'RollbackFeature',
  description:
    'Restore files from a BuildFeature rollback checkpoint. Use when the user asks to undo a generated feature.',
  inputSchema: {
    type: 'object',
    properties: { checkpoint_id: { type: 'string', description: 'Checkpoint ID returned by BuildFeature' } },
    required: ['checkpoint_id'],
  },
  permission: 'ask',
  async execute(args): Promise<ToolResult> {
    const { checkpoint_id } = args as { checkpoint_id: string };
    const result = getCheckpointManager().rollback(checkpoint_id);
    if (!result.success) return { content: result.error ?? 'Rollback failed.', is_error: true };
    return { content: `Feature rolled back successfully.\n${(result.rollbackActions ?? []).join('\n')}` };
  },
};

async function prepareChanges(cwd: string, changes: FeatureChange[]): Promise<PreparedChange[]> {
  const root = resolve(cwd);
  const canonicalRoot = realpathSync(root);
  const seen = new Set<string>();
  const prepared: PreparedChange[] = [];

  for (const change of changes) {
    if (!change.path?.trim()) throw new Error('Every change requires a path.');
    const absolutePath = resolve(root, change.path);
    const relativePath = relative(root, absolutePath);
    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)
    ) {
      throw new Error(`Path is outside the workspace: ${change.path}`);
    }
    let existingAncestor = absolutePath;
    while (!existsSync(existingAncestor)) {
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) break;
      existingAncestor = parent;
    }
    const canonicalAncestor = realpathSync(existingAncestor);
    const canonicalRelative = relative(canonicalRoot, canonicalAncestor);
    if (canonicalRelative.startsWith('..')) {
      throw new Error(`Path resolves outside the workspace through a linked directory: ${change.path}`);
    }
    if (seen.has(absolutePath)) throw new Error(`Duplicate file change: ${change.path}`);
    seen.add(absolutePath);

    const originalContent = existsSync(absolutePath) ? await readFile(absolutePath, 'utf8') : undefined;
    let newContent: string;
    if (typeof change.content === 'string') {
      newContent = change.content;
    } else if (typeof change.old_text === 'string' && typeof change.new_text === 'string') {
      if (originalContent === undefined) throw new Error(`Cannot edit a file that does not exist: ${change.path}`);
      const occurrences = originalContent.split(change.old_text).length - 1;
      if (occurrences === 0) throw new Error(`Edit text was not found in ${change.path}`);
      if (occurrences > 1 && !change.replace_all) {
        throw new Error(
          `Edit text occurs ${occurrences} times in ${change.path}; provide more context or set replace_all.`,
        );
      }
      newContent = change.replace_all
        ? originalContent.split(change.old_text).join(change.new_text)
        : originalContent.replace(change.old_text, change.new_text);
    } else {
      throw new Error(`Change for ${change.path} needs content or old_text/new_text.`);
    }
    if (Buffer.byteLength(newContent, 'utf8') > MAX_FILE_BYTES)
      throw new Error(`${change.path} exceeds the file size limit.`);
    prepared.push({
      path: relativePath.replace(/\\/g, '/'),
      absolutePath,
      originalContent,
      newContent,
      operation: originalContent === undefined ? 'create' : 'modify',
    });
  }
  return prepared;
}

async function validateFeature(
  cwd: string,
  validation: 'typecheck' | 'test' | 'build' | 'none',
  signal: AbortSignal,
): Promise<{ ok: boolean; output: string }> {
  if (validation === 'none') return { ok: true, output: '' };
  const packagePath = resolve(cwd, 'package.json');
  const scripts = existsSync(packagePath)
    ? ((JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {})
    : {};
  const command = scripts[validation]
    ? `npm run ${validation}`
    : validation === 'typecheck'
      ? 'npx tsc --noEmit'
      : null;
  if (!command) return { ok: false, output: `No ${validation} script exists in package.json.` };

  return new Promise((done) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true, signal });
    let output = '';
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timeout = setTimeout(() => child.kill(), 120_000);
    child.on('error', (error) => {
      clearTimeout(timeout);
      done({ ok: false, output: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      done({ ok: code === 0, output: output.trim() });
    });
  });
}
