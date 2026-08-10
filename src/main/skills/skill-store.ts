// SKILL.md file store — the agentskills.io-compatible format used by
// Hermes Agent (~/.hermes/skills/<name>/SKILL.md) and OpenClaw.
// Each skill lives in its own directory: <base>/<slug>/SKILL.md.
// Frontmatter holds metadata; the markdown body is the procedural instructions.

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SkillFile {
  name: string; // directory slug
  frontmatter: Record<string, unknown>;
  instructions: string;
  path: string;
}

/** Convert a display name into a safe directory slug: lowercase [a-z0-9-]. */
export function slugifySkillName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!slug) throw new Error(`Invalid skill name: "${name}"`);
  return slug;
}

/** Guard against path traversal and absolute paths before touching disk. */
export function safeSkillDir(baseDir: string, name: string): string {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`Unsafe skill name: "${name}"`);
  }
  const dir = join(baseDir, name);
  const base = baseDir.endsWith('/') || baseDir.endsWith('\\') ? baseDir : baseDir + '/';
  if (!dir.replace(/\\/g, '/').startsWith(base.replace(/\\/g, '/'))) {
    throw new Error(`Skill directory escapes base: "${name}"`);
  }
  return dir;
}

function parseScalar(line: string): string {
  const value = line.slice(line.indexOf(':') + 1).trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse a SKILL.md file. Frontmatter is a minimal YAML subset:
 * `key: value` scalars and `key:` blocks of `- item` list entries.
 * Everything after the closing `---` is the instructions body.
 */
export function parseSkillMarkdown(content: string, path: string): SkillFile {
  const lines = content.split(/\r?\n/);
  const frontmatter: Record<string, unknown> = {};
  let instructions = '';

  if (lines[0]?.trim() === '---') {
    let index = 1;
    let key = '';
    for (; index < lines.length; index++) {
      const line = lines[index];
      if (line.trim() === '---') {
        index++;
        break;
      }
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^\s*-\s+/.test(line) && key) {
        const item = trimmed.replace(/^-\s*/, '').replace(/^["']|["']$/g, '');
        const current = frontmatter[key];
        frontmatter[key] = Array.isArray(current) ? [...current, item] : [item];
        continue;
      }
      const colon = line.indexOf(':');
      if (colon > 0) {
        key = line.slice(0, colon).trim();
        frontmatter[key] = parseScalar(line);
      }
    }
    instructions = lines.slice(index).join('\n').trim();
  } else {
    instructions = content.trim();
  }

  return { name: String(frontmatter.name ?? ''), frontmatter, instructions, path };
}

/** Render a skill back to SKILL.md format (round-trips through parseSkillMarkdown). */
export function renderSkillMarkdown(input: {
  name: string;
  description: string;
  id?: string;
  source?: string;
  category?: string;
  enabled?: boolean;
  created?: number;
  updated?: number;
  tools?: string[];
  triggers?: string[];
  examples?: string[];
  instructions: string;
}): string {
  const lines = ['---', `name: ${input.name}`];
  if (input.id) lines.push(`id: ${input.id}`);
  if (input.source) lines.push(`source: ${input.source}`);
  lines.push(`description: ${String(input.description).replace(/\r?\n/g, ' ').replace(/["']/g, '')}`);
  if (input.category) lines.push(`category: ${input.category}`);
  if (input.enabled !== undefined) lines.push(`enabled: ${input.enabled}`);
  if (input.created !== undefined) lines.push(`created: ${input.created}`);
  if (input.updated !== undefined) lines.push(`updated: ${input.updated}`);
  if (input.tools?.length) {
    lines.push('tools:');
    for (const t of input.tools) lines.push(`  - ${t}`);
  }
  if (input.triggers?.length) {
    lines.push('triggers:');
    for (const t of input.triggers) lines.push(`  - ${t}`);
  }
  if (input.examples?.length) {
    lines.push('examples:');
    for (const e of input.examples) lines.push(`  - ${String(e).replace(/\r?\n/g, ' ')}`);
  }
  lines.push('---', '', input.instructions.trim(), '');
  return lines.join('\n');
}

/**
 * Low-level SKILL.md store rooted at one directory (personal, workspace, ...).
 * Reads are always fresh from disk so external edits are picked up.
 */
export class SkillFileStore {
  constructor(readonly baseDir: string) {}

  /** Scan `<baseDir>/<slug>/SKILL.md` for every skill. */
  list(): SkillFile[] {
    if (!existsSync(this.baseDir)) return [];
    const out: SkillFile[] = [];
    for (const entry of readdirSync(this.baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(this.baseDir, entry.name, 'SKILL.md');
      if (!existsSync(path)) continue;
      try {
        out.push(parseSkillMarkdown(readFileSync(path, 'utf8'), path));
      } catch { /* skip unreadable skill */ }
    }
    return out;
  }

  read(name: string): SkillFile | null {
    const dir = safeSkillDir(this.baseDir, slugifySkillName(name));
    const path = join(dir, 'SKILL.md');
    if (!existsSync(path)) return null;
    return parseSkillMarkdown(readFileSync(path, 'utf8'), path);
  }

  /** Write a skill atomically (tmp file + rename), creating the directory. */
  write(input: Parameters<typeof renderSkillMarkdown>[0]): string {
    const dir = safeSkillDir(this.baseDir, slugifySkillName(input.name));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'SKILL.md');
    const tmp = join(dir, `.SKILL.md.tmp-${process.pid}`);
    writeFileSync(tmp, renderSkillMarkdown(input), 'utf8');
    renameSync(tmp, path);
    return path;
  }

  /** Delete a skill directory (and any sidecar files). */
  remove(name: string): boolean {
    const dir = safeSkillDir(this.baseDir, slugifySkillName(name));
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /** True when the store contains at least one SKILL.md directory. */
  hasAny(): boolean {
    return this.list().length > 0;
  }

  /** Rename a file inside the base (used for one-time manifest migration). */
  moveManifestTo(relative: string, target: string): void {
    const source = join(this.baseDir, relative);
    const destination = join(this.baseDir, target);
    if (existsSync(source) && !existsSync(destination)) {
      renameSync(source, destination);
    }
  }
}
