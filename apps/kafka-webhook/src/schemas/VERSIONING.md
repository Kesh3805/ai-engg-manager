# Kafka Schema Versioning (N / N-1 policy)

Every message on a versioned topic is wrapped in `KafkaEnvelope<T>`:

```typescript
interface KafkaEnvelope<T> {
  schemaVersion: number;
  producedAt: string; // ISO timestamp
  orgId: string;
  payload: T;
}
```

## Rules

1. **Producers** always write the current version for the topic
   (`SCHEMA_VERSIONS` in `envelope.ts`). Bump the number in the same PR that
   changes the payload type.
2. **Consumers** support version N and N-1 simultaneously during a 14-day
   migration window:
   - `schemaVersion === N` → process normally.
   - `schemaVersion === N-1` → log a warning and process for the first
     7 days; after 14 days from the version bump, treat as unsupported.
   - `schemaVersion > N` (message from a newer producer) → **dead-letter
     queue** with `reason: 'unsupported_schema_version'`. Never guess.
   - `schemaVersion < N-1` → dead-letter, same reason.
3. **No Confluent Schema Registry** — deliberately out of scope (plan §14);
   this envelope + code review is the contract.
4. Unversioned legacy topics (`github.webhooks`, `slack.messages`,
   `jira.events`) predate the envelope and are consumed as raw payloads until
   their next schema change, at which point they adopt the envelope.

## Current versions

| Topic | Version | Payload type |
|---|---|---|
| `github.pull_requests` | 1 | `PullRequestEventPayload` |
| `incidents.events` | 1 | `IncidentEventPayload` |
| `deployments.events` | 1 | `DeploymentEventPayload` |
