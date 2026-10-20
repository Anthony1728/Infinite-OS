import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebsiteBuilder } from './website.js';

describe('website generate quality', () => {
  it('renders template features as text instead of undefined', () => {
    const base = mkdtempSync(join(tmpdir(), 'websites-'));
    const dataDir = join(base, 'data');
    const outputDir = join(base, 'output');
    try {
      const builder = new WebsiteBuilder({ dataDir, outputDir });
      const site = builder.createWebsite({ name: 'Acme Site', framework: 'html', templateId: 'portfolio' });
      const files = builder.generateFiles(site.id);
      expect(files.length).toBeGreaterThan(0);
      const html = require('node:fs').readFileSync(files[0], 'utf-8') as string;
      expect(html).not.toContain('undefined');
      expect(html).toContain('React');
      expect(html).toContain('TypeScript');
      // hero cta from template
      expect(html).toContain('View My Work');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('renders pricing plans without crashing when features are missing', () => {
    const base = mkdtempSync(join(tmpdir(), 'websites-'));
    const dataDir = join(base, 'data');
    const outputDir = join(base, 'output');
    try {
      const builder = new WebsiteBuilder({ dataDir, outputDir });
      const site = builder.createWebsite({ name: 'Priced', framework: 'html' });
      const page = builder.addPage(site.id, '', 'Home');
      builder.addComponent(site.id, page!.id, {
        type: 'pricing',
        name: 'Pricing',
        props: { plans: [{ name: 'Free', price: 0 }, { name: 'Pro', price: 29 }] },
        order: 0,
      });
      const files = builder.generateFiles(site.id);
      const html = require('node:fs').readFileSync(files[0], 'utf-8') as string;
      expect(html).toContain('Free');
      expect(html).toContain('Pro');
      expect(html).not.toContain('undefined');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
