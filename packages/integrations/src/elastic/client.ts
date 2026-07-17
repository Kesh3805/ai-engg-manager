import { Client } from '@elastic/elasticsearch';

export const elastic = process.env.ELASTICSEARCH_URL
  ? new Client({ node: process.env.ELASTICSEARCH_URL })
  : null;

export const SLACK_INDEX = 'slack_messages';
export const JIRA_INDEX = 'jira_tickets';
export const LINEAR_INDEX = 'linear_issues';

/** Cross-source full-text search scoped to an org. Returns [] when Elasticsearch is not configured. */
export async function elasticFullText(orgId: string, query: string, size = 20) {
  if (!elastic) return [];
  const result = await elastic.search({
    index: [SLACK_INDEX, JIRA_INDEX, LINEAR_INDEX],
    size,
    query: {
      bool: {
        must: [{ multi_match: { query, fields: ['text', 'summary', 'description'] } }],
        filter: [{ term: { org_id: orgId } }],
      },
    },
  });
  return result.hits.hits.map((h) => ({ index: h._index, score: h._score, ...(h._source as object) }));
}
