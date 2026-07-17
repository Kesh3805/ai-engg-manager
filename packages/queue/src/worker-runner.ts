/**
 * Boots every BullMQ worker in a single process and registers cron jobs.
 * Run with `pnpm --filter @repo/queue worker`.
 */
import { registerCronJobs } from './crons.js';
import { repoIngestionWorker } from './workers/repo-ingestion.worker.js';
import { fileParsingWorker } from './workers/file-parsing.worker.js';
import { embedNodesWorker } from './workers/embed-nodes.worker.js';
import { gitHistoryWorker } from './workers/git-history.worker.js';
import { emailResolveWorker } from './workers/email-resolve.worker.js';
import { ekgEdgeBatchWorker } from './workers/ekg-edge-batch.worker.js';
import { ekgReconcileWorker } from './workers/ekg-reconcile.worker.js';
import { retentionWorker } from './workers/retention.worker.js';
import { userDeletionWorker } from './workers/user-deletion.worker.js';
import { designReviewWorker } from './workers/design-review.worker.js';
import { incidentAnalysisWorker } from './workers/incident-analysis.worker.js';
import { docGenerationWorker } from './workers/doc-generation.worker.js';
import { adrIngestionWorker } from './workers/adr-ingestion.worker.js';
import { scorecardComputeWorker } from './workers/scorecard-compute.worker.js';
import { hotspotAnalysisWorker } from './workers/hotspot-analysis.worker.js';

async function main() {
  await registerCronJobs();
  // eslint-disable-next-line no-console
  console.log('[queue] workers online:', [
    repoIngestionWorker.name,
    fileParsingWorker.name,
    embedNodesWorker.name,
    gitHistoryWorker.name,
    emailResolveWorker.name,
    ekgEdgeBatchWorker.name,
    ekgReconcileWorker.name,
    retentionWorker.name,
    userDeletionWorker.name,
    designReviewWorker.name,
    incidentAnalysisWorker.name,
    docGenerationWorker.name,
    adrIngestionWorker.name,
    scorecardComputeWorker.name,
    hotspotAnalysisWorker.name,
  ]);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[queue] failed to start', err);
  process.exit(1);
});
