# Data Retention & Deletion

This document is the source of truth for how personal data moves through the
Engineering Knowledge Graph (EKG) and when it is destroyed. Two distinct
mechanisms exist — do not conflate them.

## 1. On-demand deletion (user-initiated, GDPR-style)

Triggered by `POST /api/v1/me/delete` (authenticated user deleting their own
data) or by an org admin removing a person.

**Immediately (synchronous, inside the request):**

- `ekg_users.deleted_at` and `ekg_users.anonymized_at` are set to `now()`.
- PII fields on the matching `ekg_users` rows are wiped in the same statement:
  `github_login`, `display_name`, `email`, `avatar_url` → `NULL`.
- The matching `email_user_cache` row is **hard-deleted** (application-level
  hook — this table is global/cross-tenant, see §3, so the delete is by email,
  not by org).

**Asynchronously (BullMQ `user-deletion` job):**

- `git_commits.author_id` and `pr_reviews.reviewer_id` referencing the deleted
  EKG user are set to `NULL`. Denormalized fields
  (`git_commits.author_login`, `git_commits.author_email`) are wiped in the
  same pass.
- The job is idempotent and safe to retry.

After both steps, no table contains the person's name, email, login, or
avatar. Commit/PR *facts* (counts, timestamps, diffs) are retained — they are
org business records, not personal data, once unlinked.

## 2. 90-day offboarding sweep (internal retention policy — NOT GDPR deletion)

The monthly `retention` worker sweeps rows whose subject left the org more
than 90 days ago:

- `git_commits.author_id`, `pr_reviews.reviewer_id` → `NULL` where the linked
  `ekg_users.deleted_at` is older than 90 days (covers rows created by
  in-flight ingestion after the on-demand pass ran).
- `coverage_file_stats` rows older than 90 days are deleted (aggregate
  `coverage_reports` rows are kept indefinitely — they contain no PII).
- `email_user_cache` rows where `expires_at < now()` are deleted
  (rolling 180-day TTL).

## 3. Compliance note: `email_user_cache` is global (cross-tenant)

`email_user_cache` maps commit emails → GitHub logins. It is deliberately
**not** org-scoped: the mapping is public GitHub data and resolving it costs
rate-limited API calls, so tenants share the cache.

Consequences:

- It must never store anything beyond `email → login` + bookkeeping columns.
- A user deletion in *any* org hard-deletes the row (see §1) — the cache must
  not resurrect a person another tenant deleted.
- Enterprise contracts that require single-tenant isolation need the per-org
  cache config option (business review pending — see plan §14).

## 4. What is never collected

- No source code is stored in the EKG (only AST metadata and file paths).
- No message *content* from Slack — only search-index references.
- `estimatedEffortHours` and other person-level productivity inferences are
  permanently out of scope.
