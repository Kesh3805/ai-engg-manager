import { KafkaJS } from '@confluentinc/kafka-javascript';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Queues, upsertEdges, type KafkaEnvelope, type EkgEdgeSpec } from '@repo/queue';
import { elastic, SLACK_INDEX, JIRA_INDEX } from '@repo/integrations';
import { db, ekgId } from '@repo/db';
import { repositories, pullRequests, prReviews, ekgUsers, incidents, deployments, gitCommits } from '@repo/db/schema';

const { Kafka } = KafkaJS;

// mTLS (Aiven): certificate material is passed as librdkafka file-path
// properties — the KafkaJS-compat `ssl` field only accepts a boolean.
const kafka = new Kafka({
  kafkaJS: { brokers: [process.env.CONFLUENT_BOOTSTRAP!] },
  'security.protocol': 'ssl',
  'ssl.ca.location': process.env.KAFKA_CA_PATH!,
  'ssl.certificate.location': process.env.KAFKA_CERT_PATH!,
  'ssl.key.location': process.env.KAFKA_KEY_PATH!,
});

const consumer = kafka.consumer({ kafkaJS: { groupId: 'telemetry-consumer-group' } });

// ── Envelope handling (plan §5 / VERSIONING.md) ──────────────────────────────

const SUPPORTED_VERSIONS: Record<string, number> = {
  'github.pull_requests': 1,
  'incidents.events': 1,
  'deployments.events': 1,
};

/** Returns the payload, or null after routing the message to the DLQ. */
async function openEnvelope<T>(topic: string, raw: string): Promise<KafkaEnvelope<T> | null> {
  const envelope = JSON.parse(raw) as KafkaEnvelope<T>;
  const current = SUPPORTED_VERSIONS[topic] ?? 1;
  if (envelope.schemaVersion === current) return envelope;
  if (envelope.schemaVersion === current - 1) {
    console.warn(`[kafka-telemetry] ${topic}: processing N-1 schemaVersion ${envelope.schemaVersion} (migration window)`);
    return envelope;
  }
  await Queues.deadLetter.add('dead-letter', {
    reason: 'unsupported_schema_version',
    topic,
    schemaVersion: envelope.schemaVersion,
    raw,
  });
  return null;
}

// ── Legacy topic handlers ────────────────────────────────────────────────────

async function getOrgForRepo(_repoId: number): Promise<string> {
  // Looked up from the repositories table in production.
  return process.env.DEFAULT_ORG_ID ?? '00000000-0000-0000-0000-000000000000';
}

async function handleGithubEvent({ event, payload }: { event: string; payload: any }) {
  if (event !== 'push') return;
  await Queues.repoIngestion.add('incremental-ingest', {
    repoId: payload.repository.id.toString(),
    orgId: await getOrgForRepo(payload.repository.id),
    commitHash: payload.after,
    changedFiles: deriveChangedFiles(payload.commits ?? []),
    trigger: 'webhook',
    runId: randomUUID(),
  });

  // EKG fan-out: git history sync on every push; doc agent + ADR ingestion
  // on merge to the default branch (sequenced doc → adr by the workers).
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.githubRepoId, String(payload.repository.id)),
  });
  if (!repo) return;

  await Queues.gitHistory.add(
    'git-history',
    {
      orgId: repo.orgId,
      repoId: repo.id,
      repoUrl: payload.repository.clone_url ?? `https://github.com/${repo.fullName}.git`,
      fullName: repo.fullName,
      installationId: payload.installation?.id,
    },
    { jobId: `git-history-${repo.id}` }, // primary concurrency guard (plan §6)
  );

  const defaultRef = `refs/heads/${repo.defaultBranch}`;
  if (payload.ref === defaultRef && payload.after) {
    await Queues.docGeneration.add('doc-generation', { orgId: repo.orgId, repoId: repo.id, headSha: payload.after });
    await Queues.adrIngestion.add('adr-ingestion', { orgId: repo.orgId, repoId: repo.id, headSha: payload.after });
  }
}

function deriveChangedFiles(commits: any[]) {
  const map = new Map<string, 'modified' | 'renamed' | 'deleted'>();
  for (const c of commits) {
    for (const f of c.added ?? []) map.set(f, 'modified');
    for (const f of c.modified ?? []) map.set(f, 'modified');
    for (const f of c.removed ?? []) map.set(f, 'deleted');
  }
  return [...map.entries()].map(([path, status]) => ({ path, status }));
}

