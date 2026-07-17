import { KafkaJS } from '@confluentinc/kafka-javascript';
import express from 'express';
import { eq } from 'drizzle-orm';
import { db } from '@repo/db';
import { organizations, repositories } from '@repo/db/schema';
import { decryptSecret } from '@repo/integrations';
import {
  verifyGithubSignature,
  verifySlackSignature,
  verifyPagerDutySignature,
  verifyAiemSignature,
  type RawBodyRequest,
} from './signatures.js';
import { makeEnvelope } from './schemas/envelope.js';
import type { PullRequestEventPayload } from './schemas/github-pull-requests.js';
import type { IncidentEventPayload } from './schemas/incidents-events.js';
import type { DeploymentEventPayload } from './schemas/deployments-events.js';

const { Kafka, CompressionTypes } = KafkaJS;

// mTLS (Aiven): certificate material is passed as librdkafka file-path
// properties — the KafkaJS-compat `ssl` field only accepts a boolean.
const kafka = new Kafka({
  kafkaJS: { brokers: [process.env.CONFLUENT_BOOTSTRAP!] },
  'security.protocol': 'ssl',
  'ssl.ca.location': process.env.KAFKA_CA_PATH!,
  'ssl.certificate.location': process.env.KAFKA_CERT_PATH!,
  'ssl.key.location': process.env.KAFKA_KEY_PATH!,
});

const producer = kafka.producer({
  kafkaJS: { compression: CompressionTypes.Snappy, acks: -1 },
  'linger.ms': 5,
});

const app = express();
// Capture the raw body so HMAC verification never depends on re-serialization.
app.use(express.json({ verify: (req, _res, buf) => ((req as RawBodyRequest).rawBody = buf) }));

app.get('/health', (_req, res) => res.json({ ok: true }));

const DEFAULT_ORG = process.env.DEFAULT_ORG_ID ?? '00000000-0000-0000-0000-000000000000';

async function orgIdForGithubRepo(githubRepoId: string | undefined): Promise<string> {
  if (!githubRepoId) return DEFAULT_ORG;
  const row = await db.query.repositories.findFirst({
    where: eq(repositories.githubRepoId, githubRepoId),
    columns: { orgId: true },
  });
  return row?.orgId ?? DEFAULT_ORG;
}

// GitHub webhook → github.webhooks topic; pull_request* events additionally
// fan out to the versioned github.pull_requests topic (plan 2c-2).
app.post('/webhooks/github', verifyGithubSignature, async (req, res) => {
  const event = req.headers['x-github-event'] as string;
  const payload = req.body;
  await producer.send({
    topic: 'github.webhooks',
    messages: [{ key: payload.repository?.id?.toString(), value: JSON.stringify({ event, payload, receivedAt: Date.now() }) }],
  });

  if ((event === 'pull_request' || event === 'pull_request_review') && payload.pull_request) {
    const pr = payload.pull_request;
    const orgId = await orgIdForGithubRepo(payload.repository?.id?.toString());
    const prPayload: PullRequestEventPayload = {
      action: event === 'pull_request_review' ? 'review_submitted' : String(payload.action ?? 'opened'),
      repoGithubId: String(payload.repository?.id ?? ''),
      repoFullName: String(payload.repository?.full_name ?? ''),
      pr: {
        githubPrId: String(pr.id ?? ''),
        number: Number(pr.number ?? 0),
        title: String(pr.title ?? ''),
        state: pr.state === 'closed' ? 'closed' : 'open',
        merged: Boolean(pr.merged ?? pr.merged_at),
        authorLogin: pr.user?.login ?? null,
        baseSha: String(pr.base?.sha ?? ''),
        headSha: String(pr.head?.sha ?? ''),
        createdAt: pr.created_at ?? null,
        mergedAt: pr.merged_at ?? null,
      },
      review: payload.review
        ? {
            reviewerLogin: payload.review.user?.login ?? null,
            state: (payload.review.state ?? 'commented') as 'approved' | 'changes_requested' | 'commented',
            submittedAt: payload.review.submitted_at ?? null,
          }
        : undefined,
      installationId: payload.installation?.id,
    };
    await producer.send({
      topic: 'github.pull_requests',
      messages: [{ key: prPayload.repoGithubId, value: JSON.stringify(makeEnvelope('github.pull_requests', orgId, prPayload)) }],
    });
  }

  res.status(202).send({ ok: true });
});

