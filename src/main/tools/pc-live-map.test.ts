import { describe, expect, it } from 'vitest';
import { pcLiveMapTool } from './pc-live-map.js';
import type { ToolContext } from './base.js';

function ctx(): ToolContext {
  return { cwd: process.cwd(), abortSignal: AbortSignal.timeout(10000), sessionId: 'test', onUpdate: () => {} };
}

describe('PCLiveMap input validation (no network)', () => {
  it('rejects unknown actions', async () => {
    const res = await pcLiveMapTool.execute({ action: 'fly_to_moon' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/Unknown PCLiveMap action/);
  });

  it('requires name for click_name', async () => {
    const res = await pcLiveMapTool.execute({ action: 'click_name', name: '   ' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires name/);
  });

  it('requires coords for click', async () => {
    const res = await pcLiveMapTool.execute({ action: 'click' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires x_norm/);
  });

  it('rejects out-of-range coords', async () => {
    const res = await pcLiveMapTool.execute({ action: 'click', x_norm: 5000, y_norm: 100 }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/0-1000/);
  });

  it('rejects empty type text', async () => {
    const res = await pcLiveMapTool.execute({ action: 'type', text: '' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires text/);
  });

  it('rejects oversized type text', async () => {
    const res = await pcLiveMapTool.execute({ action: 'type', text: 'x'.repeat(501) }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/max 500/);
  });

  it('rejects oversized keys', async () => {
    const res = await pcLiveMapTool.execute({ action: 'keys', keys: 'x'.repeat(65) }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/max 64/);
  });

  it('requires proc for focus', async () => {
    const res = await pcLiveMapTool.execute({ action: 'focus', proc: '' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires proc/);
  });

  it('exposes start action in schema', () => {
    const schema = pcLiveMapTool.inputSchema as { properties: { action: { enum: string[] } } };
    expect(schema.properties.action.enum).toContain('start');
    expect(schema.properties.action.enum).toContain('doubleclick');
    expect(schema.properties.action.enum).toContain('click_name');
  });
});
