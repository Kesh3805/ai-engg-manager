import { getGraph } from '@/server/graph';
import { requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** AST graph for the Architecture Map — DB-backed. */
export async function GET() {
  try {
    await requireRole('viewer');
    const payload = await getGraph();
    return Response.json(payload);
  } catch (err) {
    return errorResponse(err);
  }
}
