import { describe, expect, it } from 'vitest';
import { cryptoTool, constantTimeEqual } from './crypto.js';

function exec(action: string, args: Record<string, unknown>) {
  return cryptoTool.execute({ action, ...args }, {} as never);
}

describe('Crypto tool', () => {
  it('hashes with the requested algorithm', async () => {
    const result = await exec('hash', { data: 'abc', algorithm: 'sha256' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(parsed.digest.length).toBe(64);
  });

  it('computes HMAC', async () => {
    const result = await exec('hmac', { data: 'message', secret: 'key' });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.hmac).toHaveLength(64);
    // Known RFC 4231 vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    const known = await exec('hmac', { data: 'The quick brown fox jumps over the lazy dog', secret: 'key' });
    expect(JSON.parse(String(known.content)).hmac).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('generates random hex and UUIDs', async () => {
    const hex = await exec('random_hex', { bytes: 16 });
    expect(String(JSON.parse(String(hex.content)).hex)).toHaveLength(32);

    const uuid = await exec('random_uuid', { count: 3 });
    const { uuids } = JSON.parse(String(uuid.content));
    expect(uuids).toHaveLength(3);
    expect(uuids).toHaveLength(new Set(uuids).size);
    expect(uuids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates passwords that satisfy every selected class', async () => {
    const result = await exec('random_password', { length: 32, symbols: true });
    const { password, strength } = JSON.parse(String(result.content));
    expect(password).toHaveLength(32);
    expect(/[A-Z]/.test(password)).toBe(true);
    expect(/[a-z]/.test(password)).toBe(true);
    expect(/\d/.test(password)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(password)).toBe(true);
    expect(strength.score).toBe(4);
  });

  it('excludes ambiguous characters when asked', async () => {
    for (let i = 0; i < 25; i++) {
      const result = await exec('random_password', { length: 64, ambiguous: false });
      const { password } = JSON.parse(String(result.content));
      expect(password).not.toMatch(/[Il1O0o]/);
      expect(/[A-Z]/.test(password)).toBe(true);
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/\d/.test(password)).toBe(true);
    }
  });

  it('scores password strength', async () => {
    const weak = JSON.parse(String((await exec('password_strength', { data: 'abc' })).content));
    expect(weak.score).toBeLessThan(3);
    const strong = JSON.parse(String((await exec('password_strength', { data: 'K9$mP!x2Qz#L7vBw5&nRt' })).content));
    expect(strong.score).toBe(4);
  });

  it('encodes and decodes base64, including URL-safe form', async () => {
    const encoded = await exec('base64_encode', { text: 'hello' });
    expect(String(encoded.content)).toBe('aGVsbG8=');
    const decoded = await exec('base64_decode', { text: 'aGVsbG8=' });
    expect(String(decoded.content)).toBe('hello');

    const urlSafe = await exec('base64_encode', { text: 'a>b', urlSafe: true });
    expect(String(urlSafe.content)).not.toContain('+');
    expect(String(urlSafe.content)).not.toContain('/');
    expect(String(urlSafe.content)).not.toContain('=');
  });

  it('decodes a JWT payload without verifying', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: '123', exp: 1600000000 })).toString('base64url'); // expired in Sep 2020
    const token = `${header}.${payload}.signature`;
    const result = await exec('jwt_decode', { token });
    const parsed = JSON.parse(String(result.content));
    expect(parsed.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(parsed.payload.sub).toBe('123');
    expect(parsed.timing.expired).toBe(true);
  });

  it('rejects malformed JWTs', async () => {
    const result = await exec('jwt_decode', { token: 'not-a-jwt' });
    expect(result.is_error).toBe(true);
  });

  it('provides constant-time comparison', () => {
    expect(constantTimeEqual('same', 'same')).toBe(true);
    expect(constantTimeEqual('a', 'b')).toBe(false);
    expect(constantTimeEqual('a', 'aa')).toBe(false);
  });
});
