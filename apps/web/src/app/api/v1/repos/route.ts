import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { listAuthorizedRepos, githubConfigured } from '@/server/github';
import { ingestRepo } from '@/server/ingest';
import { getSessionUser } from '@/server/session';
import { getOrCreateUserOrg, getActiveOrg } from '@/server/org';
import { requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RepoRow {
  id: string;
  fullName: string;
  defaultBranch: string;
  indexStatus: string;
  lastIndexedCommit: string | null;
  nodes: number | null;
  edges: number | null;
}

/** Indexed repos (from DB) + GitHub-authorized repos not yet indexed (pending). */
export async function GET() {
  try {
    await requireRole('viewer');
  } catch (err) {
    return errorResponse(err);
  }

  const repos = await sql<RepoRow[]>`
    SELECT r.id, r.full_name AS "fullName", r.default_branch AS "defaultBranch",
           r.index_status AS "indexStatus", r.last_indexed_commit AS "lastIndexedCommit",
           (SELECT count(*)::int FROM ast_nodes n WHERE n.repo_id = r.id) AS nodes,
           (SELECT count(*)::int FROM ast_edges e WHERE e.repo_id = r.id) AS edges
    FROM repositories r ORDER BY r.updated_at DESC`;

  let pending: Array<Omit<RepoRow, 'id'> & { id: string }> = [];
  try {
    if (githubConfigured) {
      const indexed = new Set(repos.map((r) => r.fullName.toLowerCase()));
      const authorized = await listAuthorizedRepos();
      pending = authorized
        .filter((g) => !indexed.has(g.fullName.toLowerCase()))
        .map((g) => ({ id: `gh:${g.fullName}`, fullName: g.fullName, defaultBranch: g.defaultBranch, indexStatus: 'pending', lastIndexedCommit: null, nodes: null, edges: null }));
    }
  } catch (e) {
    console.error('[repos] github listing failed:', e);
  }

  return Response.json({ repos: [...repos, ...pending], githubConfigured });
}

/** Link/index a repository: pulls it from GitHub and (re)builds its AST graph. Member+ action. */
export async function POST(req: NextRequest) {
  const { githubRepoFullName } = await req.json().catch(() => ({ githubRepoFullName: '' }));
  if (!githubRepoFullName) return Response.json({ error: 'githubRepoFullName required' }, { status: 400 });

  try {
    await requireRole('member');
  } catch (err) {
    return errorResponse(err);
  }

  const user = await getSessionUser();
  const orgId = user ? await getOrCreateUserOrg(user.id, user.name) : (await getActiveOrg())?.id;
  if (!orgId) return Response.json({ error: 'no organization available' }, { status: 400 });

  // Kick off ingestion in the background; the client polls GET for status.
  ingestRepo(githubRepoFullName, orgId).catch((e) => console.error('[repos] ingest failed:', e));

  return Response.json({ fullName: githubRepoFullName, indexStatus: 'indexing', queued: true }, { status: 202 });
}
