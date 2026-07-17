import { Worker } from 'bullmq';
import { redis } from '../redis.js';
import type { EkgEdgeBatchJob } from '../queues.js';
import { upsertEdges } from '../lib/ekg-edges.js';

/** Bulk ekg_edges upsert — the fan-out target for large edge sets. */
export const ekgEdgeBatchWorker = new Worker(
  'ekg-edge-batch',
  async (job) => {
    const { orgId, edges } = job.data as EkgEdgeBatchJob;
    await upsertEdges(orgId, edges);
  },
  { connection: redis, concurrency: 4 },
);
