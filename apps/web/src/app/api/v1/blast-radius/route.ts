import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { getBlastRadius } from '@/server/graph';
import { requireResourceAccess } from '@/server/auth-guard';
import { errorResponse, ResourceNotFoundError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Node ids transitively affected by changing `nodeId` — recursive-CTE (DB). */
export async function GET(req: NextRequest) {
  const nodeId = req.nextUrl.searchParams.get('nodeId');
  if (!nodeId) return Response.json({ error: 'nodeId required' }, { status: 400 });
  try {
    // Resource route: resolve the node's org from the DB row, then gate on it.
    const rows = await sql<Array<{ orgId: string }>>`
      SELECT r.org_id AS "orgId" FROM ast_nodes n
      JOIN repositories r ON r.id = n.repo_id
      WHERE n.id = ${nodeId} LIMIT 1`.catch(() => []);
    if (!rows[0]) throw new ResourceNotFoundError();
    await requireResourceAccess(rows[0].orgId);

    const result = await getBlastRadius(nodeId);
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
