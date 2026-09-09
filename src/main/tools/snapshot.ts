/**
 * Snapshot — versioned restore points for Infinite OS self-edits.
 * Every Write/Edit inside the repo already snapshots the pre-edit content
 * automatically (see snapshots.ts); this tool lists those versions, restores
 * them in one action, and prunes old ones. Restore is permission-gated like
 * any state-changing tool (auto-allowed in full system access / exec --yes).
 */
import type { Tool, ToolContext, ToolResult } from './base.js';
import { findInfiniteRepoRoot } from './backup.js';
import { listSnapshots, restoreSnapshot, pruneSnapshots } from './snapshots.js';

export const snapshotTool: Tool = {
  name: 'Snapshot',
  description:
    'List and restore versioned snapshots of Infinite OS self-edits. Every agent Write/Edit inside the repo is auto-snapshotted per session — list shows the versions (newest first with file lists), restore rolls files back to a version, prune drops old ones. Use restore when an edit broke something and re-verifying is slower than rolling back.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'restore', 'prune', 'status'], description: 'list versions, restore one, prune old ones, or show the latest' },
      session: { type: 'string', description: 'Session id to restore (see list)' },
      files: { type: 'array', items: { type: 'string' }, description: 'Restore only these repo-relative paths (default: whole version)' },
      maxAgeDays: { type: 'number', description: 'prune: drop versions older than this (default 14, 10 newest always kept)' },
    },
    required: ['action'],
  },
  permission: 'ask',

  async execute(args, ctx: ToolContext): Promise<ToolResult> {
    const input = (args ?? {}) as { action?: string; session?: string; files?: string[]; maxAgeDays?: number };
    const repoRoot = findInfiniteRepoRoot(ctx.cwd);
    if (!repoRoot) {
      return { content: 'Snapshots only exist inside the Infinite OS repo (no infinite-ai package.json above this cwd).', is_error: true };
    }
    try {
      if (input.action === 'list' || input.action === 'status') {
        const snapshots = await listSnapshots(repoRoot);
        if (input.action === 'status') {
          const latest = snapshots[0];
          return { content: latest ? `Latest snapshot: ${latest.sessionId} (${new Date(latest.createdAt).toISOString()}, ${latest.files.length} files)` : 'No snapshots yet.' };
        }
        if (snapshots.length === 0) return { content: 'No snapshots yet. They are created automatically on the next repo edit.' };
        const lines = snapshots.slice(0, 20).map(
          (s) => `- ${s.sessionId} · ${new Date(s.createdAt).toISOString()} · ${s.files.length} files${s.files.length ? `: ${s.files.slice(0, 8).join(', ')}${s.files.length > 8 ? ` +${s.files.length - 8} more` : ''}` : ''}`,
        );
        return { content: `Snapshots (newest first):\n${lines.join('\n')}` };
      }
      if (input.action === 'restore') {
        if (!input.session) return { content: 'restore requires a session id (see list).', is_error: true };
        const { restored, missing } = await restoreSnapshot(repoRoot, input.session, input.files);
        const lines = [`Restored ${restored.length} file(s) from ${input.session}.`];
        if (restored.length) lines.push(`Files: ${restored.join(', ')}`);
        if (missing.length) lines.push(`Missing: ${missing.join(', ')}`);
        lines.push('Re-run Verify/typecheck after a restore before claiming success.');
        return { content: lines.join('\n'), is_error: restored.length === 0 };
      }
      if (input.action === 'prune') {
        const removed = await pruneSnapshots(repoRoot, input.maxAgeDays ?? 14);
        return { content: `Pruned ${removed} old snapshot(s).` };
      }
      return { content: `Unknown Snapshot action: ${input.action}`, is_error: true };
    } catch (e) {
      return { content: `Snapshot failed: ${(e as Error).message}`, is_error: true };
    }
  },
};
