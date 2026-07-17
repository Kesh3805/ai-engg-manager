import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { requireOrgListAccess, requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NODE_CAP = 500; // plan 4b-2 — React Flow stays responsive at this size

/**
 * Organization digital twin (plan 4b-2): a sampled EKG subgraph — top repos,
 * most active users, recent incidents and deployments, plus the active edges
 * among the sampled nodes. Hard cap of 500 nodes.
 */
export async function GET(req: NextRequest) {
  try {
    const requestedOrg = req.nextUrl.searchParams.get('orgId');
    const ctx = requestedOrg ? await requireOrgListAccess(requestedOrg) : await requireRole('viewer');
    const orgId = ctx.orgId;

    const repos = await sql<Array<Record<string, unknown>>>`
      SELECT id, full_name AS label, 'repo' AS kind FROM repositories
      WHERE org_id = ${orgId} ORDER BY updated_at DESC LIMIT 25`;

    const users = await sql<Array<Record<string, unknown>>>`
      SELECT u.id, COALESCE(u.github_login, 'anonymized') AS label, 'user' AS kind
      FROM ekg_users u
      WHERE u.org_id = ${orgId} AND u.deleted_at IS NULL
      ORDER BY (SELECT count(*) FROM git_commits c WHERE c.author_id = u.id AND c.org_id = u.org_id) DESC
      LIMIT 100`;

    const recentIncidents = await sql<Array<Record<string, unknown>>>`
      SELECT id, COALESCE(title, 'incident') AS label, 'incident' AS kind, severity, status
      FROM incidents WHERE org_id = ${orgId} ORDER BY triggered_at DESC NULLS LAST LIMIT 50`;

    const recentDeployments = await sql<Array<Record<string, unknown>>>`
      SELECT id, (environment || ' @ ' || left(COALESCE(commit_sha, '?'), 8)) AS label,
             'deployment' AS kind, status
      FROM deployments WHERE org_id = ${orgId} ORDER BY deployed_at DESC LIMIT 75`;

    const prs = await sql<Array<Record<string, unknown>>>`
      SELECT id, ('#' || number || ' ' || left(COALESCE(title, ''), 40)) AS label, 'pr' AS kind, state
      FROM pull_requests WHERE org_id = ${orgId} ORDER BY created_at DESC NULLS LAST LIMIT 100`;

    const nodes = [...repos, ...users, ...recentIncidents, ...recentDeployments, ...prs].slice(0, NODE_CAP);
    const nodeIds = nodes.map((n) => n.id as string);

    const edges = nodeIds.length
      ? await sql<Array<Record<string, unknown>>>`
          SELECT id::text, from_id AS source, to_id AS target, edge_type AS "edgeType"
          FROM ekg_edges
          WHERE org_id = ${orgId} AND valid_until IS NULL
            AND from_id = ANY(${nodeIds}) AND to_id = ANY(${nodeIds})
          LIMIT 1500`
      : [];

    return Response.json({ nodes, edges, cap: NODE_CAP });
  } catch (err) {
    return errorResponse(err);
  }
}
