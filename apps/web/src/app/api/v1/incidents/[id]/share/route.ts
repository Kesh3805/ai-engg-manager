import type { NextRequest } from 'next/server';
import { sql } from '@/server/db';
import { requireResourceAccess } from '@/server/auth-guard';
import { errorResponse, ResourceNotFoundError } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Human-approved share of an incident RCA (plan §10 step 4). Member+ action.
 * Sets shared_at; the live-channel Slack post happens here and ONLY here —
 * the analysis worker never posts to a live incident channel.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Resource route: fetch the incident's org from the DB row first.
    const [incident] = await sql<Array<{ id: string; orgId: string; title: string | null }>>`
      SELECT id, org_id AS "orgId", title FROM incidents WHERE id = ${id}`.catch(() => []);
    if (!incident) throw new ResourceNotFoundError();
    await requireResourceAccess(incident.orgId, 'member');

    const [analysis] = await sql<Array<{ id: string; hypothesis: string; confidencePct: number | null; remediation: string | null }>>`
      UPDATE incident_analyses SET shared_at = now()
      WHERE org_id = ${incident.orgId} AND incident_id = ${incident.id}
        AND id = (
          SELECT id FROM incident_analyses
          WHERE org_id = ${incident.orgId} AND incident_id = ${incident.id}
          ORDER BY created_at DESC LIMIT 1
        )
      RETURNING id, hypothesis, confidence_pct AS "confidencePct", remediation`;
    if (!analysis) throw new ResourceNotFoundError('no analysis to share');

    // Post to the live incident channel — only from this human-approved path.
    const botToken = process.env.SLACK_BOT_TOKEN;
    const liveChannel = process.env.SLACK_INCIDENT_CHANNEL;
    let posted = false;
    if (botToken && liveChannel) {
      try {
        const { WebClient } = await import('@slack/web-api');
        await new WebClient(botToken).chat.postMessage({
          channel: liveChannel,
          text: [
            `🧭 RCA hypothesis for *${incident.title ?? 'incident'}* (human-approved, confidence ${analysis.confidencePct ?? '?'}%):`,
            analysis.hypothesis,
            analysis.remediation ? `\n*Suggested remediation:* ${analysis.remediation}` : '',
          ].join('\n'),
        });
        posted = true;
      } catch (e) {
        console.error('[incidents/share] slack post failed:', e);
      }
    }

    return Response.json({ ok: true, analysisId: analysis.id, postedToSlack: posted });
  } catch (err) {
    return errorResponse(err);
  }
}
