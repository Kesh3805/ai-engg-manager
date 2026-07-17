import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sql } from '@/server/db';
import { parseCoverage } from '@/server/coverage';
import { errorResponse, UnauthorizedError, ResourceNotFoundError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUBLIC_ROUTE — CI push endpoint: authenticated by Bearer token (below),
// not by a browser session. Org scoping is derived from the repo row.
// NOTE: single shared token (COVERAGE_API_TOKEN env) until a per-org API
// token table ships; the org is still resolved from the DB, never the client.

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB

function tokenValid(header: string | null): boolean {
  const expected = process.env.COVERAGE_API_TOKEN;
  if (!expected || !header?.startsWith('Bearer ')) return false;
  const received = header.slice(7);
  if (received.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(received, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!tokenValid(req.headers.get('authorization'))) throw new UnauthorizedError('invalid API token');

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return Response.json({ error: 'body exceeds 2MB limit' }, { status: 413 });
    }
    const body = JSON.parse(raw) as { repoId?: string; commitSha?: string; format?: string; content?: string };
    if (!body.repoId || !body.format || !body.content) {
      return Response.json({ error: 'repoId, format, content required' }, { status: 400 });
    }

    const [repo] = await sql<Array<{ id: string; orgId: string }>>`
      SELECT id, org_id AS "orgId" FROM repositories WHERE id = ${body.repoId}`.catch(() => []);
    if (!repo) throw new ResourceNotFoundError('repository not found');

    const summary = parseCoverage(body.format, body.content);

    const [report] = await sql<Array<{ id: string }>>`
      INSERT INTO coverage_reports (org_id, repo_id, algorithm_version, commit_sha, source_format,
                                    report_date, overall_pct, line_pct, branch_pct, function_pct)
      VALUES (${repo.orgId}, ${repo.id}, 1, ${body.commitSha ?? null}, ${body.format},
              CURRENT_DATE, ${summary.overallPct}, ${summary.linePct}, ${summary.branchPct}, ${summary.functionPct})
      ON CONFLICT (org_id, repo_id, report_date, algorithm_version) DO UPDATE SET
        commit_sha = EXCLUDED.commit_sha, source_format = EXCLUDED.source_format,
        overall_pct = EXCLUDED.overall_pct, line_pct = EXCLUDED.line_pct,
        branch_pct = EXCLUDED.branch_pct, function_pct = EXCLUDED.function_pct
      RETURNING id`;

    // Replace per-file detail for this report (idempotent re-push).
    await sql`DELETE FROM coverage_file_stats WHERE coverage_id = ${report!.id}`;
    for (const file of summary.files.slice(0, 2_000)) {
      await sql`
        INSERT INTO coverage_file_stats (coverage_id, file_path, line_pct, branch_pct, uncovered_lines)
        VALUES (${report!.id}, ${file.filePath}, ${file.linePct}, ${file.branchPct}, ${file.uncoveredLines})`;
    }

    return Response.json({ reportId: report!.id, overallPct: summary.overallPct });
  } catch (err) {
    if (err instanceof SyntaxError) return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    return errorResponse(err);
  }
}
