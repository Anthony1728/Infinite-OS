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

  it('requires name for every named interaction', async () => {
    for (const action of ['rightclick_name', 'doubleclick_name', 'hover_name', 'scroll_at_name', 'type_name']) {
      const res = await pcLiveMapTool.execute({ action, name: '' }, ctx());
      expect(res.is_error).toBe(true);
      expect(String(res.content)).toMatch(/requires name/);
    }
  });

  it('requires text for type_name', async () => {
    const res = await pcLiveMapTool.execute({ action: 'type_name', name: 'Search', text: '' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires text/);
  });

  it('requires coords for scroll_at and rightclick', async () => {
    for (const action of ['scroll_at', 'rightclick', 'hover']) {
      const res = await pcLiveMapTool.execute({ action }, ctx());
      expect(res.is_error).toBe(true);
      expect(String(res.content)).toMatch(/requires x_norm/);
    }
  });

  it('requires a target for window operations', async () => {
    const res = await pcLiveMapTool.execute({ action: 'window', op: 'minimize' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires proc, title, or pid/);
  });

  it('requires a path for launch', async () => {
    const res = await pcLiveMapTool.execute({ action: 'launch' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/requires path/);
  });

  it('requires keys for held-key actions', async () => {
    for (const action of ['keydown', 'keyup']) {
      const res = await pcLiveMapTool.execute({ action, keys: '' }, ctx());
      expect(res.is_error).toBe(true);
      expect(String(res.content)).toMatch(/requires keys/);
    }
  });

  it('requires a target for wait_for', async () => {
    const res = await pcLiveMapTool.execute({ action: 'wait_for' }, ctx());
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toMatch(/needs name/);
  });

  it('advertises window, launch and held-key actions', () => {
    const schema = pcLiveMapTool.inputSchema as { properties: { action: { enum: string[] } } };
    for (const action of ['windows', 'wait_for', 'window', 'launch', 'keydown', 'keyup', 'release_keys', 'rightclick_name', 'scroll_at_name', 'type_name', 'hover_name']) {
      expect(schema.properties.action.enum).toContain(action);
    }
  });
});
