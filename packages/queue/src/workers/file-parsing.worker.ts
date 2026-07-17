import { Worker } from 'bullmq';
import { extractFromFile } from '@repo/ast-parser';
import { redis } from '../redis.js';
import type { FileParsingJob } from '../queues.js';

/**
 * Child worker: parses a single file into nodes/edges and stages the result in
 * Redis under `ast:staged:<repo>:<commit>:<file>` for the parent to collect.
 * The file contents are fetched from object storage in production; here we read
 * from the staged blob the parent dropped, or skip if unavailable.
 */
export const fileParsingWorker = new Worker(
  'file-parsing',
  async (job) => {
    const { repoId, orgId, commitHash, filePath } = job.data as FileParsingJob;

    const contentKey = `ast:content:${repoId}:${commitHash}:${encodeURIComponent(filePath)}`;
    const content = await redis.get(contentKey);
    if (!content) return; // nothing to parse

    const { nodes, edges } = await extractFromFile(orgId, repoId, commitHash, filePath, content);

    const stagedKey = `ast:staged:${repoId}:${commitHash}:${encodeURIComponent(filePath)}`;
    await redis.set(stagedKey, JSON.stringify({ nodes, edges }), 'EX', 3600);

    return { filePath, nodes: nodes.length, edges: edges.length };
  },
  { connection: redis, concurrency: 8 },
);
