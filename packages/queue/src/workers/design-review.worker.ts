import { Worker } from 'bullmq';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { db } from '@repo/db';
import { astNodes, adrs, prAiReviews } from '@repo/db/schema';
import {
  coordinatePrReview,
  designReviewAgent,
  llmConfigured,
  type DesignReviewInput,
  type ScannerFinding,
} from '@repo/mastra-agents';
import { getGithubClient, postPrComment } from '@repo/integrations';
import { redis } from '../redis.js';
import type { DesignReviewJob } from '../queues.js';
import { clonesDir } from '../lib/repo-lock.js';
import { runGitleaks, runSemgrep } from '../lib/scanners.js';

/**
 * Design review + security synthesis on PR open/synchronize (plan 3a-4).
 * Both agents run in parallel via the coordinator; the merged result is
 * persisted to pr_ai_reviews and — only when a GitHub installation id is
 * present — posted as a single PR comment.
 */

async function changedFilesFromClone(repoId: string, baseSha: string, headSha: string): Promise<string[]> {
  const cloneDir = join(clonesDir(), repoId);
  if (!existsSync(join(cloneDir, 'HEAD'))) return [];
  try {
    const out = await simpleGit(cloneDir).raw(['diff', '--name-only', `${baseSha}...${headSha}`]);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** Import cycles among the changed files, straight from the AST edge table. */
async function detectCycles(orgId: string, repoId: string, files: string[]): Promise<string[][]> {
  if (files.length === 0) return [];
  const rows = await db.execute(sql`
    WITH file_imports AS (
      SELECT DISTINCT nf.file_path AS from_file, nt.file_path AS to_file
      FROM ast_edges e
      JOIN ast_nodes nf ON nf.id = e.from_node AND nf.org_id = e.org_id
      JOIN ast_nodes nt ON nt.id = e.to_node AND nt.org_id = e.org_id
      WHERE e.org_id = ${orgId} AND e.repo_id = ${repoId}
        AND e.edge_type IN ('IMPORTS','CALLS','USAGE')
        AND nf.file_path <> nt.file_path
        AND nf.file_path = ANY(${files}::text[])
    )
    SELECT a.from_file, a.to_file
    FROM file_imports a
    JOIN file_imports b ON a.from_file = b.to_file AND a.to_file = b.from_file
    WHERE a.from_file < a.to_file
  `);
  return (rows as unknown as Array<{ from_file: string; to_file: string }>).map((r) => [r.from_file, r.to_file, r.from_file]);
}

export const designReviewWorker = new Worker(
  'design-review',
  async (job) => {
    const data = job.data as DesignReviewJob;
    if (!llmConfigured()) return; // agents disabled without an LLM key

    const changedFiles = await changedFilesFromClone(data.repoId, data.baseSha, data.headSha);

    // Blast radius of every entity in the changed files (depth-limited CTE).
    const blast = changedFiles.length
      ? ((await db.execute(sql`
          WITH RECURSIVE seed AS (
            SELECT id, name, node_type, file_path, 0 AS depth, ARRAY[id] AS visited
            FROM ast_nodes
            WHERE org_id = ${data.orgId} AND repo_id = ${data.repoId}
              AND node_type <> 'file' AND file_path = ANY(${changedFiles}::text[])
          ), blast AS (
            SELECT * FROM seed
            UNION ALL
            SELECT n.id, n.name, n.node_type, n.file_path, b.depth + 1, b.visited || n.id
            FROM blast b
            JOIN ast_edges e ON e.to_node = b.id AND e.edge_type IN ('CALLS','USAGE','IMPLEMENTS') AND e.org_id = ${data.orgId}
            JOIN ast_nodes n ON n.id = e.from_node AND n.org_id = ${data.orgId}
            WHERE b.depth < 5 AND NOT (n.id = ANY(b.visited))
          )
          SELECT DISTINCT id, name, node_type AS "nodeType", file_path AS "filePath", MIN(depth) AS depth
          FROM blast GROUP BY id, name, node_type, file_path LIMIT 200
        `)) as unknown as Array<{ name: string; nodeType: string; filePath: string; depth: number }>)
      : [];

    const [{ total } = { total: 0 }] = (await db.execute(sql`
      SELECT count(*)::int AS total FROM ast_nodes
      WHERE org_id = ${data.orgId} AND repo_id = ${data.repoId} AND node_type <> 'file'
    `)) as unknown as Array<{ total: number }>;

    const orgAdrs = await db
      .select({ number: adrs.number, title: adrs.title, status: adrs.status, content: adrs.content })
      .from(adrs)
      .where(and(eq(adrs.orgId, data.orgId), eq(adrs.repoId, data.repoId)))
      .limit(20);

    const designInput: DesignReviewInput = {
      prTitle: `PR #${data.prNumber}`,
      changedFiles,
      blastRadius: blast,
      totalGraphNodes: total,
      adrs: orgAdrs.map((a) => ({ number: a.number, title: a.title, status: a.status, excerpt: (a.content ?? '').slice(0, 500) })),
      layerRules: ['apps/ handles HTTP only — all domain logic in packages/', 'packages/db owns every schema table'],
      detectedCycles: await detectCycles(data.orgId, data.repoId, changedFiles),
    };

    // Scanners: changed files only (plan §9), against the persistent clone.
    const cloneDir = join(clonesDir(), data.repoId);
    const scannerFindings: ScannerFinding[] = existsSync(join(cloneDir, 'HEAD'))
      ? [...(await runGitleaks(cloneDir)), ...(await runSemgrep(cloneDir, changedFiles))]
      : [];

    const { design, security, comment } = await coordinatePrReview(designInput, scannerFindings);

    let postedCommentId: string | null = null;
    if (data.installationId) {
      const [owner, repo] = data.fullName.split('/');
      if (owner && repo) {
        try {
          postedCommentId = await postPrComment(getGithubClient(data.installationId), owner, repo, data.prNumber, comment);
        } catch (err) {
          console.error('[design-review] PR comment failed:', err);
        }
      }
    }

    await db.insert(prAiReviews).values({
      orgId: data.orgId,
      prId: data.prId,
      reviewJson: design,
      securityJson: security,
      postedGithubCommentId: postedCommentId,
      agentVersion: designReviewAgent.agentVersion,
    });
  },
  { connection: redis, concurrency: 2 },
);
