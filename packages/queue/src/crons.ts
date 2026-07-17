import { Queues } from './queues.js';

/**
 * Registers repeatable jobs. Idempotent — BullMQ dedups repeatable jobs by
 * jobId, so calling this on every worker boot is safe.
 */
export async function registerCronJobs(): Promise<void> {
  await Queues.repoIngestion.add('sync-jira', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'jira-sync-cron' });
  await Queues.repoIngestion.add('sync-linear', {}, { repeat: { pattern: '*/15 * * * *' }, jobId: 'linear-sync-cron' });
  // Daily Observational Memory compression — 18:30 UTC == midnight IST.
  await Queues.repoIngestion.add('compress-memory', {}, { repeat: { pattern: '30 18 * * *' }, jobId: 'memory-compression-cron' });

  // ── EKG hygiene (plan §12) ─────────────────────────────────────────────────
  // Weekly reconcile: orphan sweep, 18-month archive, git gc — Sundays 04:00.
  await Queues.ekgReconcile.add('reconcile', {}, { repeat: { pattern: '0 4 * * 0' }, jobId: 'ekg-reconcile-cron' });
  // Monthly retention sweep — 1st of the month, 05:00.
  await Queues.retention.add('retention-sweep', {}, { repeat: { pattern: '0 5 1 * *' }, jobId: 'retention-cron' });
  // Daily scorecard (02:00) and weekly hotspot analysis (Mondays 03:00):
  // 'dispatch' fans out one deduped job per org inside the worker.
  await Queues.scorecardCompute.add('dispatch', {}, { repeat: { pattern: '0 2 * * *' }, jobId: 'scorecard-dispatch-cron' });
  await Queues.hotspotAnalysis.add('dispatch', {}, { repeat: { pattern: '0 3 * * 1' }, jobId: 'hotspot-dispatch-cron' });
}