async function indexSlackMessage(payload: any) {
  if (!elastic) return;
  const e = payload.event ?? {};
  await elastic.index({
    index: SLACK_INDEX,
    document: { org_id: payload.org_id, channel_id: e.channel, user_id: e.user, text: e.text, ts: e.ts },
  });
}

async function indexJiraEvent(payload: any) {
  if (!elastic) return;
  await elastic.index({ index: JIRA_INDEX, document: payload });
}

// ── Versioned topic handlers (plan 2c-3) ─────────────────────────────────────

interface PrEventPayload {
  action: string;
  repoGithubId: string;
  repoFullName: string;
  pr: {
    githubPrId: string;
    number: number;
    title: string;
    state: 'open' | 'closed';
    merged: boolean;
    authorLogin: string | null;
    baseSha: string;
    headSha: string;
    createdAt: string | null;
    mergedAt: string | null;
  };
  review?: { reviewerLogin: string | null; state: string; submittedAt: string | null };
  installationId?: number;
}

async function repoIdForGithubId(githubRepoId: string): Promise<string | null> {
  const row = await db.query.repositories.findFirst({
    where: eq(repositories.githubRepoId, githubRepoId),
    columns: { id: true },
  });
  return row?.id ?? null;
}

async function upsertEkgUser(orgId: string, login: string): Promise<string> {
  const id = ekgId(orgId, 'user', login);
  await db.insert(ekgUsers).values({ id, orgId, githubLogin: login }).onConflictDoNothing();
  return id;
}

async function handlePullRequestEvent(envelope: KafkaEnvelope<PrEventPayload>) {
  const { orgId, payload } = envelope;
  const repoId = await repoIdForGithubId(payload.repoGithubId);
  if (!repoId) return; // repo not linked in AIEM — nothing to attach to

  const prId = ekgId(orgId, 'pr', `${repoId}::${payload.pr.number}`);
  const state = payload.pr.merged ? 'merged' : payload.pr.state;
  const authorLogin = payload.pr.authorLogin;
  const authorId = authorLogin ? await upsertEkgUser(orgId, authorLogin) : null;

  await db
    .insert(pullRequests)
    .values({
      id: prId,
      orgId,
      repoId,
      githubPrId: payload.pr.githubPrId,
      number: payload.pr.number,
      title: payload.pr.title,
      state,
      authorId,
      authorLogin,
      baseSha: payload.pr.baseSha,
      headSha: payload.pr.headSha,
      mergedAt: payload.pr.mergedAt ? new Date(payload.pr.mergedAt) : null,
      createdAt: payload.pr.createdAt ? new Date(payload.pr.createdAt) : null,
    })
    .onConflictDoUpdate({
      target: [pullRequests.orgId, pullRequests.id],
      set: {
        title: payload.pr.title,
        state,
        headSha: payload.pr.headSha,
        mergedAt: payload.pr.mergedAt ? new Date(payload.pr.mergedAt) : null,
      },
    });

  const edges: EkgEdgeSpec[] = [];
  if (authorId) edges.push({ fromType: 'user', fromId: authorId, toType: 'pr', toId: prId, edgeType: 'AUTHORED' });

  if (payload.review) {
    const reviewerId = payload.review.reviewerLogin ? await upsertEkgUser(orgId, payload.review.reviewerLogin) : null;
    await db.insert(prReviews).values({
      orgId,
      prId,
      reviewerId,
      state: payload.review.state,
      submittedAt: payload.review.submittedAt ? new Date(payload.review.submittedAt) : null,
    });
    if (reviewerId) edges.push({ fromType: 'user', fromId: reviewerId, toType: 'pr', toId: prId, edgeType: 'REVIEWED' });
  }
  await upsertEdges(orgId, edges);

  if (payload.action === 'opened' || payload.action === 'synchronize') {
    await Queues.designReview.add(
      'design-review',
      {
        orgId,
        repoId,
        prId,
        prNumber: payload.pr.number,
        headSha: payload.pr.headSha,
        baseSha: payload.pr.baseSha,
        fullName: payload.repoFullName,
        installationId: payload.installationId,
      },
      { jobId: `design-review-${prId}-${payload.pr.headSha}` },
    );
  }
}

interface IncidentEventPayload {
  source: 'pagerduty' | 'datadog' | 'manual';
  externalId: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'triggered' | 'acknowledged' | 'resolved';
  triggeredAt: string | null;
  resolvedAt: string | null;
}

