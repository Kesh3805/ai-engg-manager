import { createHash } from 'node:crypto';

/**
 * Deterministic EKG node identity (plan §2):
 *   ekgId(orgId, type, naturalKey) = uuidv5(EKG_NAMESPACE, `${orgId}::${type}::${naturalKey}`)
 * Re-processing the same event always yields the same id → idempotent upserts.
 */

/** Fixed namespace UUID for the Engineering Knowledge Graph. Never change it. */
export const EKG_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 DNS namespace

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** RFC 4122 version-5 (SHA-1, name-based) UUID. */
export function uuidv5(name: string, namespace: string = EKG_NAMESPACE): string {
  const hash = createHash('sha1')
    .update(uuidBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type EkgNodeType =
  | 'user'
  | 'commit'
  | 'pr'
  | 'issue'
  | 'deployment'
  | 'incident'
  | 'adr';

export function ekgId(orgId: string, type: EkgNodeType, naturalKey: string): string {
  return uuidv5(`${orgId}::${type}::${naturalKey}`);
}
