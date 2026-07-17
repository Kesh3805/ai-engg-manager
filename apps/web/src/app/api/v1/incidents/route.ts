import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { requireOrgListAccess, requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Incident list with their AI analyses (plan 4b-3). */
export async function GET(req: NextRequest) {
  try {
    const requestedOrg = req.nextUrl.searchParams.get('orgId');
    const ctx = requestedOrg ? await requireOrgListAccess(requestedOrg) : await requireRole('viewer');

    const incidents = await sql<Array<Record<string, unknown>>>`
      SELECT i.id, i.source, i.title, i.severity, i.status,
             i.triggered_at AS "triggeredAt", i.resolved_at AS "resolvedAt",
             a.id AS "analysisId", a.hypothesis, a.confidence_pct AS "confidencePct",
             a.remediation, a.shared_at AS "sharedAt", a.evidence_json AS "evidence"
      FROM incidents i
      LEFT JOIN LATERAL (
        SELECT * FROM incident_analyses a
        WHERE a.incident_id = i.id AND a.org_id = i.org_id
        ORDER BY a.created_at DESC LIMIT 1
      ) a ON true
      WHERE i.org_id = ${ctx.orgId}
      ORDER BY i.triggered_at DESC NULLS LAST
      LIMIT 100`;

    return Response.json({ incidents });
  } catch (err) {
    return errorResponse(err);
  }
}
