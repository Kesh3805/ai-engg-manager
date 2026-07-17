import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { requireResourceAccess } from '@/server/auth-guard';
import { errorResponse, ResourceNotFoundError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Architecture timeline (plan 4b-1): GET ?repoId=&at=ISO_DATE.
 * Anchors on the closest indexed commit before `at` and returns the graph
 * entities known to exist by that commit. NOTE: the AST table stores the
 * latest parse per entity (not full historical snapshots), so entity shape
 * is current while membership is time-filtered — an approximation until
 * versioned snapshots ship.
 */
export async function GET(req: NextRequest) {
  try {
    const repoId = req.nextUrl.searchParams.get('repoId');
    const at = req.nextUrl.searchParams.get('at');
    if (!repoId || !at) return Response.json({ error: 'repoId and at required' }, { status: 400 });
    const atDate = new Date(at);
    if (Number.isNaN(atDate.getTime())) return Response.json({ error: 'invalid at date' }, { status: 400 });

    // Resource route: repo row supplies the org id.
    const [repo] = await sql<Array<{ id: string; orgId: string; fullName: string }>>`
      SELECT id, org_id AS "orgId", full_name AS "fullName" FROM repositories WHERE id = ${repoId}`.catch(() => []);
    if (!repo) throw new ResourceNotFoundError();
    await requireResourceAccess(repo.orgId);

    const [anchor] = await sql<Array<{ sha: string; committedAt: string; message: string | null; authorLogin: string | null }>>`
      SELECT sha, committed_at AS "committedAt", message, author_login AS "authorLogin"
      FROM git_commits
      WHERE org_id = ${repo.orgId} AND repo_id = ${repo.id} AND committed_at <= ${atDate}
      ORDER BY committed_at DESC LIMIT 1`;

    const nodes = await sql<Array<Record<string, unknown>>>`
      SELECT id, node_type AS "nodeType", name, file_path AS "filePath",
             qualified_name AS "qualifiedName", complexity
      FROM ast_nodes
      WHERE org_id = ${repo.orgId} AND repo_id = ${repo.id} AND created_at <= ${atDate}
      ORDER BY file_path, line_start NULLS FIRST
      LIMIT 220`;

    const ids = nodes.map((n) => n.id as string);
    const edges = ids.length
      ? await sql<Array<Record<string, unknown>>>`
          SELECT id::text, from_node AS source, to_node AS target, edge_type AS "edgeType"
          FROM ast_edges
          WHERE org_id = ${repo.orgId} AND repo_id = ${repo.id}
            AND from_node = ANY(${ids}) AND to_node = ANY(${ids})`
      : [];

    return Response.json({
      repo: { id: repo.id, fullName: repo.fullName },
      anchorCommit: anchor ?? null,
      nodes,
      edges,
      approximation: 'entity membership time-filtered; shapes reflect the latest parse',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
