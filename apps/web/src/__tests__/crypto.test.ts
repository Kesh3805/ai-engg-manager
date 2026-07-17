import { describe, it, expect, beforeEach } from 'vitest';
import { encryptSecret, decryptSecret } from '@/server/crypto';

beforeEach(() => {
  process.env.SECRETS_ENCRYPTION_KEY = 'a'.repeat(64); // 32-byte hex key
});

describe('crypto (AES-256-GCM secrets)', () => {
  it('round-trips a webhook secret', () => {
    const ct = encryptSecret('whsec_super-secret-value');
    expect(ct.startsWith('v1.')).toBe(true);
    expect(ct).not.toContain('whsec_super-secret-value');
    expect(decryptSecret(ct)).toBe('whsec_super-secret-value');
  });

  it('produces a distinct ciphertext per call (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const ct = encryptSecret('payload');
    const parts = ct.split('.');
    const body = parts[3]!;
    const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
    const tampered = [parts[0], parts[1], parts[2], flipped].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects unknown formats', () => {
    expect(() => decryptSecret('v2.a.b.c')).toThrow('unrecognized');
  });
});
