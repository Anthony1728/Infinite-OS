// Verifies the refined checkToolRegistry heuristic against the actual registry source.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const content = readFileSync(join(root, 'src', 'main', 'tools', 'registry.ts'), 'utf-8');

// Replicate the refined heuristic from self-improvement.ts
const nonToolImports = new Set(['toolRegistry', 'ToolRegistry']);
const importBlockMatches = [...content.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]\.\/[^'"]+\.js['"]/g)];
const importedTools = new Set();
for (const m of importBlockMatches) {
  for (const raw of m[1].split(',')) {
    const spec = raw.trim();
    if (!spec) continue;
    const localName = spec.includes(' as ') ? spec.split(' as ')[1].trim() : spec;
    if (!nonToolImports.has(localName)) importedTools.add(localName);
  }
}

const loopMatch = content.match(/for\s*\(\s*const\s+\w+\s+of\s*\[([\s\S]*?)\]\s*\)/);
const registeredTools = new Set();
if (loopMatch) {
  const listWithoutComments = loopMatch[1].replace(/\/\/.*$/gm, '');
  for (const raw of listWithoutComments.split(',')) {
    const name = raw.trim();
    if (name && !name.startsWith('//')) registeredTools.add(name);
  }
}

const toolImports = importedTools.size;
const toolRegistrations = registeredTools.size;
const unregistered = [...importedTools].filter((t) => !registeredTools.has(t));

console.log('Imported tool identifiers:', toolImports);
console.log('Registered tool identifiers:', toolRegistrations);
console.log('Unregistered:', unregistered.length ? unregistered.join(', ') : '(none)');
console.log('Match:', toolImports === toolRegistrations && unregistered.length === 0 ? 'YES' : 'NO');
if (toolImports !== toolRegistrations || unregistered.length > 0) process.exitCode = 1;
