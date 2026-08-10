import { describe, expect, it } from 'vitest';
import { joinSystemPath, normalizeSystemPath, parentSystemPath, systemBaseName } from './systemPaths';

describe('system path navigation', () => {
  it('preserves Windows drive roots', () => {
    expect(normalizeSystemPath('C:')).toBe('C:\\');
    expect(parentSystemPath('C:\\Users')).toBe('C:\\');
    expect(parentSystemPath('C:\\')).toBe('C:\\');
  });

  it('joins Windows and POSIX paths correctly', () => {
    expect(joinSystemPath('C:\\Users', 'user')).toBe('C:\\Users\\user');
    expect(joinSystemPath('/', 'tmp')).toBe('/tmp');
    expect(systemBaseName('C:\\Users\\user')).toBe('user');
  });
});
