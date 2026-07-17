/**
 * Provision Aiven Kafka topics over mTLS. Reads cert paths + bootstrap from env
 * (loaded from the repo-root .env). Idempotent: skips topics that already exist.
 *
 * Run: node scripts/provision-kafka.mjs
 */
import { Kafka, logLevel } from 'kafkajs';
import { readFileSync } from 'node:fs';

// Desired partition counts from the design. The current Aiven plan enforces a
// CreateTopicPolicy that caps partitions per topic, so we clamp via MAX_PARTITIONS
// (override with env). On a larger plan, raise MAX_PARTITIONS to use these counts.
const MAX_PARTITIONS = Number(process.env.KAFKA_MAX_PARTITIONS ?? 1);
const DESIRED = [
  { topic: 'github.webhooks', numPartitions: 12 },
  { topic: 'slack.messages', numPartitions: 6 },
  { topic: 'discord.messages', numPartitions: 6 },
  { topic: 'jira.events', numPartitions: 4 },
  { topic: 'linear.events', numPartitions: 4 },
  { topic: 'telemetry.processed', numPartitions: 8 },
];
const TOPICS = DESIRED.map((t) => ({ ...t, numPartitions: Math.min(t.numPartitions, MAX_PARTITIONS) }));

const kafka = new Kafka({
  clientId: 'aiem-provisioner',
  brokers: [process.env.CONFLUENT_BOOTSTRAP],
  ssl: {
    ca: [readFileSync(process.env.KAFKA_CA_PATH, 'utf-8')],
    cert: readFileSync(process.env.KAFKA_CERT_PATH, 'utf-8'),
    key: readFileSync(process.env.KAFKA_KEY_PATH, 'utf-8'),
  },
  logLevel: logLevel.NOTHING,
  connectionTimeout: 12000,
  requestTimeout: 20000,
});

const admin = kafka.admin();

try {
  await admin.connect();
  const cluster = await admin.describeCluster();
  const brokerCount = cluster.brokers.length;
  const rf = Math.min(3, Math.max(1, brokerCount));
  console.log(`[kafka] connected · ${brokerCount} broker(s) · replicationFactor=${rf}`);

  const existing = new Set(await admin.listTopics());
  const toCreate = TOPICS.filter((t) => !existing.has(t.topic)).map((t) => ({ ...t, replicationFactor: rf }));

  if (toCreate.length === 0) {
    console.log('[kafka] all topics already exist:', TOPICS.map((t) => t.topic).join(', '));
  } else {
    await admin.createTopics({ topics: toCreate, waitForLeaders: true });
    console.log('[kafka] created:', toCreate.map((t) => t.topic).join(', '));
  }

  const final = (await admin.listTopics()).filter((t) => TOPICS.some((x) => x.topic === t));
  console.log('[kafka] topics now present:', final.sort().join(', '));
} catch (err) {
  console.error('[kafka] provisioning failed:', err.message);
  if (err.topics) console.error('[kafka] topic errors:', JSON.stringify(err.topics, null, 2));
  for (const k of Object.keys(err)) if (!['message', 'stack'].includes(k)) console.error(`  ${k}:`, JSON.stringify(err[k]));
  process.exitCode = 1;
} finally {
  await admin.disconnect().catch(() => {});
}
