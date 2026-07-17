import { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { redis } from '../redis.js';

/**
 * Monthly retention sweep (DATA_RETENTION.md §2 — internal offboarding
 * policy, NOT the on-demand GDPR path, which runs synchronously plus the
 * user-deletion job).
 */
export const retentionWorker = new Worker(
  'retention',
  async () => {
    // 1. Unlink authorship for users offboarded >90 days ago (covers rows
    //    written by in-flight ingestion after the on-demand pass ran).
    await db.execute(sql`
      UPDATE git_commits c
      SET author_id = NULL, author_login = NULL, author_email = NULL
      FROM ekg_users u
      WHERE u.id = c.author_id AND u.org_id = c.org_id
        AND u.deleted_at IS NOT NULL AND u.deleted_at < now() - interval '90 days'
    `);
    await db.execute(sql`
      UPDATE pr_reviews r
      SET reviewer_id = NULL
      FROM ekg_users u
      WHERE u.id = r.reviewer_id AND u.org_id = r.org_id
        AND u.deleted_at IS NOT NULL AND u.deleted_at < now() - interval '90 days'
    `);

    // 2. Per-file coverage detail: 90-day TTL (aggregates are kept).
    await db.execute(sql`
      DELETE FROM coverage_file_stats
      WHERE coverage_id IN (
        SELECT id FROM coverage_reports WHERE created_at < now() - interval '90 days'
      )
    `);

    // 3. Email cache: rolling 180-day TTL.
    await db.execute(sql`DELETE FROM email_user_cache WHERE expires_at < now()`);
  },
  { connection: redis, concurrency: 1 },
);
