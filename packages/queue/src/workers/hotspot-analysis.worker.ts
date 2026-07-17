import { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { redis } from '../redis.js';
import { Queues, type HotspotAnalysisJob } from '../queues.js';

/**
 * Hotspot analysis (plan 4a-1). Weekly cron enqueues 'dispatch'; per-org jobs
 * deduped via jobId `hotspot-<orgId>`. A file is a hotspot when it sits at or
 * above the 90th percentile on BOTH churn (commits, 90d) and complexity
 * (avg CC of its functions).
 */

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

interface FileStat {
  repoId: string;
  filePath: string;
  churn: number;
  complexity: number;
  bugRate: number;
}

async function analyzeOrg(orgId: string): Promise<void> {
  // churn: commits touching each file (90d), via commit→file MODIFIED edges.
  // complexity: avg CC of the file's function/method nodes.
  // bug_rate: incidents linked to the file's commits via CAUSED edges (180d).
  const stats = (await db.execute(sql`
    WITH churn AS (
      SELECT n.repo_id, n.file_path, count(DISTINCT c.id)::int AS churn
      FROM ekg_edges e
      JOIN git_commits c ON c.id = e.from_id AND c.org_id = e.org_id
      JOIN ast_nodes n ON n.id = e.to_id AND n.org_id = e.org_id
      WHERE e.org_id = ${orgId} AND e.from_type = 'commit' AND e.to_type = 'ast_node'
        AND e.edge_type = 'MODIFIED' AND e.valid_until IS NULL
        AND c.committed_at > now() - interval '90 days'
      GROUP BY n.repo_id, n.file_path
    ), cx AS (
      SELECT repo_id, file_path, COALESCE(round(avg(complexity)), 0)::int AS complexity
      FROM ast_nodes
      WHERE org_id = ${orgId} AND node_type IN ('function','method') AND complexity IS NOT NULL
      GROUP BY repo_id, file_path
    ), bugs AS (
      SELECT n.repo_id, n.file_path, count(DISTINCT i.id)::int AS bug_rate
      FROM ekg_edges cause
      JOIN incidents i ON i.id = cause.to_id AND i.org_id = cause.org_id
      JOIN git_commits c ON c.id = cause.from_id AND c.org_id = cause.org_id
      JOIN ekg_edges m ON m.from_id = c.id AND m.from_type = 'commit' AND m.edge_type = 'MODIFIED'
        AND m.org_id = cause.org_id AND m.valid_until IS NULL
      JOIN ast_nodes n ON n.id = m.to_id AND n.org_id = cause.org_id
      WHERE cause.org_id = ${orgId} AND cause.from_type = 'commit' AND cause.to_type = 'incident'
        AND cause.edge_type = 'CAUSED' AND cause.valid_until IS NULL
        AND i.triggered_at > now() - interval '180 days'
      GROUP BY n.repo_id, n.file_path
    )
    SELECT churn.repo_id AS "repoId", churn.file_path AS "filePath",
           churn.churn, COALESCE(cx.complexity, 0) AS complexity, COALESCE(bugs.bug_rate, 0) AS "bugRate"
    FROM churn
    LEFT JOIN cx ON cx.repo_id = churn.repo_id AND cx.file_path = churn.file_path
    LEFT JOIN bugs ON bugs.repo_id = churn.repo_id AND bugs.file_path = churn.file_path
  `)) as unknown as FileStat[];

  if (stats.length === 0) return;

  const churnP90 = percentile(stats.map((s) => s.churn).sort((a, b) => a - b), 90);
  const cxP90 = percentile(stats.map((s) => s.complexity).sort((a, b) => a - b), 90);
  const hotspots = stats.filter((s) => s.churn >= churnP90 && s.complexity >= cxP90);

  for (const h of hotspots) {
    await db.execute(sql`
      INSERT INTO hotspots (org_id, repo_id, file_path, churn_score, complexity_score, bug_rate)
      VALUES (${orgId}, ${h.repoId}, ${h.filePath}, ${h.churn}, ${h.complexity}, ${h.bugRate})
      ON CONFLICT (org_id, repo_id, file_path) DO UPDATE SET
        churn_score = EXCLUDED.churn_score,
        complexity_score = EXCLUDED.complexity_score,
        bug_rate = EXCLUDED.bug_rate,
        last_updated_at = now()
    `);
  }

  // Files that cooled off are removed so the radar stays current.
  const keep = hotspots.map((h) => `${h.repoId}::${h.filePath}`);
  await db.execute(sql`
    DELETE FROM hotspots
    WHERE org_id = ${orgId}
      AND (repo_id::text || '::' || file_path) <> ALL(${keep.length ? keep : ['__none__']}::text[])
  `);
}

export const hotspotAnalysisWorker = new Worker(
  'hotspot-analysis',
  async (job) => {
    if (job.name === 'dispatch') {
      const orgs = (await db.execute(sql`SELECT DISTINCT org_id AS "orgId" FROM repositories`)) as unknown as Array<{ orgId: string }>;
      for (const { orgId } of orgs) {
        await Queues.hotspotAnalysis.add('analyze', { orgId }, { jobId: `hotspot-${orgId}-${new Date().toISOString().slice(0, 10)}` });
      }
      return;
    }
    const { orgId } = job.data as HotspotAnalysisJob;
    await analyzeOrg(orgId);
  },
  { connection: redis, concurrency: 1 },
);
