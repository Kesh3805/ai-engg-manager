import { sql } from '@/server/db';
import { listAuthorizedRepos, listOpenPullRequests, githubConfigured } from '@/server/github';
import { requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function riskOf(filesChanged: number, blast: number): 'high' | 'medium' | 'low' {
  if (blast >= 10 || filesChanged >= 8) return 'high';
  if (blast >= 3 || filesChanged >= 4) return 'medium';
  return 'low';
}

/**
 * Engineering overview built entirely from real data:
 *  - metrics + activity from the Postgres AST graph and ingestion history
 *  - PR risk radar from live GitHub open PRs, with blast radius computed from
 *    the ingested graph (empty until the GitHub App is installed)
 */
export async function GET() {
  try {
    await requireRole('viewer');
  } catch (err) {
    return errorResponse(err);
  }

  const [agg] = await sql<Array<{ repos: number; nodes: number; edges: number; avg_complexity: number; files: number }>>`
    SELECT
      (SELECT count(*)::int FROM repositories WHERE index_status = 'ready') AS repos,
      (SELECT count(*)::int FROM ast_nodes WHERE node_type <> 'file') AS nodes,
      (SELECT count(*)::int FROM ast_edges) AS edges,
      (SELECT COALESCE(round(avg(complexity))::int, 0) FROM ast_nodes WHERE node_type <> 'file' AND complexity IS NOT NULL) AS avg_complexity,
      (SELECT count(*)::int FROM ast_nodes WHERE node_type = 'file') AS files`;

  const metrics = [
    { id: 'repos', label: 'Indexed Repos', value: agg?.repos ?? 0 },
    { id: 'entities', label: 'Code Entities', value: agg?.nodes ?? 0 },
    { id: 'deps', label: 'Dependencies', value: agg?.edges ?? 0 },
    { id: 'complexity', label: 'Avg Complexity', value: agg?.avg_complexity ?? 0 },
  ];

  // Activity from real ingestion history.
  const runs = await sql<Array<{ id: string; full_name: string; nodes: number; status: string; at: string }>>`
    SELECT ir.id::text, r.full_name, COALESCE(ir.nodes_upserted, 0) AS nodes, ir.status,
           COALESCE(ir.completed_at, ir.started_at) AS at
    FROM ingestion_runs ir JOIN repositories r ON r.id = ir.repo_id
    ORDER BY COALESCE(ir.completed_at, ir.started_at) DESC LIMIT 8`;
  const activity = runs.map((r) => ({
    id: r.id,
    actor: 'indexer',
    text: r.status === 'complete' ? `indexed ${r.full_name} · ${r.nodes} entities` : `${r.status} ingestion of ${r.full_name}`,
    at: r.at,
  }));

  // PR risk radar from live GitHub (only for repos we've indexed, so blast is real).
  const riskyPRs: Array<Record<string, unknown>> = [];
  try {
    if (githubConfigured) {
      const indexedRepos = await sql<Array<{ id: string; full_name: string }>>`SELECT id, full_name FROM repositories`;
      const byName = new Map(indexedRepos.map((r) => [r.full_name.toLowerCase(), r.id]));
      const authorized = (await listAuthorizedRepos()).filter((g) => byName.has(g.fullName.toLowerCase()));
      for (const g of authorized.slice(0, 5)) {
        const repoId = byName.get(g.fullName.toLowerCase())!;
        const prs = await listOpenPullRequests(g, 6);
        for (const pr of prs) {
          let blast = 0;
          if (pr.changedPaths.length) {
            const [row] = await sql<Array<{ c: number }>>`
              SELECT count(*)::int AS c FROM ast_nodes WHERE repo_id = ${repoId} AND node_type <> 'file' AND file_path = ANY(${pr.changedPaths})`;
            blast = row?.c ?? 0;
          }
          riskyPRs.push({ id: `${g.fullName}#${pr.number}`, number: pr.number, title: pr.title, author: pr.author, url: pr.url, filesChanged: pr.filesChanged, blastRadius: blast, risk: riskOf(pr.filesChanged, blast) });
        }
      }
      riskyPRs.sort((a, b) => (b.blastRadius as number) - (a.blastRadius as number));
    }
  } catch (e) {
    console.error('[dashboard] github PR fetch failed:', e);
  }

  // Git velocity: commits/week for the last 12 weeks (empty until git history ingests).
  let gitVelocity: Array<{ week: string; commits: number }> = [];
  try {
    gitVelocity = await sql<Array<{ week: string; commits: number }>>`
      SELECT to_char(date_trunc('week', committed_at), 'YYYY-MM-DD') AS week, count(*)::int AS commits
      FROM git_commits
      WHERE committed_at > now() - interval '12 weeks'
      GROUP BY 1 ORDER BY 1 ASC`;
  } catch {
    gitVelocity = [];
  }

  return Response.json({ sprint: null, metrics, riskyPRs: riskyPRs.slice(0, 12), activity, gitVelocity, githubConfigured });
}
