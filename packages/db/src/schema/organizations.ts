import { pgTable, uuid, text, timestamp, index, boolean, integer } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('free'),
  // AES-256-GCM ciphertext (see apps/web/src/server/crypto.ts). Never stored in plaintext.
  deploymentWebhookSecret: text('deployment_webhook_secret'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const repositories = pgTable(
  'repositories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    githubRepoId: text('github_repo_id').unique(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull(), // 'owner/repo'
    defaultBranch: text('default_branch').notNull().default('main'),
    lastIndexedCommit: text('last_indexed_commit'),
    indexStatus: text('index_status').notNull().default('pending'), // pending | indexing | ready | error
    lastCommitIndexedSha: text('last_commit_indexed_sha'), // git history progress (separate from AST head)
    lastDocPrAt: timestamp('last_doc_pr_at', { withTimezone: true }), // doc agent weekly claim timestamp
    docAgentEnabled: boolean('doc_agent_enabled').default(false),
    visibility: text('visibility').default('private'),
    language: text('language'),
    stars: integer('stars'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    orgIdx: index('repositories_org_idx').on(t.orgId),
  }),
);
