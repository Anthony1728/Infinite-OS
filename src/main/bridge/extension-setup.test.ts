import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  bridgeExtensionInstallDir,
  bridgeExtensionSourceDir,
  currentBridgeConfig,
  installBridgeExtension,
  parseDevToolsActivePortForTest,
} from './extension-setup.js';

/**
 * These tests only cover the pure / side-effect-free parts of the setup module.
 * Anything that launches a browser or calls CDP is validated live — a unit test
 * that starts Chrome would be slow, flaky, and would fight the user's session.
 */

describe('parseDevToolsActivePort', () => {
  it('parses the port and browser websocket path Chrome writes', () => {
    const parsed = parseDevToolsActivePortForTest('52209\n/devtools/browser/a42cd981-96bc\n');
    expect(parsed).toEqual({ port: 52209, path: '/devtools/browser/a42cd981-96bc' });
  });

  it('tolerates CRLF line endings and a missing trailing newline', () => {
    expect(parseDevToolsActivePortForTest('9333\r\n/devtools/browser/abc')).toEqual({
      port: 9333,
      path: '/devtools/browser/abc',
    });
  });

  it('returns null for an empty or non-numeric port', () => {
    expect(parseDevToolsActivePortForTest('')).toBeNull();
    expect(parseDevToolsActivePortForTest('not-a-port\n/devtools/browser/x')).toBeNull();
  });

  it('rejects out-of-range ports so a corrupt file cannot point at a random service', () => {
    expect(parseDevToolsActivePortForTest('0')).toBeNull();
    expect(parseDevToolsActivePortForTest('70000')).toBeNull();
    expect(parseDevToolsActivePortForTest('-1')).toBeNull();
  });

  it('keeps the port when the websocket path is missing', () => {
    expect(parseDevToolsActivePortForTest('8765')).toEqual({ port: 8765, path: '' });
  });
});

describe('extension install layout', () => {
  it('resolves the bundled extension source that ships in the repo', () => {
    const source = bridgeExtensionSourceDir();
    expect(existsSync(join(source, 'manifest.json'))).toBe(true);
    expect(existsSync(join(source, 'background.js'))).toBe(true);
  });

  it('installs under %LOCALAPPDATA%\\InfiniteOS\\bridge-extension', () => {
    const installDir = bridgeExtensionInstallDir();
    expect(installDir).toContain('InfiniteOS');
    expect(installDir.endsWith('bridge-extension')).toBe(true);
  });

  it('reports success without copying while running under Vitest', () => {
    const result = installBridgeExtension();
    expect(result.ok).toBe(true);
    // The test environment must never write into the real install location.
    expect(result.copied).toBe(false);
    expect(result.path).toBe(bridgeExtensionInstallDir());
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exposes the current bridge port and token for the setup UI', () => {
    const config = currentBridgeConfig();
    expect(config.port).toBeGreaterThan(0);
    expect(typeof config.token).toBe('string');
  });
});
