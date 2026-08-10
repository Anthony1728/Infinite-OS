import { describe, expect, it } from 'vitest';
import { buildLocalModelOperatingPrompt, renderSkillsCatalog, renderStaticSystemPrompt } from './context.js';

describe('local model operating prompt', () => {
  const prompt = buildLocalModelOperatingPrompt({
    cwd: 'C:\\work\\infinite-os',
    model: 'minicpm-v4.6:latest',
    permissionProfile: ':full-system-access',
    toolsEnabled: true,
    availableToolNames: ['Computer', 'Operator', 'WebSearch', 'Read', 'Edit', 'Bash'],
    attachedToolNames: ['Computer', 'WebSearch'],
  });

  it('grounds the model in Infinite OS and its real environment', () => {
    expect(prompt).toContain('active local agent inside the Infinite OS Windows desktop application');
    expect(prompt).toContain('C:\\work\\infinite-os');
    expect(prompt).toContain('Ollama/minicpm-v4.6:latest');
    expect(prompt).toContain(':full-system-access');
    expect(prompt).toContain('6 real Infinite OS capabilities are available');
    expect(prompt).toContain('Executable tool schemas attached for this turn: Computer, WebSearch');
  });

  it('requires research instead of guessing and verified execution instead of narration', () => {
    expect(prompt).toContain('call WebSearch');
    expect(prompt).toContain('never guess');
    expect(prompt).toContain('call the narrowest real tool immediately');
    expect(prompt).toContain('VERIFY the requested outcome');
    expect(prompt).toContain('Completion requires evidence');
  });

  it('teaches reliable PC and coding tool routes', () => {
    expect(prompt).toContain('Computer visual_observe first');
    expect(prompt).toContain('browser_extension FIRST');
    expect(prompt).toContain('run targeted tests/typecheck/lint/build');
    expect(prompt).toContain('Use tool names and JSON arguments exactly as defined');
  });
});

describe('live capability manifest', () => {
  it('separates executable tools from registered capabilities and forbids invented execution', () => {
    const prompt = renderStaticSystemPrompt({
      permissionProfile: ':workspace',
      toolsEnabled: true,
      provider: 'openai',
      toolCatalog: [
        { name: 'Operator', description: 'Control Chrome through CDP.' },
        { name: 'Computer', description: 'Control the desktop.' },
        { name: 'Email', description: 'Use the configured mailbox.' },
      ],
      attachedToolNames: ['Operator', 'Computer'],
    });

    expect(prompt).toContain('Executable in this turn: Operator, Computer');
    expect(prompt).toContain('Registered but not attached to this model: Email');
    expect(prompt).toContain('Do not claim to have executed these tools');
    expect(prompt).toContain('Never manufacture positive feedback');
  });
});

describe('uncensored response mode', () => {
  it('applies a provider-independent direct style without changing safety or permissions', () => {
    const prompt = renderStaticSystemPrompt({
      permissionProfile: ':full-system-access',
      toolsEnabled: true,
      provider: 'openai',
      toolCatalog: [],
      attachedToolNames: [],
      uncensoredMode: true,
    });

    expect(prompt).toContain('Uncensored response mode: ON');
    expect(prompt).toContain('Be candid, direct');
    expect(prompt).toContain('Use maximum autonomy granted by the active permission profile');
    expect(prompt).toContain('not a permission or safety bypass');
  });

  it('teaches local models the same mode contract', () => {
    const prompt = buildLocalModelOperatingPrompt({
      cwd: 'C:\\work',
      model: 'local-model',
      permissionProfile: ':workspace',
      toolsEnabled: true,
      availableToolNames: [],
      attachedToolNames: [],
      uncensoredMode: true,
    });

    expect(prompt).toContain('UNCENSORED RESPONSE MODE IS ON');
    expect(prompt).toContain('use maximum autonomy within the active permission profile');
    expect(prompt).toContain('does not override tool permissions');
  });
});

describe('skills catalog (progressive disclosure)', () => {
  it('renders a compact catalog and explains how to load full skills', () => {
    const catalog = renderSkillsCatalog([
      { name: 'code-review', description: 'Review code systematically.', category: 'development' },
      { name: 'deep-research', description: 'Do thorough research.', category: 'research' },
    ]);

    expect(catalog).toContain('# Skills catalog (progressive disclosure)');
    expect(catalog).toContain('2 reusable skills are available');
    expect(catalog).toContain('- code-review — Review code systematically. [development]');
    expect(catalog).toContain('action=invoke');
    expect(catalog).toContain('SkillManage');
  });

  it('caps the catalog and mentions the remainder', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({ name: `skill-${i}`, description: 'd', category: 'c' }));
    const catalog = renderSkillsCatalog(many);
    expect(catalog).toContain('90 reusable skills are available');
    expect(catalog).toContain('... and 10 more');
  });

  it('returns an empty string for no skills', () => {
    expect(renderSkillsCatalog([])).toBe('');
  });
});
