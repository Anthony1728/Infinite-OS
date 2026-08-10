import { describe, expect, it, vi } from 'vitest';
import { routeForcedBrowserTool } from './browser-routing.js';

vi.mock('../bridge/server.js', () => ({
  bridgeServer: {
    getStatus: vi.fn(() => ({ connected: false })),
  },
}));

import { bridgeServer } from '../bridge/server.js';

describe('forced visible browser routing', () => {
  const setConnected = (connected: boolean) => {
    vi.mocked(bridgeServer.getStatus).mockReturnValue({ connected } as ReturnType<typeof bridgeServer.getStatus>);
  };

  it('routes an Amazon search through the visual Operator when extension is offline', () => {
    setConnected(false);
    expect(routeForcedBrowserTool('Open Chrome and search Amazon for laptops')).toEqual({
      name: 'Operator',
      input: { action: 'search_amazon', query: 'laptops' },
    });
  });

  it('routes an Amazon search through browser_extension when extension is connected', () => {
    setConnected(true);
    expect(routeForcedBrowserTool('Open Chrome and search Amazon for laptops')).toEqual({
      name: 'browser_extension',
      input: { action: 'navigate', url: 'https://www.amazon.com/s?k=laptops' },
    });
  });

  it('opens a new tab when Chrome is already running and extension is connected', () => {
    setConnected(true);
    expect(routeForcedBrowserTool('Open Chrome')).toEqual({
      name: 'browser_extension',
      input: { action: 'new_tab', url: 'about:blank' },
    });
  });

  it('launches Chrome via Computer when extension is offline', () => {
    setConnected(false);
    expect(routeForcedBrowserTool('Open Chrome')).toEqual({
      name: 'Computer',
      input: { action: 'launch_app', app: 'chrome' },
    });
  });

  it('routes a Google search to an encoded visible navigation via Operator when extension is offline', () => {
    setConnected(false);
    expect(routeForcedBrowserTool('Open Chrome and search Google for gaming laptops under R20 000')).toEqual({
      name: 'Operator',
      input: {
        action: 'navigate',
        url: 'https://www.google.com/search?q=gaming%20laptops%20under%20R20%20000',
      },
    });
  });

  it('routes a Google search through browser_extension when extension is connected', () => {
    setConnected(true);
    expect(routeForcedBrowserTool('Open Chrome and search Google for gaming laptops under R20 000')).toEqual({
      name: 'browser_extension',
      input: {
        action: 'navigate',
        url: 'https://www.google.com/search?q=gaming%20laptops%20under%20R20%20000',
      },
    });
  });

  it('does not force unrelated conversation into a browser tool', () => {
    setConnected(true);
    expect(routeForcedBrowserTool('Explain how search engines work')).toBeNull();
  });
});
