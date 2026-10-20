import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  firstSentence,
  isNodeSupported,
  REA_SCHEMA_LIMIT,
  readInstalledReaVersion,
  reaRoot,
  reaScriptPath,
  requiredParams,
  selectTools,
  suggestReaTools,
  summariseTool,
  truncateText,
  type ReaToolInfo,
} from './client.js';

const tool = (name: string, description: string, required: string[] = []): ReaToolInfo => ({
  name,
  description,
  inputSchema: { type: 'object', properties: {}, ...(required.length ? { required } : {}) },
});

const catalogue: ReaToolInfo[] = [
  tool('open_binary', 'Open a binary target and start an analysis session. Returns a session id.', ['path']),
  tool('binary_overview', 'Summarize the open target: sections, imports and entry points.'),
  tool('procedure_pseudo_code', 'Decompile one procedure to pseudo-code for review.', ['procedure']),
  tool('search_strings', 'Search decoded strings in the open target.'),
  tool('inspect_android_package', 'Inspect an APK manifest and DEX structure.'),
];

describe('REA node support', () => {
  it('follows the upstream engines range exactly', () => {
    expect(isNodeSupported('v22.18.0')).toBe(false);
    expect(isNodeSupported('v22.19.0')).toBe(true);
    expect(isNodeSupported('v22.21.1')).toBe(true);
    expect(isNodeSupported('v24.1.0')).toBe(false);
    expect(isNodeSupported('v24.11.0')).toBe(true);
    expect(isNodeSupported('v25.9.0')).toBe(false);
    expect(isNodeSupported('v26.0.0')).toBe(true);
    expect(isNodeSupported('nonsense')).toBe(false);
  });
});

describe('REA catalogue helpers', () => {
  it('clips to the first sentence without cutting mid-word', () => {
    expect(firstSentence('  Open a binary. Then inspect it.  ')).toBe('Open a binary.');
    const clipped = firstSentence('x'.repeat(400), 20);
    expect(clipped.length).toBe(20);
    expect(clipped.endsWith('…')).toBe(true);
  });

  it('keeps only string entries from a schema required list', () => {
    expect(requiredParams({ required: ['path', 3, null, 'offset'] })).toEqual(['path', 'offset']);
    expect(requiredParams({})).toEqual([]);
  });

  it('shows required parameters so the model knows what to pass', () => {
    expect(summariseTool(catalogue[0])).toContain('open_binary');
    expect(summariseTool(catalogue[0])).toContain('requires: path');
    expect(summariseTool(catalogue[1])).not.toContain('requires:');
  });

  it('ranks an exact name above a description-only match', () => {
    const byName = selectTools(catalogue, 'open_binary');
    expect(byName[0].name).toBe('open_binary');

    const byDescription = selectTools(catalogue, 'decompile');
    expect(byDescription.map((t) => t.name)).toEqual(['procedure_pseudo_code']);
  });

  it('returns nothing for an empty query and respects the limit', () => {
    expect(selectTools(catalogue, '   ')).toEqual([]);
    expect(selectTools(catalogue, 'inspect', 1)).toHaveLength(1);
  });

  it('suggests real names for a typo', () => {
    expect(suggestReaTools(catalogue, 'open_binry')).toContain('open_binary');
    expect(suggestReaTools(catalogue, 'zzzz')).toContain('open_binary');
  });

  it('truncates oversized output with an actionable note', () => {
    const short = truncateText('small');
    expect(short).toEqual({ text: 'small', truncated: false });

    const long = truncateText('a'.repeat(50), 10);
    expect(long.truncated).toBe(true);
    expect(long.text).toContain('truncated 40 characters');
    expect(long.text).toContain('detail=summary');
  });
});

describe('REA install paths', () => {
  it('resolves the pinned script inside the profile folder', () => {
    const root = reaRoot();
    expect(reaScriptPath(root)).toBe(join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'));
    expect(REA_SCHEMA_LIMIT).toBe(12_000);
  });

  it('reports null when nothing has been installed', () => {
    expect(readInstalledReaVersion(`${process.cwd()}\\__no_rea_here__`)).toBeNull();
  });
});
