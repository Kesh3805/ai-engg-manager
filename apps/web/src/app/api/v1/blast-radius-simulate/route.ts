import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { getBlastRadius } from '@/server/graph';
import { requireResourceAccess } from '@/server/auth-guard';
import { errorResponse, ResourceNotFoundError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Impact simulation (plan 4b-5). Factual counts ONLY — estimatedEffortHours
 * is permanently out of scope (plan §14) and must never be added here.
 */
export async function GET(req: NextRequest) {
  try {
    const nodeId = req.nextUrl.searchParams.get('nodeId');
    if (!nodeId) return Response.json({ error: 'nodeId required' }, { status: 400 });

    const [node] = await sql<Array<{ orgId: string; repoId: string }>>`
      SELECT r.org_id AS "orgId", n.repo_id AS "repoId"
      FROM ast_nodes n JOIN repositories r ON r.id = n.repo_id
      WHERE n.id = ${nodeId} LIMIT 1`.catch(() => []);
    if (!node) throw new ResourceNotFoundError();
    await requireResourceAccess(node.orgId);

    const { affectedIds } = await getBlastRadius(nodeId);

    let affectedTestCount = 0;
    let affectedDeploymentCount = 0;
    if (affectedIds.length > 0) {
      const [tests] = await sql<Array<{ c: number }>>`
        SELECT count(*)::int AS c FROM ast_nodes
        WHERE id = ANY(${affectedIds})
          AND (file_path ~* '(\\.test\\.|\\.spec\\.|__tests__/)')`;
      affectedTestCount = tests?.c ?? 0;

      // Deployments that shipped commits touching any affected file (via EKG edges).
      const [deps] = await sql<Array<{ c: number }>>`
        SELECT count(DISTINCT d.id)::int AS c
        FROM ekg_edges m
        JOIN git_commits c ON c.id = m.from_id AND c.org_id = m.org_id
        JOIN deployments d ON d.commit_sha = c.sha AND d.org_id = c.org_id AND d.repo_id = c.repo_id
        WHERE m.org_id = ${node.orgId} AND m.from_type = 'commit' AND m.edge_type = 'MODIFIED'
          AND m.valid_until IS NULL AND m.to_id = ANY(${affectedIds})`;
      affectedDeploymentCount = deps?.c ?? 0;
    }

    return Response.json({
      affectedNodeCount: affectedIds.length,
      affectedTestCount,
      affectedDeploymentCount,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
