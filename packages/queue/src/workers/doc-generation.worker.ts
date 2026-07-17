import { Worker } from 'bullmq';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import { sql, eq } from 'drizzle-orm';
import { db } from '@repo/db';
import { repositories } from '@repo/db/schema';
import { runDocAgent, llmConfigured } from '@repo/mastra-agents';
import { getGithubClient, openDocPr, getSlackClient, postSlackMessage } from '@repo/integrations';
import { redis } from '../redis.js';
import type { DocGenerationJob } from '../queues.js';
import { clonesDir } from '../lib/repo-lock.js';
import { applyUnifiedDiff, splitDiffByFile } from '../lib/unified-diff.js';

/**
 * Documentation agent worker (plan 3c-2 / §7). Safeguards, in order:
 *   1. doc_agent_enabled = false        → exit cleanly
 *   2. atomic weekly SQL claim          → 0 rows = another job owns this week
 *   3. generate diff via doc.agent
 *   4. changedLines > 200               → no PR; Slack notification instead
 *   5. changedLines = 0                 → exit cleanly
 *   6. open PR labelled ai-generated, docs
 *   7. on failure                       → reset claim, re-throw (BullMQ retries)
 *
 * Queue opts: attempts 3, exponential 60s, NO jobId dedup (queues.ts).
 */
export const docGenerationWorker = new Worker(
  'doc-generation',
  async (job) => {
    const { orgId, repoId, headSha } = job.data as DocGenerationJob;

    const repo = await db.query.repositories.findFirst({ where: eq(repositories.id, repoId) });
    if (!repo || repo.orgId !== orgId) return;

    // 1. Opt-in only.
    if (!repo.docAgentEnabled) return;
    if (!llmConfigured()) return;

    // 2. Atomic claim — one doc PR per repo per week, race-free.
    const claimed = (await db.execute(sql`
      UPDATE repositories
      SET last_doc_pr_at = now()
      WHERE id = ${repoId}
        AND (last_doc_pr_at IS NULL OR last_doc_pr_at < now() - interval '7 days')
      RETURNING id
    `)) as unknown as Array<{ id: string }>;
    if (claimed.length === 0) return; // another job owns this week, exit cleanly

    try {
      const cloneDir = join(clonesDir(), repoId);
      if (!existsSync(join(cloneDir, 'HEAD'))) return;
      const git = simpleGit(cloneDir);

      // AST-level diff summary: changed entities since the last doc pass.
      const sinceSha = repo.lastCommitIndexedSha ?? `${headSha}~20`;
      const astDiff = await git
        .raw(['diff', '--stat', `${sinceSha}..${headSha}`])
        .catch(() => 'diff unavailable');

      // Current docs from the clone (README + docs/**.md).
      const docPathsRaw = await git
        .raw(['ls-tree', '-r', '--name-only', headSha])
        .catch(() => '');
      const docPaths = docPathsRaw
        .split('\n')
        .map((l) => l.trim())
        .filter((p) => p === 'README.md' || (p.startsWith('docs/') && p.endsWith('.md')))
        .slice(0, 10);
      if (docPaths.length === 0) return;

      const docs = [];
      for (const path of docPaths) {
        const content = await git.raw(['show', `${headSha}:${path}`]).catch(() => null);
        if (content !== null) docs.push({ path, content });
      }

      // 3. Generate.
      const { diff, changedLines } = await runDocAgent({ astDiff, docs });

      // 5. Nothing meaningful changed.
      if (changedLines === 0) return;

      // 4. Oversized diff: never auto-PR; notify humans with the artifact.
      if (changedLines > 200) {
        const botToken = process.env.SLACK_BOT_TOKEN;
        const channel = process.env.SLACK_STAGING_CHANNEL;
        if (botToken && channel) {
          await postSlackMessage(
            getSlackClient(botToken),
            channel,
            `📝 Doc agent produced a ${changedLines}-line diff for ${repo.fullName} — too large to auto-PR. Review required.\n\`\`\`\n${diff.slice(0, 2_000)}\n…\n\`\`\``,
          ).catch((err) => console.error('[doc-generation] slack notify failed:', err));
        }
        return;
      }

      // 6. Open the PR (requires a GitHub App installation).
      const installationId = Number(process.env.GITHUB_SEARCH_INSTALLATION_ID ?? 0);
      if (!installationId) return;
      const [owner, repoName] = repo.fullName.split('/');
      if (!owner || !repoName) return;

      const files: Array<{ path: string; content: string }> = [];
      for (const [path, fileDiff] of splitDiffByFile(diff)) {
        const doc = docs.find((d) => d.path === path);
        if (!doc) continue;
        const patched = applyUnifiedDiff(doc.content, fileDiff);
        if (patched !== null) files.push({ path, content: patched });
      }
      if (files.length === 0) return;

      await openDocPr(getGithubClient(installationId), {
        owner,
        repo: repoName,
        baseBranch: repo.defaultBranch,
        branchName: `ai-docs/${headSha.slice(0, 8)}-${Date.now().toString(36)}`,
        title: `docs: AI-generated documentation updates (${headSha.slice(0, 8)})`,
        body: 'Automated documentation refresh from the doc agent. Review before merging.\n\n_Labels: ai-generated, docs_',
        files,
        labels: ['ai-generated', 'docs'],
      });
    } catch (err) {
      // 7. Failure must not waste the weekly slot.
      await db.execute(sql`UPDATE repositories SET last_doc_pr_at = NULL WHERE id = ${repoId}`);
      throw err; // BullMQ retries with backoff
    }
  },
  { connection: redis, concurrency: 1 },
);
