// The generated certificate must be REAL: Node's own X509Certificate parser
// is the oracle. If the DER encoder drifts, these fail loudly.

import { describe, expect, it } from 'vitest';
import { X509Certificate, createPublicKey } from 'node:crypto';
import { generateSelfSignedCert } from './tls-cert.js';

describe('generateSelfSignedCert', () => {
  it('produces a certificate Node can parse, self-signed for the requested CN', () => {
    const { certPem, keyPem } = generateSelfSignedCert('Infinite-OS-Phone');
    const cert = new X509Certificate(certPem);
    expect(cert.subject).toContain('Infinite-OS-Phone');
    expect(cert.issuer).toContain('Infinite-OS-Phone'); // self-signed: issuer === subject
    expect(new Date(cert.validFrom).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now());
    // The private key must correspond to the certificate's public key.
    const certKeyDer = cert.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    const fileKeyDer = createPublicKey(keyPem).export({ format: 'der', type: 'spki' }) as Buffer;
    expect(certKeyDer.equals(fileKeyDer)).toBe(true);
  });

  it('is signed with sha256WithRSAEncryption over a 2048-bit RSA key', () => {
    const { certPem } = generateSelfSignedCert('cn-test');
    const cert = new X509Certificate(certPem);
    // Realm-independent checks: the DER body must contain the
    // sha256WithRSAEncryption OID (1.2.840.113549.1.1.11) — accessor methods
    // and convenience getters proved unreliable across vitest realms.
    const der = Buffer.from(certPem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
    const sha256RsaOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]);
    expect(der.includes(sha256RsaOid)).toBe(true);
    // RSA-2048 SPKI is exactly 294 bytes: 256-byte modulus + 38 bytes of
    // DER overhead. A wrong key size would land on a different length.
    const spki = cert.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
    expect(spki.length).toBe(294);
    expect(cert.serialNumber.replace(/^0+/, '')).not.toBe('');
  });

  it('generates a distinct key pair per call (no shared material)', () => {
    const a = generateSelfSignedCert('a');
    const b = generateSelfSignedCert('b');
    expect(a.keyPem).not.toBe(b.keyPem);
    expect(a.certPem).not.toBe(b.certPem);
    expect(a.fingerprintSha256).not.toBe(b.fingerprintSha256);
    // Fingerprint shape: colon-separated hex, 32 bytes.
    expect(a.fingerprintSha256.split(':')).toHaveLength(32);
  });

  it('honors the requested validity window', () => {
    const { certPem } = generateSelfSignedCert('validity', 30);
    const cert = new X509Certificate(certPem);
    const days = (new Date(cert.validTo).getTime() - new Date(cert.validFrom).getTime()) / 86_400_000;
    expect(Math.round(days)).toBeGreaterThanOrEqual(30);
    expect(Math.round(days)).toBeLessThanOrEqual(32); // skew day + rounding
  });
});
