/**
 * Versioned Kafka envelope (plan §5). The canonical type lives in
 * @repo/queue (consumers import it from there); this module owns the
 * producer-side helpers and the current version constants.
 */
export interface KafkaEnvelope<T> {
  schemaVersion: number;
  producedAt: string; // ISO timestamp
  orgId: string;
  payload: T;
}

/** Bump per topic when the payload shape changes. See VERSIONING.md. */
export const SCHEMA_VERSIONS = {
  'github.pull_requests': 1,
  'incidents.events': 1,
  'deployments.events': 1,
} as const;

export type VersionedTopic = keyof typeof SCHEMA_VERSIONS;

export function makeEnvelope<T>(topic: VersionedTopic, orgId: string, payload: T): KafkaEnvelope<T> {
  return {
    schemaVersion: SCHEMA_VERSIONS[topic],
    producedAt: new Date().toISOString(),
    orgId,
    payload,
  };
}
