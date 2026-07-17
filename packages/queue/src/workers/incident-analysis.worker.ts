import { Worker } from 'bullmq';
import { sql, and, eq } from 'drizzle-orm';
import { db } from '@repo/db';
import { incidents, incidentAnalyses } from '@repo/db/schema';
import { runIncidentAnalysis, incidentAgent, llmConfigured, type IncidentContext } from '@repo/mastra-agents';
import { elastic, SLACK_INDEX, getSlackClient, postSlackMessage } from '@repo/integrations';
import { redis } from '../redis.js';
import type { IncidentAnalysisJob } from '../queues.js';

/**
 * Incident RCA (plan 3b-2). Posting policy (§10) is absolute:
 *   - analysis persisted with shared_at = NULL
 *   - summary goes ONLY to the org's staging channel (SLACK_STAGING_CHANNEL)
 *   - the live incident channel is reached exclusively by a human clicking
 *     "Share" in the UI. There is no code path here that posts anywhere else.
 */
export const incidentAnalysisWorker = new Worker(
  'incident-analysis',
  async (job) => {
    const { orgId, incidentId } = job.data as IncidentAnalysisJob;
    if (!llmConfigured()) return;

    const incident = await db.query.incidents.findFirst({
      where: and(eq(incidents.orgId, orgId), eq(incidents.id, incidentId)),
    });
    if (!incident?.triggeredAt) return;

    // Deployments in the 2h window before trigger.
    const recentDeployments = (await db.execute(sql`
      SELECT id, environment, commit_sha AS "commitSha", status, deployed_at AS "deployedAt"
      FROM deployments
      WHERE org_id = ${orgId}
        AND deployed_at BETWEEN ${incident.triggeredAt}::timestamptz - interval '2 hours' AND ${incident.triggeredAt}
      ORDER BY deployed_at DESC LIMIT 10
    `)) as unknown as Array<{ id: string; environment: string | null; commitSha: string | null; status: string | null; deployedAt: Date }>;

    const shas = recentDeployments.map((d) => d.commitSha).filter((s): s is string => !!s);

    // EKG walk: deployment → commits → PRs (by head sha) → modified AST nodes.
    const relatedPRs = shas.length
      ? ((await db.execute(sql`
          SELECT id, number, title, author_login AS "authorLogin", merged_at AS "mergedAt"
          FROM pull_requests
          WHERE org_id = ${orgId} AND (head_sha = ANY(${shas}::text[]) OR base_sha = ANY(${shas}::text[]))
          LIMIT 10
        `)) as unknown as Array<{ id: string; number: number; title: string | null; authorLogin: string | null; mergedAt: Date | null }>)
      : [];

    const modifiedAstNodes = shas.length
      ? ((await db.execute(sql`
          SELECT DISTINCT n.id, n.name, n.node_type AS "nodeType", n.file_path AS "filePath"
          FROM git_commits c
          JOIN ekg_edges e ON e.from_type = 'commit' AND e.from_id = c.id AND e.edge_type = 'MODIFIED'
            AND e.org_id = c.org_id AND e.valid_until IS NULL
          JOIN ast_nodes n ON n.id = e.to_id AND n.org_id = c.org_id
          WHERE c.org_id = ${orgId} AND c.sha = ANY(${shas}::text[])
          LIMIT 50
        `)) as unknown as Array<{ id: string; name: string; nodeType: string; filePath: string }>)
      : [];

    // Slack mentions around the incident title keywords.
    let slackMentions: IncidentContext['slackMentions'] = [];
    if (elastic && incident.title) {
      try {
        const result = await elastic.search({
          index: SLACK_INDEX,
          query: { match: { text: incident.title } },
          size: 10,
        });
        slackMentions = (result.hits.hits as Array<{ _source?: { channel_id?: string; text?: string; ts?: string } }>).map((h) => ({
          channel: h._source?.channel_id ?? '?',
          text: h._source?.text ?? '',
          ts: h._source?.ts ?? '',
        }));
      } catch (err) {
        console.error('[incident-analysis] slack search failed:', err);
      }
    }

    const historicalIncidents = (await db.execute(sql`
      SELECT title, severity, resolved_at AS "resolvedAt"
      FROM incidents
      WHERE org_id = ${orgId} AND id <> ${incidentId} AND status = 'resolved'
      ORDER BY triggered_at DESC LIMIT 10
    `)) as unknown as Array<{ title: string | null; severity: string | null; resolvedAt: Date | null }>;

    const context: IncidentContext = {
      incident: {
        title: incident.title ?? 'Untitled incident',
        severity: incident.severity ?? 'high',
        triggeredAt: incident.triggeredAt.toISOString(),
      },
      recentDeployments: recentDeployments.map((d) => ({ ...d, deployedAt: d.deployedAt.toISOString() })),
      relatedPRs: relatedPRs.map((p) => ({ ...p, mergedAt: p.mergedAt?.toISOString() ?? null })),
      modifiedAstNodes,
      slackMentions,
      historicalIncidents: historicalIncidents.map((h) => ({ ...h, resolvedAt: h.resolvedAt?.toISOString() ?? null })),
    };

    const analysis = await runIncidentAnalysis(context);

    await db.insert(incidentAnalyses).values({
      orgId,
      incidentId,
      hypothesis: analysis.hypothesis,
      confidencePct: Math.round(analysis.confidence),
      evidenceJson: analysis.evidence,
      remediation: analysis.remediation,
      agentVersion: incidentAgent.agentVersion,
      sharedAt: null, // NULL until a human clicks "Share" in the UI — always
    });

    // Staging channel ONLY (plan §10).
    const stagingChannel = process.env.SLACK_STAGING_CHANNEL;
    const botToken = process.env.SLACK_BOT_TOKEN;
    if (stagingChannel && botToken) {
      const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
      try {
        await postSlackMessage(
          getSlackClient(botToken),
          stagingChannel,
          [
            `⚠️ AI-generated hypothesis — unverified. Confidence: ${Math.round(analysis.confidence)}%.`,
            `Do not share to incident channel without human review.`,
            ``,
            `*${incident.title}*`,
            analysis.hypothesis,
            ``,
            `Review: ${appUrl}/app/incidents/${incidentId}`,
          ].join('\n'),
        );
      } catch (err) {
        console.error('[incident-analysis] staging-channel post failed:', err);
      }
    }
  },
  { connection: redis, concurrency: 2 },
);
