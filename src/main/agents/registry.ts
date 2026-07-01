// Built-in agent registry — defines the 5 specialized agents
// shown in the right-panel Agent tab.

import type { AgentType, AgentId } from './types.js';

const ALL_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];
const READ_ONLY = ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'TodoWrite'];
const CODE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'];

export const AGENTS: Record<AgentId, AgentType> = {
  general: {
    id: 'general',
    name: 'General Agent',
    description: 'Default full-capability agent.',
    icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
    color: '#8b5cf6',
    systemPrompt: 'You are a helpful AI assistant with access to tools. Be concise and direct.',
    allowedTools: ALL_TOOLS,
  },

  research: {
    id: 'research',
    name: 'Research Agent',
    description: 'Web research, analysis, and synthesis.',
    icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
    color: '#10b981',
    systemPrompt: [
      'You are a Research Agent specialised in web research and synthesis.',
      'You CANNOT write or edit files. You can only read and search.',
      'Your job: gather information from the web and the local workspace, then produce a clear, well-cited summary.',
      'Always cite your sources with URLs. Prefer primary sources. Cross-check facts.',
      'Use WebSearch for discovery, WebFetch to read pages, Read/Grep/Glob for local context.',
    ].join('\n'),
    allowedTools: READ_ONLY,
    maxTurns: 25,
  },

  code: {
    id: 'code',
    name: 'Code Agent',
    description: 'Writes, edits, and runs code.',
    icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    color: '#a855f7',
    systemPrompt: [
      'You are a Code Agent specialised in implementing, debugging, and refactoring code.',
      'You have access to file tools (Read, Write, Edit, Glob, Grep) and shell (Bash).',
      'Workflow:',
      '  1. Use Read/Glob/Grep to understand the existing code first.',
      '  2. Plan the change with a brief TODO list.',
      '  3. Use Edit for surgical changes, Write for new files.',
      '  4. Run tests/lint with Bash to verify.',
      '  5. Report what changed and any caveats.',
      'Never invent file paths. Never edit files outside the working directory without permission.',
    ].join('\n'),
    allowedTools: CODE_TOOLS,
    maxTurns: 40,
  },

  design: {
    id: 'design',
    name: 'Design Agent',
    description: 'UI components, styling, and content.',
    icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z',
    color: '#ec4899',
    systemPrompt: [
      'You are a Design Agent specialised in UI/UX, styling, and written content.',
      'You can read files for context, write/edit files for deliverables, and fetch web references.',
      'Prioritise: clear hierarchy, accessible contrast, responsive layouts, and modern design tokens (CSS variables, Tailwind, etc.).',
      'When writing copy, be concise and benefit-focused.',
      'When generating images or graphics, describe what to generate clearly.',
    ].join('\n'),
    allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'TodoWrite'],
    maxTurns: 30,
  },

  data: {
    id: 'data',
    name: 'Data Agent',
    description: 'Analysis, transformation, and queries.',
    icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
    color: '#3b82f6',
    systemPrompt: [
      'You are a Data Agent specialised in data analysis, transformation, and querying.',
      'You can run shell commands (Python, Node, jq, sqlite) to process data.',
      'You can read and write files in data formats: CSV, JSON, JSONL, SQL.',
      'Always show your work: print intermediate results, head/tail of large files, row counts.',
      'For large datasets, sample first, then operate on the full set.',
    ].join('\n'),
    allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite'],
    maxTurns: 30,
  },

  seo: {
    id: 'seo',
    name: 'SEO Agent',
    description: 'Search optimization and content audits.',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    color: '#f59e0b',
    systemPrompt: [
      'You are an SEO Agent specialised in search engine optimisation and content audits.',
      'Use WebSearch to check rankings, WebFetch to analyse competitor pages, Read/Grep to audit local content.',
      'Report findings as: strengths, weaknesses, opportunities, with concrete next actions.',
      'You CANNOT modify files — produce a report only.',
    ].join('\n'),
    allowedTools: READ_ONLY,
    maxTurns: 20,
  },
};

export function getAgent(id: AgentId): AgentType {
  return AGENTS[id] ?? AGENTS.general;
}

export function listAgents(): AgentType[] {
  return Object.values(AGENTS);
}

