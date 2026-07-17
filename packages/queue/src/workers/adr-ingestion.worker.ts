import { Worker } from 'bullmq';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { simpleGit } from 'simple-git';
import { sql } from 'drizzle-orm';
import { db, ekgId } from '@repo/db';
import { embed } from '@repo/mastra-agents';
import { redis } from '../redis.js';
import type { AdrIngestionJob } from '../queues.js';
import { clonesDir } from '../lib/repo-lock.js';

/**
 * ADR ingestion on merge to the default branch (plan 3d-1). Scans all three
 * conventional locations, parses YAML frontmatter, embeds and upserts.
 */

const ADR_GLOBS = [/^docs\/adr\/.+\.md$/, /^docs\/decisions\/.+\.md$/, /^rfcs\/.+\.md$/];

interface Frontmatter {
  title: string | null;
  status: string | null;
  date: string | null;
  authors: string[];
}

/** Tiny frontmatter parser — the four fields we need, no YAML dep. */
export function parseFrontmatter(content: string): { meta: Frontmatter; body: string } {
  const meta: Frontmatter = { title: null, status: null, date: null, authors: [] };
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!m) {
    // Fall back to the first heading as the title.
    const h1 = /^#\s+(.+)$/m.exec(content);
    return { meta: { ...meta, title: h1?.[1]?.trim() ?? null }, body: content };
  }
  for (const line of m[1]!.split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue!.replace(/^['"]|['"]$/g, '').trim();
    if (key === 'title') meta.title = value || null;
    else if (key === 'status') meta.status = value.toLowerCase() || null;
    else if (key === 'date') meta.date = value || null;
    else if (key === 'authors') {
      meta.authors = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((a) => a.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }
  return { meta, body: content.slice(m[0].length) };
}

const VALID_STATUSES = new Set(['proposed', 'accepted', 'deprecated', 'superseded']);

function adrNumber(path: string): number | null {
  const m = /(\d{1,5})[^/]*\.md$/.exec(path);
  return m ? Number(m[1]) : null;
}

export const adrIngestionWorker = new Worker(
  'adr-ingestion',
  async (job) => {
    const { orgId, repoId, headSha } = job.data as AdrIngestionJob;
    const cloneDir = join(clonesDir(), repoId);
    if (!existsSync(join(cloneDir, 'HEAD'))) return;
    const git = simpleGit(cloneDir);

    const tree = await git.raw(['ls-tree', '-r', '--name-only', headSha]).catch(() => '');
    const adrPaths = tree
      .split('\n')
      .map((l) => l.trim())
      .filter((p) => ADR_GLOBS.some((g) => g.test(p)));

    for (const path of adrPaths) {
      const content = await git.raw(['show', `${headSha}:${path}`]).catch(() => null);
      if (content === null) continue;

      const { meta } = parseFrontmatter(content);
      const number = adrNumber(path);
      const id = ekgId(orgId, 'adr', `${repoId}::${number ?? path}`);
      const status = meta.status && VALID_STATUSES.has(meta.status) ? meta.status : 'accepted';

      let embedding: number[] = [];
      try {
        embedding = await embed(`${meta.title ?? path}\n\n${content}`);
      } catch (err) {
        console.error(`[adr-ingestion] embedding failed for ${path}:`, err);
      }

      await db.execute(sql`
        INSERT INTO adrs (id, org_id, repo_id, number, title, status, content, embedding, decided_at, authors)
        VALUES (
          ${id}, ${orgId}, ${repoId}, ${number}, ${meta.title ?? path}, ${status}, ${content},
          ${embedding.length ? `[${embedding.join(',')}]` : null}::vector,
          ${meta.date ? new Date(meta.date) : null},
          ${meta.authors.length ? meta.authors : null}::text[]
        )
        ON CONFLICT (org_id, id) DO UPDATE SET
          title = EXCLUDED.title, status = EXCLUDED.status, content = EXCLUDED.content,
          embedding = EXCLUDED.embedding, decided_at = EXCLUDED.decided_at, authors = EXCLUDED.authors
      `);
    }
  },
  { connection: redis, concurrency: 2 },
);
