import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockExec = vi.fn();

vi.mock('../bridge/server.js', () => ({
  bridgeServer: { exec: mockExec, getStatus: () => ({ connected: true }) },
  BRIDGE_DEFAULT_PORT: 8765,
}));

const { browserExtensionTool } = await import('./browser-extension.js');

describe('browser_extension tool', () => {
  beforeEach(() => {
    mockExec.mockReset();
  });

  it('maps navigate action to navigate command', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { id: 1, url: 'https://example.com', title: 'Test' } });
    const result = await browserExtensionTool.execute({ action: 'navigate', url: 'https://example.com' }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('navigate', { url: 'https://example.com' });
    expect(result.is_error).toBe(false);
  });

  it('maps extract_text to get_page_text command', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { text: 'Hello world' } });
    const result = await browserExtensionTool.execute({ action: 'extract_text' }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('get_page_text', {});
    expect(result.is_error).toBe(false);
    expect(result.content).toContain('Hello world');
  });

  it('maps extract_links to get_page_links command', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { links: [{ href: 'https://a.com', text: 'Link A' }] } });
    const result = await browserExtensionTool.execute({ action: 'extract_links' }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('get_page_links', {});
    expect(result.is_error).toBe(false);
  });

  it('maps extract_forms to get_form_fields command', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { fields: [] } });
    const result = await browserExtensionTool.execute({ action: 'extract_forms' }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('get_form_fields', {});
    expect(result.is_error).toBe(false);
  });

  it('maps click_text to click_text command with text as value', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { clicked: true } });
    await browserExtensionTool.execute({ action: 'click_text', text: 'Submit' }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('click_text', { text: 'Submit', value: 'Submit' });
  });

  it('maps click with text fallback to click command with text param', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { clicked: true } });
    await browserExtensionTool.execute({ action: 'click', text: 'Continue' }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('click', { text: 'Continue' });
  });

  it('maps batch action to batch command', async () => {
    const ops = [
      { op: 'click', params: { selector: '#btn' } },
      { op: 'type', params: { selector: '#input', text: 'hello' } },
    ];
    mockExec.mockResolvedValue({ ok: true, data: { results: [{}, {}] } });
    await browserExtensionTool.execute({ action: 'batch', ops }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('batch', { ops });
  });

  it('maps console_log action to console_log command with duration', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { logs: [], captured: true } });
    await browserExtensionTool.execute({ action: 'console_log', duration: 3000 }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('console_log', { duration: 3000 });
  });

  it('maps fill action to fill command with fields', async () => {
    const fields = { '#email': 'test@example.com', '#password': 'secret' };
    mockExec.mockResolvedValue({ ok: true, data: { filled: 2 } });
    await browserExtensionTool.execute({ action: 'fill', fields }, {} as never);
    expect(mockExec).toHaveBeenCalledWith('fill', { fields });
  });

  it('returns error for unknown action', async () => {
    const result = await browserExtensionTool.execute({ action: 'nonexistent' }, {} as never);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Unknown action');
  });

  it('returns error when bridge returns an error', async () => {
    mockExec.mockResolvedValue({ ok: false, error: 'Browser bridge not connected' });
    const result = await browserExtensionTool.execute({ action: 'navigate', url: 'https://example.com' }, {} as never);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('Browser bridge not connected');
  });

  it('passes through multiple params correctly', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { id: 1, url: 'https://example.com' } });
    await browserExtensionTool.execute(
      { action: 'navigate', url: 'https://example.com', tabId: 5 },
      {} as never,
    );
    expect(mockExec).toHaveBeenCalledWith('navigate', { url: 'https://example.com', tabId: 5 });
  });

  it('defaults to inspect action when action is missing', async () => {
    mockExec.mockResolvedValue({ ok: true, data: { url: 'https://example.com' } });
    await browserExtensionTool.execute({}, {} as never);
    expect(mockExec).toHaveBeenCalledWith('inspect', {});
  });
});
