import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  date,
  numeric,
  index,
  unique,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { organizations, repositories } from './organizations';
import { vector } from './ast';

/**
 * Engineering Knowledge Graph (EKG) schema.
 *
 * Identity rule: every EKG node id is
 *   uuidv5(namespace, `${orgId}::${type}::${naturalKey}`)
 * so ingestion is idempotent — re-processing the same event upserts the same row.
 *
 * Enum-ish columns are documented in comments (codebase convention — no CHECK
 * constraints; the application layer validates).
 */

// ---------------------------------------------------------------------------
// EKG user nodes
//
// NOTE (deviation from plan §4.2): the plan names this table `users`, but that
// name is owned by Better Auth (see ./auth.ts). EKG identity nodes therefore
// live in `ekg_users`. They model *GitHub identities inside an org's graph*,
// not login accounts.
// ---------------------------------------------------------------------------
export const ekgUsers = pgTable(
  'ekg_users',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::user::githubLogin
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    githubLogin: text('github_login'),
    displayName: text('display_name'),
    email: text('email'),
    avatarUrl: text('avatar_url'),
    teams: text('teams').array(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }), // soft-delete
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }), // PII wiped on this date
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    orgLoginIdx: index('users_org_login_idx')
      .on(t.orgId, t.githubLogin)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

