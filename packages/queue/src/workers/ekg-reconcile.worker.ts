import { Worker } from 'bullmq';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { redis } from '../redis.js';
import { clonesDir } from '../lib/repo-lock.js';

/**
 * Weekly EKG hygiene (plan 2b-11):
 *   1. Orphan cleanup — sample active edges, verify both endpoints still
 *      exist, soft-delete (valid_until = now()) the ones that don't.
 *   2. 18-month archival — move stale-invalidated edges to ekg_edges_archive.
 *   3. `git gc --auto` across all bare clones.
 */

const ENDPOINT_TABLES: Record<string, string> = {
  ast_node: 'ast_nodes',
  commit: 'git_commits',
  pr: 'pull_requests',
  user: 'ekg_users',
  issue: 'issues',
  incident: 'incidents',
  adr: 'adrs',
  deployment: 'deployments',
};

async function orphanSweep(): Promise<void> {
  for (const [nodeType, table] of Object.entries(ENDPOINT_TABLES)) {
    // Soft-delete active edges whose FROM endpoint no longer exists.
    await db.execute(sql`
      UPDATE ekg_edges e SET valid_until = now()
      WHERE e.valid_until IS NULL AND e.from_type = ${nodeType}
        AND e.id IN (
          SELECT e2.id FROM ekg_edges e2
          WHERE e2.valid_until IS NULL AND e2.from_type = ${nodeType}
            AND NOT EXISTS (
              SELECT 1 FROM ${sql.raw(table)} n
              WHERE n.id = e2.from_id AND n.org_id = e2.org_id
            )
          LIMIT 10000
        )
    `);
    await db.execute(sql`
      UPDATE ekg_edges e SET valid_until = now()
      WHERE e.valid_until IS NULL AND e.to_type = ${nodeType}
        AND e.id IN (
          SELECT e2.id FROM ekg_edges e2
          WHERE e2.valid_until IS NULL AND e2.to_type = ${nodeType}
            AND NOT EXISTS (
              SELECT 1 FROM ${sql.raw(table)} n
              WHERE n.id = e2.to_id AND n.org_id = e2.org_id
            )
          LIMIT 10000
        )
    `);
  }
}

async function archiveStaleEdges(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ekg_edges_archive (LIKE ekg_edges INCLUDING ALL)
  `);
  await db.execute(sql`
    WITH moved AS (
      DELETE FROM ekg_edges
      WHERE valid_until IS NOT NULL AND valid_until < now() - interval '18 months'
      RETURNING *
    )
    INSERT INTO ekg_edges_archive SELECT * FROM moved
    ON CONFLICT DO NOTHING
  `);
}

async function gcClones(): Promise<void> {
  const dirs = await readdir(clonesDir(), { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    await simpleGit(join(clonesDir(), dir.name))
      .raw(['gc', '--auto'])
      .catch((err) => console.error(`[ekg-reconcile] git gc failed for ${dir.name}:`, err));
  }
}

export const ekgReconcileWorker = new Worker(
  'ekg-reconcile',
  async () => {
    await orphanSweep();
    await archiveStaleEdges();
    await gcClones();
  },
  { connection: redis, concurrency: 1 },
);
