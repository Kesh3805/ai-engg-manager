/** Payload for topic `incidents.events` (schemaVersion 1). */
export interface IncidentEventPayload {
  source: 'pagerduty' | 'datadog' | 'manual';
  externalId: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'triggered' | 'acknowledged' | 'resolved';
  triggeredAt: string | null;
  resolvedAt: string | null;
}
