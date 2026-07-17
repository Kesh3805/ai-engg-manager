import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { safeHmacEqual, verifyGithubSignature, verifyAiemSignature, type RawBodyRequest } from './signatures.js';

function mockReq(body: unknown, headers: Record<string, string>): RawBodyRequest {
  const raw = Buffer.from(JSON.stringify(body), 'utf8');
  return { body, headers, rawBody: raw } as unknown as RawBodyRequest;
}

function mockRes(): Response & { statusCode: number | null; jsonBody: unknown } {
  const res = {
    statusCode: null as number | null,
    jsonBody: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.jsonBody = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number | null; jsonBody: unknown };
}

function sign(secret: string, raw: Buffer, prefix: string): string {
  return prefix + crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

describe('safeHmacEqual (§3.4)', () => {
  it('accepts equal strings', () => {
    expect(safeHmacEqual('sha256=abc', 'sha256=abc')).toBe(true);
  });
  it('rejects different strings of equal length', () => {
    expect(safeHmacEqual('sha256=abc', 'sha256=abd')).toBe(false);
  });
  it('rejects length mismatch WITHOUT throwing (no RangeError oracle)', () => {
    expect(safeHmacEqual('sha256=abc', 'x')).toBe(false);
    expect(safeHmacEqual('sha256=abc', '')).toBe(false);
  });
});

describe('verifyGithubSignature', () => {
  beforeEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = 'gh-secret';
  });

  it('passes a correctly signed request through', () => {
    const req = mockReq({ hello: 'world' }, {});
    req.headers['x-hub-signature-256'] = sign('gh-secret', req.rawBody!, 'sha256=');
    const res = mockRes();
    let called = false;
    verifyGithubSignature(req as unknown as Request, res, () => (called = true));
    expect(called).toBe(true);
    expect(res.statusCode).toBeNull();
  });

  it('401s on a wrong signature and on a truncated signature', () => {
    for (const sig of ['sha256=' + '0'.repeat(64), 'sha256=short', '']) {
      const req = mockReq({ hello: 'world' }, { 'x-hub-signature-256': sig });
      const res = mockRes();
      let called = false;
      verifyGithubSignature(req as unknown as Request, res, () => (called = true));
      expect(called).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });
});

describe('verifyAiemSignature (per-org deployment webhook)', () => {
  it('validates against the supplied per-org secret', () => {
    const req = mockReq({ deployId: 'd1' }, {});
    req.headers['x-aiem-signature'] = sign('org-secret', req.rawBody!, 'sha256=');
    expect(verifyAiemSignature(req as unknown as Request, 'org-secret')).toBe(true);
    expect(verifyAiemSignature(req as unknown as Request, 'other-secret')).toBe(false);
  });
});
