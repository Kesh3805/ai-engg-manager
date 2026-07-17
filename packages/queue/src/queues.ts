import { Queue, FlowProducer, type JobsOptions } from 'bullmq';
import { redis } from './redis.js';

/** Shared retry / backoff policy for ingestion-class jobs. */
export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 24 * 3600 }, // keep failures a day for the DLQ inspector
};

export const Queues = {
  repoIngestion: new Queue('repo-ingestion', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  fileParsing: new Queue('file-parsing', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  embedNodes: new Queue('embed-nodes', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  collateralParse: new Queue('collateral-parse', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  deadLetter: new Queue('dead-letter', { connection: redis }),
  // ── EKG / agents (plan §12, Phase 2B+) ────────────────────────────────────
  gitHistory: new Queue('git-history', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  emailResolve: new Queue('email-resolve', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  ekgEdgeBatch: new Queue('ekg-edge-batch', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  designReview: new Queue('design-review', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  incidentAnalysis: new Queue('incident-analysis', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  // Doc generation: NO jobId dedup key — concurrency is handled by the atomic
  // SQL claim on repositories.last_doc_pr_at (plan §7).
  docGeneration: new Queue('doc-generation', {
    connection: redis,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  }),
  adrIngestion: new Queue('adr-ingestion', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  scorecardCompute: new Queue('scorecard-compute', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  hotspotAnalysis: new Queue('hotspot-analysis', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  ekgReconcile: new Queue('ekg-reconcile', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  retention: new Queue('retention', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
  userDeletion: new Queue('user-deletion', { connection: redis, defaultJobOptions: DEFAULT_JOB_OPTS }),
} as const;

export const flowProducer = new FlowProducer({ connection: redis });

// ── Job payload contracts ────────────────────────────────────────────────────

export type ChangedFile = {
  path: string;
  status: 'modified' | 'renamed' | 'deleted';
  oldPath?: string;
};

export type RepoIngestionJob = {
  repoId: string;
  orgId: string;
  commitHash: string;
  changedFiles: ChangedFile[];
  trigger: 'webhook' | 'manual' | 'initial';
  runId: string;
};

export type FileParsingJob = {
  repoId: string;
  orgId: string;
  commitHash: string;
  filePath: string;
  depth: 0 | 1; // depth=1 = collateral re-parse, never spawns further collateral
};

export type EmbedNodesJob = {
  orgId: string;
  nodeIds: string[]; // batched 50–100 per job
};

// ── Kafka schema contract (plan §5) ─────────────────────────────────────────

/**
 * Versioned envelope for every Kafka topic. Consumers support N and N-1
 * during 14-day migration windows; newer versions go to the dead-letter
 * queue with reason 'unsupported_schema_version'.
 */
export interface KafkaEnvelope<T> {
  schemaVersion: number;
  producedAt: string; // ISO timestamp
  orgId: string;
  payload: T;
}

// ── EKG job payload contracts ────────────────────────────────────────────────

export type GitHistoryJob = {
  orgId: string;
  repoId: string;
  repoUrl: string; // clone/fetch URL (installation-token URL is built by the worker)
  fullName: string; // 'owner/repo' for Commits-API author resolution
  installationId?: number; // absent → Commits-API resolution path is skipped
};

export type EmailResolveJob = {
  orgId: string;
  repoId: string;
  emails: string[]; // batched unresolved author emails
};

export type EkgEdgeSpec = {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  edgeType: string;
  metadata?: Record<string, unknown>;
};

export type EkgEdgeBatchJob = {
  orgId: string;
  edges: EkgEdgeSpec[];
};

export type DesignReviewJob = {
  orgId: string;
  repoId: string;
  prId: string; // pull_requests.id (UUIDv5)
  prNumber: number;
  headSha: string;
  baseSha: string;
  fullName: string;
  installationId?: number; // absent → never post a GitHub comment
};

export type IncidentAnalysisJob = {
  orgId: string;
  incidentId: string; // incidents.id (UUIDv5)
};

export type DocGenerationJob = {
  orgId: string;
  repoId: string;
  headSha: string;
};

export type AdrIngestionJob = {
  orgId: string;
  repoId: string;
  headSha: string;
};

export type ScorecardComputeJob = {
  orgId: string;
  repoId?: string; // absent = all repos in org
};

export type HotspotAnalysisJob = {
  orgId: string;
};

export type EkgReconcileJob = Record<string, never>; // weekly sweep, no params

export type UserDeletionJob = {
  orgId: string;
  ekgUserId: string;
};
