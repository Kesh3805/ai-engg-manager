import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { requireOrgListAccess, requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALGORITHM_VERSION = 1;

/**
 * Engineering scorecard (plan 3d-4): latest scores + 30-day history for
 * sparklines, same algorithm_version only. List route — client supplies
 * orgId (or omits it to use their own workspace org).
 */
export async function GET(req: NextRequest) {
  try {
    const requestedOrg = req.nextUrl.searchParams.get('orgId');
    const ctx = requestedOrg ? await requireOrgListAccess(requestedOrg) : await requireRole('viewer');
    const orgId = ctx.orgId;

    const latest = await sql<Array<Record<string, unknown>>>`
      SELECT DISTINCT ON (repo_id) s.repo_id AS "repoId", r.full_name AS "repoFullName",
             s.scored_at AS "scoredAt", s.algorithm_version AS "algorithmVersion",
             s.test_health AS "testHealth", s.test_health_source AS "testHealthSource",
             s.doc_health AS "docHealth", s.dep_health AS "depHealth",
             s.security, s.complexity, s.ownership
      FROM engineering_scores s
      LEFT JOIN repositories r ON r.id = s.repo_id
      WHERE s.org_id = ${orgId} AND s.algorithm_version = ${ALGORITHM_VERSION}
      ORDER BY repo_id, scored_at DESC`;

    const history = await sql<Array<Record<string, unknown>>>`
      SELECT repo_id AS "repoId", scored_at AS "scoredAt",
             test_health AS "testHealth", doc_health AS "docHealth", dep_health AS "depHealth",
             security, complexity, ownership
      FROM engineering_scores
      WHERE org_id = ${orgId} AND algorithm_version = ${ALGORITHM_VERSION}
        AND scored_at > CURRENT_DATE - 30
      ORDER BY scored_at ASC`;

    return Response.json({
      algorithmVersion: ALGORITHM_VERSION,
      disclaimer: 'Heuristic score — not an industry-certified metric',
      latest,
      history,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
