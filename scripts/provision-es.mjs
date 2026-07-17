/**
 * Provision Elasticsearch indices (slack_messages, jira_tickets, linear_issues)
 * with the design mappings. Idempotent. Run: node --env-file=.env scripts/provision-es.mjs
 */
const ES = process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200';

const TEXT = { type: 'text', analyzer: 'english' };
const KW = { type: 'keyword' };

const INDICES = {
  slack_messages: {
    org_id: KW, channel_id: KW, channel_name: KW, user_id: KW,
    text: TEXT, thread_ts: KW, ts: { type: 'date', format: 'epoch_second' }, mentions: KW,
  },
  jira_tickets: {
    org_id: KW, ticket_id: KW, project_key: KW, summary: TEXT, description: TEXT,
    status: KW, assignee: KW, labels: KW, created_at: { type: 'date' }, updated_at: { type: 'date' },
  },
  linear_issues: {
    org_id: KW, ticket_id: KW, project_key: KW, summary: TEXT, description: TEXT,
    status: KW, assignee: KW, labels: KW, created_at: { type: 'date' }, updated_at: { type: 'date' },
  },
};

for (const [index, properties] of Object.entries(INDICES)) {
  const exists = await fetch(`${ES}/${index}`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  if (exists) {
    console.log(`[es] ${index} already exists`);
    continue;
  }
  const res = await fetch(`${ES}/${index}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mappings: { properties } }),
  });
  console.log(`[es] ${index}:`, res.ok ? 'created' : `failed (${res.status})`);
}
