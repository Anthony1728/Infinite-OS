import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// `intelligence.ts` imports the Electron main entry point for its improvement
// engine. Loading that inside a test would start the app, so the three modules
// it reaches for are stubbed here and only the Ollama probe is observed.
const probe = vi.hoisted(() => vi.fn(async () => true));

vi.mock('../index.js', () => ({ improvement: {} }));
vi.mock('../brain/core.js', () => ({ getBrain: () => ({ getModelPerformance: () => [] }) }));
vi.mock('../ollama/brain.js', () => ({ getOllamaBrain: () => ({ isAvailable: probe }) }));

const { IntelligenceEngine } = await import('./intelligence.js');

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'infinite-os-engine-test-'));
  probe.mockClear();
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('IntelligenceEngine.initialize', () => {
  it('probes Ollama once even when boot starts it from two places', async () => {
    const engine = new IntelligenceEngine({ dataDir });

    // Boot calls this from the model warm-up and from the startup log within
    // the same tick; each call used to fire its own live HTTP probe.
    await Promise.all([engine.initialize(), engine.initialize()]);

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('re-detects on a later call so a newly started Ollama is noticed', async () => {
    const engine = new IntelligenceEngine({ dataDir });

    await engine.initialize();
    await engine.initialize();

    expect(probe).toHaveBeenCalledTimes(2);
  });
});