// Slack Events API → slack.messages topic, keyed by channel.
app.post('/webhooks/slack', verifySlackSignature, async (req, res) => {
  if (req.body.type === 'url_verification') {
    res.json({ challenge: req.body.challenge });
    return;
  }
  await producer.send({
    topic: 'slack.messages',
    messages: [{ key: req.body.event?.channel, value: JSON.stringify(req.body) }],
  });
  res.status(200).send();
});

// PagerDuty v3 webhooks → incidents.events (plan 2c-2).
app.post('/webhooks/pagerduty', verifyPagerDutySignature, async (req, res) => {
  const event = req.body?.event;
  const incident = event?.data;
  if (!incident?.id) {
    res.status(400).json({ error: 'unrecognized pagerduty payload' });
    return;
  }
  const status: IncidentEventPayload['status'] =
    event.event_type === 'incident.resolved' ? 'resolved'
    : event.event_type === 'incident.acknowledged' ? 'acknowledged'
    : 'triggered';
  const payload: IncidentEventPayload = {
    source: 'pagerduty',
    externalId: String(incident.id),
    title: String(incident.title ?? incident.summary ?? 'Untitled incident'),
    severity: (incident.priority?.summary?.toLowerCase() as IncidentEventPayload['severity']) ?? 'high',
    status,
    triggeredAt: incident.created_at ?? event.occurred_at ?? null,
    resolvedAt: status === 'resolved' ? (event.occurred_at ?? null) : null,
  };
  const orgId = process.env.PAGERDUTY_ORG_ID ?? DEFAULT_ORG;
  await producer.send({
    topic: 'incidents.events',
    messages: [{ key: payload.externalId, value: JSON.stringify(makeEnvelope('incidents.events', orgId, payload)) }],
  });
  res.status(202).send({ ok: true });
});

// Deployment notifications → deployments.events. Authenticated with the
// org's own webhook secret (AES-256-GCM at rest, HMAC per plan §3.4).
app.post('/webhooks/deployments/:orgSlug', async (req, res) => {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, req.params.orgSlug),
    columns: { id: true, deploymentWebhookSecret: true },
  });
  // Unknown org and bad signature are indistinguishable: both 401.
  if (!org?.deploymentWebhookSecret) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  let secret: string;
  try {
    secret = decryptSecret(org.deploymentWebhookSecret);
  } catch {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }
  if (!verifyAiemSignature(req, secret)) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  const b = req.body ?? {};
  if (!b.deployId || !b.repoFullName || !b.commitSha) {
    res.status(400).json({ error: 'deployId, repoFullName, commitSha required' });
    return;
  }
  const payload: DeploymentEventPayload = {
    deployId: String(b.deployId),
    repoFullName: String(b.repoFullName),
    environment: (['production', 'staging', 'preview'] as const).includes(b.environment) ? b.environment : 'production',
    commitSha: String(b.commitSha),
    status: (['success', 'failure', 'in_progress'] as const).includes(b.status) ? b.status : 'success',
    deployedAt: b.deployedAt ?? new Date().toISOString(),
    deployedByLogin: b.deployedByLogin,
  };
  await producer.send({
    topic: 'deployments.events',
    messages: [{ key: payload.repoFullName, value: JSON.stringify(makeEnvelope('deployments.events', org.id, payload)) }],
  });
  res.status(202).send({ ok: true });
});

async function main() {
  await producer.connect();
  const port = Number(process.env.PORT ?? 4001);
  app.listen(port, () => console.log(`[kafka-webhook] listening on :${port}`));
}

main().catch((err) => {
  console.error('[kafka-webhook] fatal', err);
  process.exit(1);
});
