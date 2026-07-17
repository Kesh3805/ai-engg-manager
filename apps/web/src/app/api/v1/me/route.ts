import { getSessionUser } from '@/server/session';
import { getActiveOrg } from '@/server/org';
import { authEnforced } from '@/server/auth-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUBLIC_ROUTE — identity endpoint: returns only the caller's own session.
// When enforcement is on, anonymous callers get nulls (no org name leak).
export async function GET() {
  const user = await getSessionUser();
  if (!user && authEnforced()) return Response.json({ user: null, org: null });
  const org = await getActiveOrg();
  return Response.json({ user, org });
}
