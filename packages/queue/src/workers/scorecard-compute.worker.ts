import { Worker } from 'bullmq';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { redis } from '../redis.js';
import { Queues, type ScorecardComputeJob } from '../queues.js';
import { clonesDir } from '../lib/repo-lock.js';

/**
 * Engineering scorecard, algorithm v1 (plan §11 / 3d-3). All scores 0–100 or
 * null when the underlying signal is absent — never fabricated. The daily
 * cron enqueues a 'dispatch' job; it fans out one job per org with jobId
 * `scorecard-<orgId>` for dedup.
 */

const ALGORITHM_VERSION = 1;

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function one<T>(query: ReturnType<typeof sql>): Promise<T | undefined> {
  const rows = (await db.execute(query)) as unknown as T[];
  return rows[0];
}

async function computeRepoScores(orgId: string, repoId: string): Promise<void> {
  // test_health — latest pushed coverage report; null when none exists.
  const coverage = await one<{ overallPct: string; sourceFormat: string | null }>(sql`
    SELECT overall_pct AS "overallPct", source_format AS "sourceFormat"
    FROM coverage_reports
    WHERE org_id = ${orgId} AND repo_id = ${repoId}
    ORDER BY report_date DESC, created_at DESC LIMIT 1
  `);

  // complexity — % functions with McCabe CC ≤ 10.
  const cc = await one<{ total: number; simple: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE complexity IS NULL OR complexity <= 10)::int AS simple
    FROM ast_nodes
    WHERE org_id = ${orgId} AND repo_id = ${repoId} AND node_type IN ('function','method')
  `);
  const complexity = cc && cc.total > 0 ? clamp((cc.simple / cc.total) * 100) : null;

  // security — weighted inverse of the latest AI security synthesis.
  const security = await computeSecurityScore(orgId, repoId);

  // doc_health — % public-API nodes with a DOCUMENTED_BY edge in the EKG.
  const doc = await one<{ total: number; documented: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM ekg_edges e
             WHERE e.org_id = n.org_id AND e.valid_until IS NULL AND e.edge_type = 'DOCUMENTED_BY'
               AND ((e.from_type = 'ast_node' AND e.from_id = n.id) OR (e.to_type = 'ast_node' AND e.to_id = n.id))
           ))::int AS documented
    FROM ast_nodes n
    WHERE n.org_id = ${orgId} AND n.repo_id = ${repoId} AND n.node_type IN ('class','interface','function')
  `);
  const docHealth = doc && doc.total > 0 ? clamp((doc.documented / doc.total) * 100) : null;

  // ownership — % files where one author has >50% of commits (via MODIFIED edges).
  const own = await one<{ total: number; owned: number }>(sql`
    WITH file_authors AS (
      SELECT e.to_id AS file_id, c.author_id, count(*)::int AS commits
      FROM ekg_edges e
      JOIN git_commits c ON c.id = e.from_id AND c.org_id = e.org_id
      WHERE e.org_id = ${orgId} AND e.from_type = 'commit' AND e.to_type = 'ast_node'
        AND e.edge_type = 'MODIFIED' AND e.valid_until IS NULL AND c.repo_id = ${repoId}
        AND c.author_id IS NOT NULL
      GROUP BY e.to_id, c.author_id
    ), file_totals AS (
      SELECT file_id, sum(commits) AS total, max(commits) AS top
      FROM file_authors GROUP BY file_id
    )
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE top::float / total > 0.5)::int AS owned
    FROM file_totals
  `);
  const ownership = own && own.total > 0 ? clamp((own.owned / own.total) * 100) : null;

  // dep_health — inverse of critical+high CVE count from OSV.dev.
  const depHealth = await computeDepHealth(repoId);

  await db.execute(sql`
    INSERT INTO engineering_scores (
      org_id, repo_id, algorithm_version, scored_at,
      test_health, test_health_source, doc_health, dep_health, security, complexity, ownership
    ) VALUES (
      ${orgId}, ${repoId}, ${ALGORITHM_VERSION}, CURRENT_DATE,
      ${coverage ? clamp(Number(coverage.overallPct)) : null},
      ${coverage?.sourceFormat ?? null},
      ${docHealth}, ${depHealth}, ${security}, ${complexity}, ${ownership}
    )
    ON CONFLICT (org_id, repo_id, scored_at, algorithm_version) DO UPDATE SET
      test_health = EXCLUDED.test_health, test_health_source = EXCLUDED.test_health_source,
      doc_health = EXCLUDED.doc_health, dep_health = EXCLUDED.dep_health,
      security = EXCLUDED.security, complexity = EXCLUDED.complexity, ownership = EXCLUDED.ownership
  `);
}

async function computeSecurityScore(orgId: string, repoId: string): Promise<number | null> {
  const row = await one<{ securityJson: { findings?: Array<{ severity: string }> } | null }>(sql`
    SELECT r.security_json AS "securityJson"
    FROM pr_ai_reviews r
    JOIN pull_requests p ON p.id = r.pr_id AND p.org_id = r.org_id
    WHERE r.org_id = ${orgId} AND p.repo_id = ${repoId} AND r.security_json IS NOT NULL
    ORDER BY r.created_at DESC LIMIT 1
  `);
  if (!row?.securityJson) return null;
  const weights: Record<string, number> = { critical: 40, high: 20, medium: 8, low: 3 };
  const penalty = (row.securityJson.findings ?? []).reduce((sum, f) => sum + (weights[f.severity] ?? 5), 0);
  return clamp(100 - penalty);
}

interface OsvBatchResponse {
  results: Array<{ vulns?: Array<{ id: string; database_specific?: { severity?: string } }> }>;
}

async function computeDepHealth(repoId: string): Promise<number | null> {
  const cloneDir = join(clonesDir(), repoId);
  if (!existsSync(join(cloneDir, 'HEAD'))) return null;
  try {
    const raw = await simpleGit(cloneDir).raw(['show', 'HEAD:package.json']);
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 200);
    if (deps.length === 0) return null;

    const queries = deps.map(([name, version]) => ({
      package: { name, ecosystem: 'npm' },
      version: version.replace(/^[\^~>=<]+/, ''),
    }));
    const response = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as OsvBatchResponse;
    const severeCount = data.results.reduce((sum, r) => {
      const severe = (r.vulns ?? []).filter((v) => {
        const s = (v.database_specific?.severity ?? '').toUpperCase();
        return s === 'CRITICAL' || s === 'HIGH';
      });
      return sum + severe.length;
    }, 0);
    return clamp(100 - severeCount * 15);
  } catch {
    return null; // no signal ≠ perfect score
  }
}

export const scorecardComputeWorker = new Worker(
  'scorecard-compute',
  async (job) => {
    if (job.name === 'dispatch') {
      const orgs = (await db.execute(sql`SELECT DISTINCT org_id AS "orgId" FROM repositories`)) as unknown as Array<{ orgId: string }>;
      for (const { orgId } of orgs) {
        await Queues.scorecardCompute.add('compute', { orgId }, { jobId: `scorecard-${orgId}-${new Date().toISOString().slice(0, 10)}` });
      }
      return;
    }

    const { orgId, repoId } = job.data as ScorecardComputeJob;
    const repos = repoId
      ? [{ id: repoId }]
      : ((await db.execute(sql`SELECT id FROM repositories WHERE org_id = ${orgId}`)) as unknown as Array<{ id: string }>);
    for (const repo of repos) {
      await computeRepoScores(orgId, repo.id);
    }
  },
  { connection: redis, concurrency: 1 },
);
