import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebsiteBuilder } from './website.js';

function freshDirs(): { dataDir: string; outputDir: string } {
  const base = mkdtempSync(join(tmpdir(), 'websites-'));
  return { dataDir: join(base, 'data'), outputDir: join(base, 'output') };
}

describe('website outputPath', () => {
  it('records the folder on generate and lists it after restart', () => {
    const { dataDir, outputDir } = freshDirs();
    try {
      const first = new WebsiteBuilder({ dataDir, outputDir });
      const site = first.createWebsite({ name: 'Acme Site', framework: 'html' });
      expect(site.outputPath).toBeUndefined();
      const files = first.generateFiles(site.id);
      expect(files.length).toBeGreaterThan(0);
      expect(existsSync(join(outputDir, 'acme-site', 'index.html'))).toBe(true);

      const second = new WebsiteBuilder({ dataDir, outputDir });
      const listed = second.listWebsites();
      expect(listed).toHaveLength(1);
      expect(listed[0].outputPath).toBe(join(outputDir, 'acme-site'));
    } finally {
      rmSync(join(dataDir, '..'), { recursive: true, force: true });
    }
  });
});