async function handleIncidentEvent(envelope: KafkaEnvelope<IncidentEventPayload>) {
  const { orgId, payload } = envelope;
  const incidentId = ekgId(orgId, 'incident', `${payload.source}::${payload.externalId}`);

  await db
    .insert(incidents)
    .values({
      id: incidentId,
      orgId,
      source: payload.source,
      externalId: payload.externalId,
      title: payload.title,
      severity: payload.severity,
      status: payload.status,
      triggeredAt: payload.triggeredAt ? new Date(payload.triggeredAt) : null,
      resolvedAt: payload.resolvedAt ? new Date(payload.resolvedAt) : null,
    })
    .onConflictDoUpdate({
      target: [incidents.orgId, incidents.id],
      set: {
        status: payload.status,
        resolvedAt: payload.resolvedAt ? new Date(payload.resolvedAt) : null,
      },
    });

  if (payload.status === 'triggered') {
    await Queues.incidentAnalysis.add(
      'incident-analysis',
      { orgId, incidentId },
      { jobId: `incident-analysis-${incidentId}` },
    );
  }
}

interface DeploymentEventPayload {
  deployId: string;
  repoFullName: string;
  environment: 'production' | 'staging' | 'preview';
  commitSha: string;
  status: 'success' | 'failure' | 'in_progress';
  deployedAt: string;
  deployedByLogin?: string;
}

async function handleDeploymentEvent(envelope: KafkaEnvelope<DeploymentEventPayload>) {
  const { orgId, payload } = envelope;
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.fullName, payload.repoFullName),
    columns: { id: true },
  });
  if (!repo) return;

  const deploymentId = ekgId(orgId, 'deployment', `${repo.id}::${payload.deployId}`);
  const deployedBy = payload.deployedByLogin ? await upsertEkgUser(orgId, payload.deployedByLogin) : null;

  await db
    .insert(deployments)
    .values({
      id: deploymentId,
      orgId,
      repoId: repo.id,
      environment: payload.environment,
      commitSha: payload.commitSha,
      status: payload.status,
      deployedAt: new Date(payload.deployedAt),
      deployedBy,
    })
    .onConflictDoUpdate({
      target: [deployments.orgId, deployments.id],
      set: { status: payload.status },
    });

  // EKG edges: deployment TRIGGERED-by commit; user TRIGGERED deployment.
  const edges: EkgEdgeSpec[] = [];
  const commit = await db.query.gitCommits.findFirst({
    where: (t, { and, eq: eqOp }) => and(eqOp(t.orgId, orgId), eqOp(t.repoId, repo.id), eqOp(t.sha, payload.commitSha)),
    columns: { id: true },
  });
  if (commit) {
    edges.push({ fromType: 'deployment', fromId: deploymentId, toType: 'commit', toId: commit.id, edgeType: 'TRIGGERED' });
  }
  if (deployedBy) {
    edges.push({ fromType: 'user', fromId: deployedBy, toType: 'deployment', toId: deploymentId, edgeType: 'TRIGGERED' });
  }
  await upsertEdges(orgId, edges);
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
  await consumer.connect();
  await consumer.subscribe({
    topics: [
      'github.webhooks',
      'slack.messages',
      'jira.events',
      'github.pull_requests',
      'incidents.events',
      'deployments.events',
    ],
  });
  await consumer.run({
    eachMessage: async ({ topic, message }: any) => {
      const raw = message.value!.toString();
      switch (topic) {
        case 'github.webhooks':
          await handleGithubEvent(JSON.parse(raw));
          break;
        case 'slack.messages':
          await indexSlackMessage(JSON.parse(raw));
          break;
        case 'jira.events':
          await indexJiraEvent(JSON.parse(raw));
          break;
        case 'github.pull_requests': {
          const env = await openEnvelope<PrEventPayload>(topic, raw);
          if (env) await handlePullRequestEvent(env);
          break;
        }
        case 'incidents.events': {
          const env = await openEnvelope<IncidentEventPayload>(topic, raw);
          if (env) await handleIncidentEvent(env);
          break;
        }
        case 'deployments.events': {
          const env = await openEnvelope<DeploymentEventPayload>(topic, raw);
          if (env) await handleDeploymentEvent(env);
          break;
        }
      }
    },
  });
  console.log('[kafka-telemetry] consuming');
}

main().catch((err) => {
  console.error('[kafka-telemetry] fatal', err);
  process.exit(1);
});
