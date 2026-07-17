import { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db, ekgId } from '@repo/db';
import { ekgUsers } from '@repo/db/schema';
import { getGithubClient, resolveEmailToLogin } from '@repo/integrations';
import type { Octokit } from '@octokit/rest';
import { redis } from '../redis.js';
import type { EmailResolveJob } from '../queues.js';
import { dbEmailCache } from '../lib/email-cache.js';
import { upsertEdges } from '../lib/ekg-edges.js';

/**
 * Path-3 author resolution (plan §6): email → GitHub Search API, heavily
 * cached. Runs as its own queue so Search-API rate limits never stall the
 * git-history walk. On success it backfills git_commits.author_id and the
 * AUTHORED edges for that email's commits.
 */

function searchClient(): Octokit | null {
  const installationId = Number(process.env.GITHUB_SEARCH_INSTALLATION_ID ?? 0);
  if (!installationId || !process.env.GITHUB_APP_ID) return null;
  return getGithubClient(installationId);
}

export const emailResolveWorker = new Worker(
  'email-resolve',
  async (job) => {
    const { orgId, repoId, emails } = job.data as EmailResolveJob;
    const octokit = searchClient();

    for (const email of emails) {
      const { login, isBot } = await resolveEmailToLogin(email, octokit, dbEmailCache);
      if (!login || isBot) continue;

      const userId = ekgId(orgId, 'user', login);
      await db
        .insert(ekgUsers)
        .values({ id: userId, orgId, githubLogin: login, email })
        .onConflictDoNothing();

      // Backfill commits recorded before this email resolved.
      const updated = await db.execute(sql`
        UPDATE git_commits SET author_id = ${userId}, author_login = ${login}
        WHERE org_id = ${orgId} AND repo_id = ${repoId}
          AND author_id IS NULL AND author_email = ${email}
        RETURNING id
      `);

      const commitIds = (updated as unknown as Array<{ id: string }>).map((r) => r.id);
      await upsertEdges(
        orgId,
        commitIds.map((commitId) => ({
          fromType: 'user',
          fromId: userId,
          toType: 'commit',
          toId: commitId,
          edgeType: 'AUTHORED',
        })),
      );
    }
  },
  { connection: redis, concurrency: 1 }, // Search API is rate-limited — serialize
);
