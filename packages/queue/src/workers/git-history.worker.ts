import { Worker } from 'bullmq';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { eq, sql, inArray } from 'drizzle-orm';
import { db, ekgId } from '@repo/db';
import { repositories, gitCommits, ekgUsers, astNodes } from '@repo/db/schema';
import { parseHistory, headSha, type GitCommit } from '@repo/git-parser';
import { isBotEmail, loginFromNoreply } from '@repo/integrations';
import { redis } from '../redis.js';
import { Queues, type GitHistoryJob, type EkgEdgeSpec } from '../queues.js';
import { acquireRepoLock, clonesDir } from '../lib/repo-lock.js';
import { upsertEdges } from '../lib/ekg-edges.js';

/**
 * Git history ingestion (plan §6).
 *
 * Concurrency guards, in order:
 *   1. BullMQ jobId `git-history-<repoId>` (enqueue-side, at-most-one active)
 *   2. Lock file in GIT_LOCKS_DIR (crash-safe, outside the clone dir)
 *
 * Clone strategy: persistent bare clone, `fetch --prune` on every run after
 * the first — incremental syncs never re-clone.
 */

async function syncClone(repoUrl: string, cloneDir: string): Promise<void> {
  if (existsSync(join(cloneDir, 'HEAD'))) {
    await simpleGit(cloneDir).fetch(['--prune', 'origin']);
  } else {
    await mkdir(cloneDir, { recursive: true });
    await simpleGit().clone(repoUrl, cloneDir, ['--bare']);
  }
}

/** email → login for the subset resolvable without any API call. */
function directResolve(commits: GitCommit[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const c of commits) {
    if (out.has(c.authorEmail)) continue;
    if (isBotEmail(c.authorEmail)) out.set(c.authorEmail, null); // bots: never a users row
    else out.set(c.authorEmail, loginFromNoreply(c.authorEmail));
  }
  return out;
}

export const gitHistoryWorker = new Worker(
  'git-history',
  async (job) => {
    const { orgId, repoId, repoUrl } = job.data as GitHistoryJob;

    const release = await acquireRepoLock(repoId);
    if (!release) return; // another worker holds the repo — jobId dedup will re-run later

    try {
      const cloneDir = join(clonesDir(), repoId);
      await syncClone(repoUrl, cloneDir);

      const repo = await db.query.repositories.findFirst({ where: eq(repositories.id, repoId) });
      const lastSha = repo?.lastCommitIndexedSha ?? undefined;
      const commits = await parseHistory(cloneDir, { sinceSha: lastSha });
      if (commits.length === 0) return;

      // ── Author resolution (bot filter → noreply parse → cache) ────────────
      const emailToLogin = directResolve(commits);
      const unknownEmails = [...emailToLogin.entries()].filter(([, v]) => v === null).map(([e]) => e)
        .filter((e) => !isBotEmail(e));

      if (unknownEmails.length > 0) {
        const cached = await db.query.emailUserCache.findMany({
          where: (t, { inArray: inArr }) => inArr(t.email, unknownEmails),
        });
        const stillUnknown = new Set(unknownEmails);
        for (const row of cached) {
          if (row.expiresAt && row.expiresAt.getTime() < Date.now()) continue;
          emailToLogin.set(row.email, row.isBot ? null : row.githubLogin);
          stillUnknown.delete(row.email);
        }
        // Path 3 is expensive — hand the misses to the email-resolve queue in batches.
        const misses = [...stillUnknown];
        for (let i = 0; i < misses.length; i += 50) {
          await Queues.emailResolve.add('resolve-batch', {
            orgId,
            repoId,
            emails: misses.slice(i, i + 50),
          });
        }
      }

      // ── Upsert ekg_users for resolved logins ──────────────────────────────
      const logins = [...new Set([...emailToLogin.values()].filter((l): l is string => !!l))];
      const loginToUserId = new Map(logins.map((l) => [l, ekgId(orgId, 'user', l)]));
      if (logins.length > 0) {
        await db
          .insert(ekgUsers)
          .values(logins.map((login) => ({ id: loginToUserId.get(login)!, orgId, githubLogin: login })))
          .onConflictDoNothing();
      }

      // ── Upsert git_commits (idempotent — UUIDv5 identity) ────────────────
      for (let i = 0; i < commits.length; i += 500) {
        const chunk = commits.slice(i, i + 500);
        await db
          .insert(gitCommits)
          .values(
            chunk.map((c) => {
              const login = emailToLogin.get(c.authorEmail) ?? null;
              return {
                id: ekgId(orgId, 'commit', `${repoId}::${c.sha}`),
                orgId,
                repoId,
                sha: c.sha,
                authorId: login ? loginToUserId.get(login)! : null,
                authorLogin: login,
                authorEmail: c.authorEmail,
                message: c.message,
                filesChanged: c.filesChanged,
                additions: c.additions,
                deletions: c.deletions,
                committedAt: c.committedAt,
              };
            }),
          )
          .onConflictDoNothing();
      }

      // ── EKG edges: user AUTHORED commit; commit MODIFIED ast file node ────
      const edges: EkgEdgeSpec[] = [];
      const touchedPaths = [...new Set(commits.flatMap((c) => c.files))];
      const fileNodes = touchedPaths.length
        ? await db
            .select({ id: astNodes.id, filePath: astNodes.filePath })
            .from(astNodes)
            .where(sql`${astNodes.repoId} = ${repoId} AND ${astNodes.nodeType} = 'file' AND ${inArray(astNodes.filePath, touchedPaths)}`)
        : [];
      const pathToNode = new Map(fileNodes.map((n) => [n.filePath, n.id]));

      for (const c of commits) {
        const commitId = ekgId(orgId, 'commit', `${repoId}::${c.sha}`);
        const login = emailToLogin.get(c.authorEmail);
        if (login) {
          edges.push({
            fromType: 'user',
            fromId: loginToUserId.get(login)!,
            toType: 'commit',
            toId: commitId,
            edgeType: 'AUTHORED',
          });
        }
        for (const file of c.files) {
          const nodeId = pathToNode.get(file);
          if (nodeId) {
            edges.push({ fromType: 'commit', fromId: commitId, toType: 'ast_node', toId: nodeId, edgeType: 'MODIFIED' });
          }
        }
      }
      // Small batches inline; large histories fan out to the edge-batch queue.
      if (edges.length <= 2_000) await upsertEdges(orgId, edges);
      else {
        for (let i = 0; i < edges.length; i += 2_000) {
          await Queues.ekgEdgeBatch.add('edge-batch', { orgId, edges: edges.slice(i, i + 2_000) });
        }
      }

      // ── Advance the history cursor (separate from the AST head) ──────────
      const head = await headSha(join(clonesDir(), repoId));
      await db.update(repositories).set({ lastCommitIndexedSha: head }).where(eq(repositories.id, repoId));
    } finally {
      await release();
    }
  },
  { connection: redis, concurrency: 2 },
);
