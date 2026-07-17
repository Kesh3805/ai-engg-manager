-- EKG physical schema (deploy-time DDL — matches packages/db/src/schema/ekg.ts).
-- Idempotent: safe to re-run. Includes the LIST-partitioned ekg_edges that
-- Drizzle models logically (same pattern as ast_nodes hash partitioning).

CREATE EXTENSION IF NOT EXISTS vector;

-- §4.1 identity & access -----------------------------------------------------
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deployment_webhook_secret TEXT;

ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS invited_by TEXT;
DROP INDEX IF EXISTS org_members_org_user_idx;
CREATE UNIQUE INDEX IF NOT EXISTS org_members_org_user_idx
  ON organization_members(organization_id, user_id);

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS last_commit_indexed_sha TEXT,
  ADD COLUMN IF NOT EXISTS last_doc_pr_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS doc_agent_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS stars INTEGER;

-- §4.2 EKG user nodes (named ekg_users — `users` belongs to Better Auth) -----
CREATE TABLE IF NOT EXISTS ekg_users (
  id            UUID NOT NULL,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_login  TEXT,
  display_name  TEXT,
  email         TEXT,
  avatar_url    TEXT,
  teams         TEXT[],
  deleted_at    TIMESTAMPTZ,
  anonymized_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS users_org_login_idx ON ekg_users(org_id, github_login) WHERE deleted_at IS NULL;

-- §4.3 email resolution cache (global, cross-tenant) --------------------------
CREATE TABLE IF NOT EXISTS email_user_cache (
  email         TEXT PRIMARY KEY,
  github_login  TEXT,
  is_bot        BOOLEAN DEFAULT false,
  resolved_at   TIMESTAMPTZ,
  failed_at     TIMESTAMPTZ,
  failure_count INTEGER DEFAULT 0,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '180 days'
);
CREATE INDEX IF NOT EXISTS email_cache_expires_idx ON email_user_cache(expires_at);

-- §4.4 git history -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS git_commits (
  id            UUID NOT NULL,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id       UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha           TEXT NOT NULL,
  author_id     UUID,
  author_login  TEXT,
  author_email  TEXT,
  message       TEXT,
  files_changed INTEGER,
  additions     INTEGER,
  deletions     INTEGER,
  committed_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS commits_repo_date_idx ON git_commits(org_id, repo_id, committed_at DESC);
CREATE INDEX IF NOT EXISTS commits_author_idx ON git_commits(org_id, author_id) WHERE author_id IS NOT NULL;

-- §4.5 pull requests & reviews --------------------------------------------------
CREATE TABLE IF NOT EXISTS pull_requests (
  id            UUID NOT NULL,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id       UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_pr_id  TEXT,
  number        INTEGER NOT NULL,
  title         TEXT,
  state         TEXT,
  author_id     UUID,
  author_login  TEXT,
  base_sha      TEXT,
  head_sha      TEXT,
  merged_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS prs_repo_state_idx ON pull_requests(org_id, repo_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS pr_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL,
  pr_id        UUID NOT NULL,
  reviewer_id  UUID,
  state        TEXT,
  submitted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pr_ai_reviews (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID NOT NULL REFERENCES organizations(id),
  pr_id                    UUID NOT NULL,
  review_json              JSONB NOT NULL,
  security_json            JSONB,
  posted_github_comment_id TEXT,
  agent_version            TEXT,
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- §4.6 EKG edges — LIST-partitioned by from_type -------------------------------
CREATE TABLE IF NOT EXISTS ekg_edges (
  id          UUID DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL,
  from_type   TEXT NOT NULL,
  from_id     UUID NOT NULL,
  to_type     TEXT NOT NULL,
  to_id       UUID NOT NULL,
  edge_type   TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  valid_until TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ DEFAULT now(),
  created_at  TIMESTAMPTZ DEFAULT now()
) PARTITION BY LIST (from_type);

CREATE TABLE IF NOT EXISTS ekg_edges_ast_node    PARTITION OF ekg_edges FOR VALUES IN ('ast_node');
CREATE TABLE IF NOT EXISTS ekg_edges_commit      PARTITION OF ekg_edges FOR VALUES IN ('commit');
CREATE TABLE IF NOT EXISTS ekg_edges_pr          PARTITION OF ekg_edges FOR VALUES IN ('pr');
CREATE TABLE IF NOT EXISTS ekg_edges_user        PARTITION OF ekg_edges FOR VALUES IN ('user');
CREATE TABLE IF NOT EXISTS ekg_edges_issue       PARTITION OF ekg_edges FOR VALUES IN ('issue');
CREATE TABLE IF NOT EXISTS ekg_edges_incident    PARTITION OF ekg_edges FOR VALUES IN ('incident');
CREATE TABLE IF NOT EXISTS ekg_edges_adr         PARTITION OF ekg_edges FOR VALUES IN ('adr');
CREATE TABLE IF NOT EXISTS ekg_edges_deployment  PARTITION OF ekg_edges FOR VALUES IN ('deployment');
CREATE TABLE IF NOT EXISTS ekg_edges_default     PARTITION OF ekg_edges DEFAULT;

-- Unique key includes the partition key (from_type) — required on partitioned tables
CREATE UNIQUE INDEX IF NOT EXISTS ekg_edges_uq
  ON ekg_edges(org_id, from_type, from_id, to_id, edge_type);
CREATE INDEX IF NOT EXISTS ekg_forward_idx ON ekg_edges(org_id, from_type, from_id, edge_type) WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS ekg_reverse_idx ON ekg_edges(org_id, to_type, to_id, edge_type) WHERE valid_until IS NULL;

-- §4.7 issues, deployments, incidents -------------------------------------------
CREATE TABLE IF NOT EXISTS issues (
  id           UUID NOT NULL,
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source       TEXT,
  external_id  TEXT,
  title        TEXT,
  status       TEXT,
  assignee_id  UUID,
  labels       TEXT[],
  sprint_id    TEXT,
  story_points INTEGER,
  created_at   TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS deployments (
  id          UUID NOT NULL,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id     UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  environment TEXT,
  commit_sha  TEXT,
  status      TEXT,
  deployed_at TIMESTAMPTZ NOT NULL,
  deployed_by UUID,
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS deployments_time_idx ON deployments(org_id, repo_id, deployed_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id           UUID NOT NULL,
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source       TEXT,
  external_id  TEXT,
  title        TEXT,
  severity     TEXT,
  status       TEXT,
  triggered_at TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  PRIMARY KEY (org_id, id)
);

CREATE TABLE IF NOT EXISTS incident_analyses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id),
  incident_id    UUID NOT NULL,
  hypothesis     TEXT NOT NULL,
  confidence_pct INTEGER,
  evidence_json  JSONB,
  remediation    TEXT,
  agent_version  TEXT,
  shared_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

-- §4.8 ADRs ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adrs (
  id         UUID NOT NULL,
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id    UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number     INTEGER,
  title      TEXT,
  status     TEXT,
  content    TEXT,
  embedding  VECTOR(1024),
  decided_at TIMESTAMPTZ,
  authors    TEXT[],
  PRIMARY KEY (org_id, id)
);
CREATE INDEX IF NOT EXISTS adrs_repo_idx ON adrs(org_id, repo_id);

-- §4.9 coverage -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coverage_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id),
  repo_id           UUID NOT NULL REFERENCES repositories(id),
  algorithm_version INTEGER NOT NULL DEFAULT 1,
  commit_sha        TEXT,
  source_format     TEXT,
  report_date       DATE NOT NULL,
  overall_pct       DECIMAL(5,2) NOT NULL,
  line_pct          DECIMAL(5,2),
  branch_pct        DECIMAL(5,2),
  function_pct      DECIMAL(5,2),
  created_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, repo_id, report_date, algorithm_version)
);

CREATE TABLE IF NOT EXISTS coverage_file_stats (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coverage_id     UUID NOT NULL REFERENCES coverage_reports(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL,
  line_pct        DECIMAL(5,2),
  branch_pct      DECIMAL(5,2),
  uncovered_lines INTEGER[]
);
CREATE INDEX IF NOT EXISTS coverage_file_stats_idx ON coverage_file_stats(coverage_id, file_path);

-- §4.10 scores & hotspots -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS engineering_scores (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID NOT NULL REFERENCES organizations(id),
  repo_id            UUID REFERENCES repositories(id),
  algorithm_version  INTEGER NOT NULL DEFAULT 1,
  scored_at          DATE NOT NULL,
  test_health        INTEGER,
  test_health_source TEXT,
  doc_health         INTEGER,
  dep_health         INTEGER,
  security           INTEGER,
  complexity         INTEGER,
  ownership          INTEGER,
  UNIQUE (org_id, repo_id, scored_at, algorithm_version)
);

CREATE TABLE IF NOT EXISTS hotspots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL,
  repo_id          UUID NOT NULL,
  file_path        TEXT NOT NULL,
  churn_score      INTEGER,
  complexity_score INTEGER,
  bug_rate         INTEGER,
  first_seen_at    TIMESTAMPTZ DEFAULT now(),
  last_updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (org_id, repo_id, file_path)
);
