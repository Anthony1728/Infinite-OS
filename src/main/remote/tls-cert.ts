// Self-signed TLS certificate generation with ZERO dependencies.
//
// Node can generate keys and sign, but has no built-in X.509 cert builder —
// every recipe reaches for node-forge. For a LAN-only companion endpoint,
// a minimal DER encoder for exactly one certificate shape (RSA-2048,
// SHA-256, CN=<host>, 825-day validity) is smaller than a dependency and
// fully verifiable: the tests parse the result back with Node's own
// X509Certificate class.
//
// The phone shows the usual self-signed-certificate warning on first scan —
// expected and one tap — in exchange for the token no longer crossing the
// LAN in plaintext.

import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto';

// ── DER primitives ──────────────────────────────────────────────────────────

function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function sequence(...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(parts));
}

function integer(value: number): Buffer {
  return tlv(0x02, Buffer.from([value]));
}

function bigInteger(buffer: Buffer): Buffer {
  // Positive INTEGER: prepend 0x00 when the high bit is set.
  const body = buffer[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buffer]) : buffer;
  return tlv(0x02, body);
}

function oid(dotted: string): Buffer {
  const parts = dotted.split('.').map(Number);
  const first = 40 * parts[0] + parts[1];
  const body: number[] = [first];
  for (const part of parts.slice(2)) {
    if (part < 0x80) {
      body.push(part);
      continue;
    }
    const encoded: number[] = [];
    let value = part;
    while (value > 0) {
      encoded.unshift((value & 0x7f) | (encoded.length ? 0x80 : 0));
      value >>= 7;
    }
    body.push(...encoded);
  }
  return tlv(0x06, Buffer.from(body));
}

function utf8String(value: string): Buffer {
  return tlv(0x0c, Buffer.from(value, 'utf8'));
}

function utcTime(date: Date): Buffer {
  // UTCTime: YYMMDDHHMMSSZ (years 2000-2049 encode as two digits).
  const iso = date.toISOString();
  const text = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return tlv(0x17, Buffer.from(text, 'ascii'));
}

function bitStringOctets(content: Buffer): Buffer {
  return tlv(0x03, Buffer.concat([Buffer.from([0]), content]));
}

function nullOid(): Buffer {
  return tlv(0x05, Buffer.alloc(0));
}

function name(cn: string): Buffer {
  return sequence(
    set(
      sequence(
        oid('2.5.4.3'), // commonName
        utf8String(cn),
      ),
    ),
  );
}

// RSA public key: generateKeyPairSync with publicKeyEncoding spki/der already
// emits the complete SubjectPublicKeyInfo structure — embed it verbatim.
// ── Certificate assembly ────────────────────────────────────────────────────

export interface SelfSignedPem {
  keyPem: string;
  certPem: string;
  /** SHA-256 fingerprint of the DER cert — surfaced in the UI so the user can
   *  compare it against the phone's warning screen. */
  fingerprintSha256: string;
}

export function generateSelfSignedCert(commonName: string, daysValid = 825): SelfSignedPem {
  // publicKey arrives as SPKI DER (exactly what the TBSCertificate needs to
  // embed verbatim); privateKey arrives as PKCS#8 PEM, which both signs the
  // TBS and becomes the key PEM without further conversion.
  const { publicKey, privateKey: keyPem } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const notBefore = new Date(Date.now() - 24 * 3600 * 1000); // clock skew tolerance
  const notAfter = new Date(Date.now() + daysValid * 24 * 3600 * 1000);
  // Positive serial from CSPRNG (max 20 octets per RFC 5280).
  const serial = bigInteger(Buffer.concat([Buffer.from([0x01]), randomBytes(15)]));

  const tbs = sequence(
    // version [0] EXPLICIT INTEGER 2 (v3)
    tlv(0xa0, integer(2)),
    serial,
    sequence(oid('1.2.840.113549.1.1.11'), nullOid()), // sha256WithRSAEncryption
    name(commonName), // issuer == subject (self-signed)
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name(commonName),
    publicKey,
  );

  const signer = createSign('SHA256');
  signer.update(tbs);
  const signature = signer.sign(keyPem);

  const cert = sequence(
    tbs,
    sequence(oid('1.2.840.113549.1.1.11'), nullOid()),
    bitStringOctets(signature),
  );

  const fingerprint = createHash('sha256').update(cert).digest('hex')
    .replace(/(.{2})(?=.)/g, '$1:').toUpperCase();

  const certPem = [
    '-----BEGIN CERTIFICATE-----',
    Buffer.from(cert).toString('base64').replace(/(.{64})/g, '$1\n'),
    '-----END CERTIFICATE-----',
  ].join('\n');

  return { keyPem, certPem, fingerprintSha256: fingerprint };
}

