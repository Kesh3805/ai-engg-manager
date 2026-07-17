import { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { redis } from '../redis.js';
import type { UserDeletionJob } from '../queues.js';

/**
 * Async half of on-demand PII deletion (DATA_RETENTION.md §1): nulls the FK
 * references that the synchronous request handler doesn't touch. Idempotent —
 * safe to retry.
 */
export const userDeletionWorker = new Worker(
  'user-deletion',
  async (job) => {
    const { orgId, ekgUserId } = job.data as UserDeletionJob;

    await db.execute(sql`
      UPDATE git_commits
      SET author_id = NULL, author_login = NULL, author_email = NULL
      WHERE org_id = ${orgId} AND author_id = ${ekgUserId}
    `);
    await db.execute(sql`
      UPDATE pr_reviews SET reviewer_id = NULL
      WHERE org_id = ${orgId} AND reviewer_id = ${ekgUserId}
    `);
    await db.execute(sql`
      UPDATE pull_requests SET author_id = NULL, author_login = NULL
      WHERE org_id = ${orgId} AND author_id = ${ekgUserId}
    `);
  },
  { connection: redis, concurrency: 1 },
);
