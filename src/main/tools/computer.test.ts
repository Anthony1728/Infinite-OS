import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  computer: {
    moveMouse: vi.fn(), click: vi.fn(), doubleClick: vi.fn(), rightClick: vi.fn(), drag: vi.fn(), scroll: vi.fn(),
    typeText: vi.fn(), pressKey: vi.fn(), hotkey: vi.fn(), captureScreen: vi.fn(), captureLiveFrame: vi.fn(),
    getDesktopState: vi.fn(), getInteractiveElements: vi.fn(), getCursorPosition: vi.fn(), openApp: vi.fn(), closeApp: vi.fn(),
    focusWindow: vi.fn(), getWindows: vi.fn(), getProcesses: vi.fn(), getClipboard: vi.fn(), setClipboard: vi.fn(),
  },
}));

vi.mock('../automation/computer-automation.js', () => ({
  getComputerAutomation: () => mocks.computer,
}));

import { computerTool } from './computer.js';

beforeEach(() => {
  for (const fn of Object.values(mocks.computer)) fn.mockReset();
  mocks.computer.captureLiveFrame.mockResolvedValue({ path: 'mock-frame.png', width: 1920, height: 1080 });
  mocks.computer.getDesktopState.mockResolvedValue({
    screen: { width: 1920, height: 1080 },
    cursor: { x: 0, y: 0 },
    activeWindow: 'Test window',
    focusedElement: 'Editor',
  });
  mocks.computer.getInteractiveElements.mockResolvedValue([
    {
      name: 'Save',
      controlType: 'Button',
      automationId: 'save-button',
      className: 'Button',
      isEnabled: true,
      boundingRect: { x: 100, y: 40, width: 80, height: 30 },
    },
  ]);
});

describe('Computer tool validation with mocked automation', () => {
  it('rejects incomplete coordinate actions before moving or clicking', async () => {
    const result = await computerTool.execute({ action: 'mouse_click', x: 10 }, {} as never);
    expect(result.is_error).toBe(true);
    expect(mocks.computer.moveMouse).not.toHaveBeenCalled();
    expect(mocks.computer.click).not.toHaveBeenCalled();
  });

  it('refuses a visual click outside the observed screen bounds', async () => {
    const result = await computerTool.execute({ action: 'visual_click', x: 1920, y: 100 }, {} as never);
    expect(result.is_error).toBe(true);
    expect(result.content).toContain('outside screen bounds');
    expect(mocks.computer.moveMouse).not.toHaveBeenCalled();
    expect(mocks.computer.click).not.toHaveBeenCalled();
  });

  it('does not type when no active window or focused control exists', async () => {
    mocks.computer.getDesktopState.mockResolvedValueOnce({
      screen: { width: 1920, height: 1080 }, cursor: { x: 0, y: 0 }, activeWindow: '', focusedElement: '',
    });
    const result = await computerTool.execute({ action: 'visual_type', text: 'safe test' }, {} as never);
    expect(result.is_error).toBe(true);
    expect(mocks.computer.typeText).not.toHaveBeenCalled();
  });

  it('returns a live observation without issuing input actions', async () => {
    const result = await computerTool.execute({ action: 'visual_observe' }, {} as never);
    expect(result.is_error).not.toBe(true);
    expect(JSON.parse(String(result.content))).toMatchObject({
      frame: { path: 'mock-frame.png', width: 1920, height: 1080 },
      state: { activeWindow: 'Test window', focusedElement: 'Editor' },
      interactiveElements: [{ name: 'Save', boundingRect: { x: 100, y: 40, width: 80, height: 30 } }],
    });
    expect(mocks.computer.moveMouse).not.toHaveBeenCalled();
    expect(mocks.computer.click).not.toHaveBeenCalled();
    expect(mocks.computer.typeText).not.toHaveBeenCalled();
  });
});
