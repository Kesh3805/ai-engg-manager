import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import type { EkgEdgeSpec } from '../queues.js';

/**
 * Canonical ekg_edges upsert (plan §4.6). Always ON CONFLICT so edges the
 * reconciler soft-deleted (valid_until set) are re-activated when the fact is
 * observed again. Chunked so a large batch never builds a megabyte statement.
 */
export async function upsertEdges(orgId: string, edges: EkgEdgeSpec[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < edges.length; i += 500) {
    const chunk = edges.slice(i, i + 500);
    await db.execute(sql`
      INSERT INTO ekg_edges (org_id, from_type, from_id, to_type, to_id, edge_type, metadata)
      SELECT * FROM unnest(
        ${chunk.map(() => orgId)}::uuid[],
        ${chunk.map((e) => e.fromType)}::text[],
        ${chunk.map((e) => e.fromId)}::uuid[],
        ${chunk.map((e) => e.toType)}::text[],
        ${chunk.map((e) => e.toId)}::uuid[],
        ${chunk.map((e) => e.edgeType)}::text[],
        ${chunk.map((e) => JSON.stringify(e.metadata ?? {}))}::jsonb[]
      ) AS t(org_id, from_type, from_id, to_type, to_id, edge_type, metadata)
      ON CONFLICT (org_id, from_type, from_id, to_id, edge_type)
      DO UPDATE SET valid_until = NULL, metadata = EXCLUDED.metadata, updated_at = now()
    `);
    written += chunk.length;
  }
  return written;
}