// ---------------------------------------------------------------------------
// Email resolution cache — GLOBAL, cross-tenant by design (no org_id).
// See DATA_RETENTION.md §3 for the compliance rationale and constraints.
// Hard-deleted when the matching ekg_users row is anonymized.
// ---------------------------------------------------------------------------
export const emailUserCache = pgTable(
  'email_user_cache',
  {
    email: text('email').primaryKey(),
    githubLogin: text('github_login'),
    isBot: boolean('is_bot').default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureCount: integer('failure_count').default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '180 days'`),
  },
  (t) => ({
    expiresIdx: index('email_cache_expires_idx').on(t.expiresAt),
  }),
);

// ---------------------------------------------------------------------------
// Git history
// ---------------------------------------------------------------------------
export const gitCommits = pgTable(
  'git_commits',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::commit::repoId::sha
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    sha: text('sha').notNull(),
    authorId: uuid('author_id'), // ekg_users id, nullable (bot/unresolved)
    authorLogin: text('author_login'), // denormalized for display without join
    authorEmail: text('author_email'), // enables late email→login backfill; wiped on deletion
    message: text('message'),
    filesChanged: integer('files_changed'),
    additions: integer('additions'),
    deletions: integer('deletions'),
    committedAt: timestamp('committed_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    repoDateIdx: index('commits_repo_date_idx').on(t.orgId, t.repoId, t.committedAt),
    authorIdx: index('commits_author_idx')
      .on(t.orgId, t.authorId)
      .where(sql`${t.authorId} IS NOT NULL`),
  }),
);

// ---------------------------------------------------------------------------
// Pull requests & reviews
// ---------------------------------------------------------------------------
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::pr::repoId::prNumber
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    githubPrId: text('github_pr_id'),
    number: integer('number').notNull(),
    title: text('title'),
    state: text('state'), // open | closed | merged
    authorId: uuid('author_id'), // ekg_users id
    authorLogin: text('author_login'), // primary resolution signal (direct from GitHub payload)
    baseSha: text('base_sha'),
    headSha: text('head_sha'),
    mergedAt: timestamp('merged_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    repoStateIdx: index('prs_repo_state_idx').on(t.orgId, t.repoId, t.state, t.createdAt),
  }),
);

export const prReviews = pgTable('pr_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').notNull(),
  prId: uuid('pr_id').notNull(),
  reviewerId: uuid('reviewer_id'),
  state: text('state'), // approved | changes_requested | commented
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
});

export const prAiReviews = pgTable('pr_ai_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  prId: uuid('pr_id').notNull(),
  reviewJson: jsonb('review_json').notNull(), // structured FindingList
  securityJson: jsonb('security_json'), // from security.agent.ts
  postedGithubCommentId: text('posted_github_comment_id'),
  agentVersion: text('agent_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// EKG edge table.
// In production this is `PARTITION BY LIST (from_type)` (applied via raw SQL
// at deploy, same pattern as ast_nodes hash partitioning); Drizzle models the
// logical shape. The unique key includes from_type — the partition key.
//
// Canonical upsert (always re-activates soft-deleted edges):
//   INSERT ... ON CONFLICT (org_id, from_type, from_id, to_id, edge_type)
//     DO UPDATE SET valid_until = NULL, metadata = EXCLUDED.metadata, updated_at = now()
// ---------------------------------------------------------------------------
export const ekgEdges = pgTable(
  'ekg_edges',
  {
    id: uuid('id').defaultRandom().notNull(),
    orgId: uuid('org_id').notNull(),
    fromType: text('from_type').notNull(), // ast_node|commit|pr|user|issue|incident|adr|deployment
    fromId: uuid('from_id').notNull(),
    toType: text('to_type').notNull(),
    toId: uuid('to_id').notNull(),
    edgeType: text('edge_type').notNull(), // AUTHORED|REVIEWED|MERGED|MODIFIED|RESOLVES|TRIGGERED|CAUSED|DOCUMENTED_BY
    metadata: jsonb('metadata').default({}),
    validUntil: timestamp('valid_until', { withTimezone: true }), // null = active; set by reconciler on orphan detection
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqueEdge: unique('ekg_edges_uq').on(t.orgId, t.fromType, t.fromId, t.toId, t.edgeType),
    forwardIdx: index('ekg_forward_idx')
      .on(t.orgId, t.fromType, t.fromId, t.edgeType)
      .where(sql`${t.validUntil} IS NULL`),
    reverseIdx: index('ekg_reverse_idx')
      .on(t.orgId, t.toType, t.toId, t.edgeType)
      .where(sql`${t.validUntil} IS NULL`),
  }),
);

// ---------------------------------------------------------------------------
// Issues, deployments, incidents
// ---------------------------------------------------------------------------
export const issues = pgTable(
  'issues',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::issue::source::externalId
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    source: text('source'), // jira | linear | github
    externalId: text('external_id'),
    title: text('title'),
    status: text('status'),
    assigneeId: uuid('assignee_id'),
    labels: text('labels').array(),
    sprintId: text('sprint_id'),
    storyPoints: integer('story_points'),
    createdAt: timestamp('created_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
  }),
);

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::deployment::repoId::deployId
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    environment: text('environment'), // production | staging | preview
    commitSha: text('commit_sha'),
    status: text('status'), // success | failure | in_progress
    deployedAt: timestamp('deployed_at', { withTimezone: true }).notNull(),
    deployedBy: uuid('deployed_by'), // ekg_users id, nullable
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    timeIdx: index('deployments_time_idx').on(t.orgId, t.repoId, t.deployedAt),
  }),
);

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::incident::source::externalId
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    source: text('source'), // pagerduty | datadog | manual
    externalId: text('external_id'),
    title: text('title'),
    severity: text('severity'), // critical | high | medium | low
    status: text('status'), // triggered | acknowledged | resolved
    triggeredAt: timestamp('triggered_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
  }),
);

export const incidentAnalyses = pgTable('incident_analyses', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  incidentId: uuid('incident_id').notNull(),
  hypothesis: text('hypothesis').notNull(),
  confidencePct: integer('confidence_pct'), // 0–100, app-validated
  evidenceJson: jsonb('evidence_json'), // [{type, description, nodeId?}]
  remediation: text('remediation'),
  agentVersion: text('agent_version'),
  sharedAt: timestamp('shared_at', { withTimezone: true }), // NULL until a human clicks "Share to Slack"
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// ADRs
// ---------------------------------------------------------------------------
export const adrs = pgTable(
  'adrs',
  {
    id: uuid('id').notNull(), // UUIDv5: orgId::adr::repoId::number
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    number: integer('number'),
    title: text('title'),
    status: text('status'), // proposed | accepted | deprecated | superseded
    content: text('content'), // full markdown
    embedding: vector('embedding', { dimensions: 1024 }), // baai/bge-m3 via NVIDIA NIM
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    authors: text('authors').array(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    repoIdx: index('adrs_repo_idx').on(t.orgId, t.repoId),
  }),
);

// ---------------------------------------------------------------------------
// Coverage (pushed by CI — see /api/v1/coverage-reports)
// ---------------------------------------------------------------------------
export const coverageReports = pgTable(
  'coverage_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id),
    algorithmVersion: integer('algorithm_version').notNull().default(1),
    commitSha: text('commit_sha'),
    sourceFormat: text('source_format'), // lcov | cobertura | json-summary — copied into engineering_scores.test_health_source
    reportDate: date('report_date').notNull(),
    overallPct: numeric('overall_pct', { precision: 5, scale: 2 }).notNull(),
    linePct: numeric('line_pct', { precision: 5, scale: 2 }),
    branchPct: numeric('branch_pct', { precision: 5, scale: 2 }),
    functionPct: numeric('function_pct', { precision: 5, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqueReport: unique('coverage_reports_uq').on(t.orgId, t.repoId, t.reportDate, t.algorithmVersion),
  }),
);

// Rows older than 90 days deleted by the retention worker (aggregates in
// coverage_reports are kept — see DATA_RETENTION.md §2).
export const coverageFileStats = pgTable(
  'coverage_file_stats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    coverageId: uuid('coverage_id')
      .notNull()
      .references(() => coverageReports.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    linePct: numeric('line_pct', { precision: 5, scale: 2 }),
    branchPct: numeric('branch_pct', { precision: 5, scale: 2 }),
    uncoveredLines: integer('uncovered_lines').array(), // compact array, not JSON
  },
  (t) => ({
    coverageFileIdx: index('coverage_file_stats_idx').on(t.coverageId, t.filePath),
  }),
);

// ---------------------------------------------------------------------------
// Engineering scores & hotspots
// Trend lines are drawn only within the same algorithm_version.
// UI always shows: "Heuristic score — not an industry-certified metric".
// ---------------------------------------------------------------------------
export const engineeringScores = pgTable(
  'engineering_scores',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    repoId: uuid('repo_id').references(() => repositories.id), // null = org-level
    algorithmVersion: integer('algorithm_version').notNull().default(1),
    scoredAt: date('scored_at').notNull(),
    testHealth: integer('test_health'), // null if no coverage data; source in test_health_source
    testHealthSource: text('test_health_source'), // lcov | nyc | null
    docHealth: integer('doc_health'),
    depHealth: integer('dep_health'),
    security: integer('security'),
    complexity: integer('complexity'), // McCabe: % functions with CC ≤ 10
    ownership: integer('ownership'),
  },
  (t) => ({
    uniqueScore: unique('engineering_scores_uq').on(t.orgId, t.repoId, t.scoredAt, t.algorithmVersion),
  }),
);

export const hotspots = pgTable(
  'hotspots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id').notNull(),
    repoId: uuid('repo_id').notNull(),
    filePath: text('file_path').notNull(),
    churnScore: integer('churn_score'), // commit count in last 90 days
    complexityScore: integer('complexity_score'), // avg CC of functions in file
    bugRate: integer('bug_rate'), // linked incidents in last 180 days
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow(),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniqueHotspot: unique('hotspots_uq').on(t.orgId, t.repoId, t.filePath),
  }),
);

export type EkgUser = typeof ekgUsers.$inferSelect;
export type GitCommitRow = typeof gitCommits.$inferSelect;
export type GitCommitInsert = typeof gitCommits.$inferInsert;
export type PullRequestRow = typeof pullRequests.$inferSelect;
export type EkgEdgeInsert = typeof ekgEdges.$inferInsert;
export type IncidentRow = typeof incidents.$inferSelect;
export type DeploymentRow = typeof deployments.$inferSelect;
export type AdrRow = typeof adrs.$inferSelect;
export type EngineeringScoreRow = typeof engineeringScores.$inferSelect;
export type HotspotRow = typeof hotspots.$inferSelect;
