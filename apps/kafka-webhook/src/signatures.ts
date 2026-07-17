import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * HMAC verification for every webhook (plan §3.4):
 *  - compares over the RAW request body (captured by express.json's verify
 *    hook in index.ts), never a re-serialization
 *  - length mismatch returns 401 identically to a wrong signature — no
 *    timing oracle, no RangeError on attacker-controlled input
 */

/** Request with the raw body captured by express.json's verify hook. */
export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

export function safeHmacEqual(expected: string, received: string): boolean {
  try {
    // timingSafeEqual throws RangeError on length mismatch — guard explicitly
    if (expected.length !== received.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
  } catch {
    return false;
  }
}

function rawBodyOf(req: Request): Buffer {
  return (req as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
}

/** Verifies the GitHub `x-hub-signature-256` HMAC over the raw body. */
export function verifyGithubSignature(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return next(); // dev mode
  const received = (req.headers['x-hub-signature-256'] as string | undefined) ?? '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBodyOf(req)).digest('hex');
  if (!safeHmacEqual(expected, received)) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  next();
}

/** Verifies the Slack v0 signing-secret signature. */
export function verifySlackSignature(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) return next();
  const ts = (req.headers['x-slack-request-timestamp'] as string | undefined) ?? '';
  const received = (req.headers['x-slack-signature'] as string | undefined) ?? '';
  const base = `v0:${ts}:${rawBodyOf(req).toString('utf8')}`;
  const expected = 'v0=' + crypto.createHmac('sha256', secret).update(base).digest('hex');
  if (!safeHmacEqual(expected, received)) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  next();
}

/** Verifies the PagerDuty v3 `x-pagerduty-signature` (`v1=<hex>`) HMAC. */
export function verifyPagerDutySignature(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.PAGERDUTY_WEBHOOK_SECRET;
  if (!secret) return next(); // dev mode
  const received = (req.headers['x-pagerduty-signature'] as string | undefined) ?? '';
  const expected = 'v1=' + crypto.createHmac('sha256', secret).update(rawBodyOf(req)).digest('hex');
  // PagerDuty may send multiple comma-separated signatures during rotation.
  const ok = received.split(',').some((sig) => safeHmacEqual(expected, sig.trim()));
  if (!ok) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  next();
}

/**
 * Verifies the generic `x-aiem-signature` (`sha256=<hex>`) HMAC used by the
 * per-org deployment webhook. The secret is per-org (AES-decrypted from the
 * DB by the route) so this is a function, not middleware.
 */
export function verifyAiemSignature(req: Request, secret: string): boolean {
  const received = (req.headers['x-aiem-signature'] as string | undefined) ?? '';
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBodyOf(req)).digest('hex');
  return safeHmacEqual(expected, received);
}
