import { sql } from '@/server/db';
import { requireSession } from '@/server/auth-guard';
import { errorResponse, UnauthorizedError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function tableExists(name: string): Promise<boolean> {
  const rows = await sql<Array<{ exists: boolean }>>`
    SELECT to_regclass(${'public.' + name}) IS NOT NULL AS exists`;
  return rows[0]?.exists ?? false;
}

/**
 * On-demand PII deletion (DATA_RETENTION.md §1). Requires a real session even
 * in local dev — anonymous callers have no data to delete.
 *
 * Synchronous part: wipe ekg_users PII + hard-delete the email cache row.
 * The async FK-nullification pass (git_commits.author_id, pr_reviews.reviewer_id)
 * is the user-deletion BullMQ job once the EKG ingestion phases land.
 */
export async function POST() {
  try {
    // A real session is required even in local dev — anonymous callers have no data to delete.
    const user = await requireSession();
    if (!user) throw new UnauthorizedError();

    let anonymizedRows = 0;

    if (user.email && (await tableExists('ekg_users'))) {
      const wiped = await sql<Array<{ id: string }>>`
        UPDATE ekg_users
        SET github_login = NULL, display_name = NULL, email = NULL, avatar_url = NULL,
            deleted_at = COALESCE(deleted_at, now()), anonymized_at = now()
        WHERE email = ${user.email}
        RETURNING id`;
      anonymizedRows = wiped.length;
    }

    if (user.email && (await tableExists('email_user_cache'))) {
      await sql`DELETE FROM email_user_cache WHERE email = ${user.email}`;
    }

    return Response.json({ ok: true, anonymizedRows });
  } catch (err) {
    return errorResponse(err);
  }
}
