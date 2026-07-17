/** Payload for topic `deployments.events` (schemaVersion 1). */
export interface DeploymentEventPayload {
  deployId: string; // caller-supplied unique id (used in the UUIDv5 natural key)
  repoFullName: string;
  environment: 'production' | 'staging' | 'preview';
  commitSha: string;
  status: 'success' | 'failure' | 'in_progress';
  deployedAt: string;
  deployedByLogin?: string;
}
