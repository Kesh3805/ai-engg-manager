import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { embed } from '@/server/llm';
import { requireOrgListAccess, requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * ADR list + pgvector semantic search (plan 4b-4).
 * GET ?q=<query> ranks by cosine similarity of the bge-m3 embedding.
 */
export async function GET(req: NextRequest) {
  try {
    const requestedOrg = req.nextUrl.searchParams.get('orgId');
    const ctx = requestedOrg ? await requireOrgListAccess(requestedOrg) : await requireRole('viewer');
    const query = req.nextUrl.searchParams.get('q')?.trim();

    if (query) {
      let queryVec: number[] = [];
      try {
        [queryVec = []] = await embed([query], 'query');
      } catch (e) {
        console.error('[adrs] query embedding failed:', e);
      }
      if (queryVec.length > 0) {
        const results = await sql<Array<Record<string, unknown>>>`
          SELECT a.id, a.number, a.title, a.status, a.content, a.decided_at AS "decidedAt",
                 a.authors, r.full_name AS "repoFullName",
                 1 - (a.embedding <=> ${`[${queryVec.join(',')}]`}::vector) AS similarity
          FROM adrs a
          LEFT JOIN repositories r ON r.id = a.repo_id
          WHERE a.org_id = ${ctx.orgId} AND a.embedding IS NOT NULL
          ORDER BY a.embedding <=> ${`[${queryVec.join(',')}]`}::vector
          LIMIT 20`;
        return Response.json({ adrs: results, mode: 'semantic' });
      }
    }

    const adrs = await sql<Array<Record<string, unknown>>>`
      SELECT a.id, a.number, a.title, a.status, a.content, a.decided_at AS "decidedAt",
             a.authors, r.full_name AS "repoFullName"
      FROM adrs a
      LEFT JOIN repositories r ON r.id = a.repo_id
      WHERE a.org_id = ${ctx.orgId}
      ORDER BY a.number DESC NULLS LAST, a.decided_at DESC NULLS LAST
      LIMIT 100`;
    return Response.json({ adrs, mode: 'list' });
  } catch (err) {
    return errorResponse(err);
  }
}
