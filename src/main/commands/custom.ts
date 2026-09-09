/**
 * Custom slash commands — the omp/Pi-style user extensibility layer.
 * Users define their own `/name` commands as Markdown files in
 * `<profile-home>/commands/*.md`:
 *
 *   ---
 *   name: review
 *   description: Review the staged diff like a senior engineer
 *   ---
 *   Review the output of `git diff --staged` below and be blunt.
 *   Extra focus: $ARGS
 *
 * `$ARGS` expands to everything typed after `/name`; `$1`..`$9` expand to
 * individual words. Files with invalid names are ignored (never executed as
 * code — the body is prompt text, rendered through the normal agent path).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { infiniteHome } from '../profiles/home.js';

export interface CustomCommand {
  name: string;
  description: string;
  template: string;
}

export const CUSTOM_COMMAND_LIMIT = 100;
export const CUSTOM_TEMPLATE_LIMIT = 8192;
const VALID_NAME = /^[a-z0-9][a-z0-9-_]{0,31}$/;

export function customCommandsDir(): string {
  return join(infiniteHome(), 'commands');
}

function safeFileFor(dir: string, file: string): string | null {
  if (file.includes('/') || file.includes('\\') || !file.endsWith('.md')) return null;
  const full = resolve(dir, file);
  if (full !== resolve(dir, basename(file))) return null;
  return full;
}

/** Parse one command file. Returns null for anything malformed (ignored, never throws). */
export function parseCommandFile(fileName: string, raw: string): CustomCommand | null {
  const fallbackName = fileName.replace(/\.md$/i, '').toLowerCase();
  let name = VALID_NAME.test(fallbackName) ? fallbackName : '';
  let description = '';
  let template = raw;
  const fm = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/.exec(raw);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      if (m[1].toLowerCase() === 'name') name = m[2].toLowerCase();
      else if (m[1].toLowerCase() === 'description') description = m[2];
    }
    template = fm[2];
  } else {
    // No frontmatter: first `# heading` or first non-empty line becomes the description.
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      const h = /^#\s+(.+)/.exec(t);
      description = (h ? h[1] : t).slice(0, 140);
      break;
    }
  }
  if (!VALID_NAME.test(name)) return null;
  template = template.trim().slice(0, CUSTOM_TEMPLATE_LIMIT);
  if (!template) return null;
  if (!description) description = `Custom command /${name}`;
  return { name, description: description.slice(0, 200), template };
}

export function listCustomCommands(): { dir: string; commands: CustomCommand[] } {
  const dir = customCommandsDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch { /* read-only home — fall through to empty */ }
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort();
  } catch {
    return { dir, commands: [] };
  }
  const commands: CustomCommand[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (commands.length >= CUSTOM_COMMAND_LIMIT) break;
    const full = safeFileFor(dir, file);
    if (!full || !existsSync(full)) continue;
    try {
      const parsed = parseCommandFile(file, readFileSync(full, 'utf8'));
      if (parsed && !seen.has(parsed.name)) {
        seen.add(parsed.name);
        commands.push(parsed);
      }
    } catch { /* one bad file never breaks the list */ }
  }
  return { dir, commands };
}

export function getCustomCommand(name: string): CustomCommand | null {
  const key = String(name ?? '').toLowerCase().trim();
  if (!VALID_NAME.test(key)) return null;
  return listCustomCommands().commands.find((c) => c.name === key) ?? null;
}

/** Expand $ARGS / $1..$9 in a template. Pure — exported for tests. */
export function expandTemplate(template: string, argString: string): string {
  const args = argString.trim();
  const words = args ? args.split(/\s+/) : [];
  return template
    .replace(/\$ARGS\b/g, args)
    .replace(/\$([1-9])\b/g, (_m, d) => words[Number(d) - 1] ?? '');
}

export function saveCustomCommand(name: string, description: string, template: string): { ok: boolean; error?: string } {
  const key = String(name ?? '').toLowerCase().trim();
  if (!VALID_NAME.test(key)) return { ok: false, error: 'Name must match [a-z0-9-_], max 32 chars' };
  const cleanTemplate = String(template ?? '').trim();
  if (!cleanTemplate) return { ok: false, error: 'Template is empty' };
  const dir = customCommandsDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${key}.md`),
      `---\nname: ${key}\ndescription: ${String(description ?? '').trim().slice(0, 200) || `Custom command /${key}`}\n---\n${cleanTemplate.slice(0, CUSTOM_TEMPLATE_LIMIT)}\n`,
      'utf8',
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
