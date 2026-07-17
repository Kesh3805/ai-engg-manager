import { z } from 'zod';
import { INCIDENT_SYSTEM_PROMPT } from '../prompts.js';
import { completeJson } from '../llm.js';

/**
 * Incident RCA agent (plan 3b-1). Heavy tier. Output is an UNVERIFIED
 * hypothesis: it is persisted with shared_at = NULL and posted only to the
 * staging channel — never to a live incident channel (plan §10).
 */

export const IncidentAnalysisSchema = z.object({
  hypothesis: z.string(),
  confidence: z.number().min(0).max(100),
  evidence: z.array(
    z.object({
      type: z.enum(['deployment', 'pr', 'commit', 'ast_node', 'slack', 'historical']),
      description: z.string(),
      nodeId: z.string().nullable(),
    }),
  ),
  remediation: z.string(),
});

export type IncidentAnalysis = z.infer<typeof IncidentAnalysisSchema>;

export interface IncidentContext {
  incident: { title: string; severity: string; triggeredAt: string };
  recentDeployments: Array<{ id: string; environment: string | null; commitSha: string | null; deployedAt: string; status: string | null }>;
  relatedPRs: Array<{ id: string; number: number; title: string | null; authorLogin: string | null; mergedAt: string | null }>;
  modifiedAstNodes: Array<{ id: string; name: string; nodeType: string; filePath: string }>;
  slackMentions: Array<{ channel: string; text: string; ts: string }>;
  historicalIncidents: Array<{ title: string | null; resolvedAt: string | null; severity: string | null }>;
}

export const incidentAgent = {
  id: 'incident-agent',
  description: 'SRE RCA engine — correlates deployments, PRs, AST changes and Slack chatter into a ranked hypothesis.',
  modelTier: 'heavy',
  agentVersion: 'incident/1',
} as const;

export async function runIncidentAnalysis(context: IncidentContext): Promise<IncidentAnalysis> {
  const user = [
    `Incident: ${context.incident.title} (severity: ${context.incident.severity}, triggered: ${context.incident.triggeredAt})`,
    `Deployments in the 2h window before trigger:`,
    ...context.recentDeployments.map((d) => `- ${d.id} ${d.environment ?? '?'} sha=${d.commitSha ?? '?'} status=${d.status ?? '?'} at ${d.deployedAt}`),
    `PRs in those deployments:`,
    ...context.relatedPRs.map((p) => `- #${p.number} "${p.title ?? ''}" by ${p.authorLogin ?? '?'} merged ${p.mergedAt ?? '?'} (id ${p.id})`),
    `AST nodes modified:`,
    ...context.modifiedAstNodes.slice(0, 50).map((n) => `- ${n.nodeType} ${n.name} (${n.filePath}) [id ${n.id}]`),
    `Slack mentions:`,
    ...context.slackMentions.slice(0, 20).map((m) => `- [${m.channel} @ ${m.ts}] ${m.text.slice(0, 200)}`),
    `Similar historical incidents:`,
    ...context.historicalIncidents.slice(0, 10).map((h) => `- ${h.title ?? ''} (${h.severity ?? '?'}, resolved ${h.resolvedAt ?? 'never'})`),
  ].join('\n');

  return completeJson(IncidentAnalysisSchema, INCIDENT_SYSTEM_PROMPT, user, 'heavy');
}
