import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { requireOrgListAccess, requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Hotspot list (plan 4a-2): churn × complexity flagged files. */
export async function GET(req: NextRequest) {
  try {
    const requestedOrg = req.nextUrl.searchParams.get('orgId');
    const ctx = requestedOrg ? await requireOrgListAccess(requestedOrg) : await requireRole('viewer');

    const hotspots = await sql<Array<Record<string, unknown>>>`
      SELECT h.id, h.repo_id AS "repoId", r.full_name AS "repoFullName",
             h.file_path AS "filePath", h.churn_score AS "churnScore",
             h.complexity_score AS "complexityScore", h.bug_rate AS "bugRate",
             h.last_updated_at AS "lastUpdatedAt"
      FROM hotspots h
      LEFT JOIN repositories r ON r.id = h.repo_id
      WHERE h.org_id = ${ctx.orgId}
      ORDER BY h.churn_score DESC NULLS LAST, h.complexity_score DESC NULLS LAST
      LIMIT 50`;

    return Response.json({ hotspots });
  } catch (err) {
    return errorResponse(err);
  }
}
