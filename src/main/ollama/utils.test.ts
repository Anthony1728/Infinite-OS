import { describe, it, expect } from 'vitest';
import { resolveOllamaModel } from './utils.js';
import { selectInstalledModel, type LocalHardwareProfile } from '../brain/hardware.js';

const profile = (sizes: string[]): LocalHardwareProfile => ({
  platform: 'win32',
  architecture: 'x64',
  cpuModel: 'Test CPU',
  logicalCores: 8,
  totalRamGb: 16,
  freeRamGb: 8,
  gpuNames: [],
  integratedGraphics: true,
  tier: 'balanced',
  contextSize: 8192,
  threads: 7,
  gpuLayers: 12,
  preferredModelSizes: sizes,
});

describe('resolveOllamaModel', () => {
  it('returns the requested model when installed', () => {
    expect(resolveOllamaModel('qwen3:4b', ['qwen3:4b'])).toBe('qwen3:4b');
  });

  it('reroutes a stale request (minicpm) to the installed model', () => {
    expect(resolveOllamaModel('minicpm-v4.6:latest', ['qwen3:4b'])).toBe('qwen3:4b');
  });

  it('matches by size tier when the family is gone', () => {
    expect(resolveOllamaModel('qwen2.5:3b', ['llama3.2:3b', 'qwen3:4b'])).toBe('llama3.2:3b');
  });

  it('falls back to the first installed model rather than a 404', () => {
    expect(resolveOllamaModel('nothing:99b', ['qwen3:4b'])).toBe('qwen3:4b');
  });

  it('returns empty only when nothing is installed', () => {
    expect(resolveOllamaModel('', [])).toBe('');
  });
});

describe('selectInstalledModel fallback', () => {
  it('never returns empty when a model is installed (minimal tier + 4b model)', () => {
    const minimal = { ...profile(['3b', '2b', '1b']), tier: 'minimal' as const };
    expect(selectInstalledModel(['qwen3:4b'], minimal)).toBe('qwen3:4b');
  });
});
