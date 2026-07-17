import 'server-only';

const ES_URL = process.env.ELASTICSEARCH_URL;
if (!ES_URL) throw new Error('ELASTICSEARCH_URL is required for live mode');

export interface TextHit {
  source: string;
  snippet: string;
}

/**
 * Cross-source full-text search over Slack / Jira / Linear indices. Uses the ES
 * `_search` HTTP API directly (no client dep). Returns [] when ES is absent.
 */
export async function elasticFullText(query: string, size = 4): Promise<TextHit[]> {
  try {
    const res = await fetch(`${ES_URL}/slack_messages,jira_tickets,linear_issues/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        size,
        query: { multi_match: { query, fields: ['text', 'summary', 'description^1.5'] } },
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { hits?: { hits?: Array<{ _index: string; _source: Record<string, unknown> }> } };
    const hits = json.hits?.hits ?? [];
    return hits.map((h) => {
      const s = h._source;
      if (h._index === 'slack_messages') return { source: `Slack · #${s.channel_name}`, snippet: String(s.text ?? '') };
      const key = s.ticket_id ?? s.project_key ?? h._index;
      const label = h._index === 'linear_issues' ? 'Linear' : 'Jira';
      return { source: `${label} · ${key}`, snippet: String(s.summary ?? s.description ?? '') };
    });
  } catch {
    return [];
  }
}
