import { pgTable, uuid, text, integer, jsonb, timestamp, index } from 'drizzle-orm/pg-core';
import { organizations, repositories } from './organizations';
import { vector } from './ast';

/** Conversations map 1:1 to Mastra threads. */
export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // Better Auth user id
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    orgUserIdx: index('conversations_org_user_idx').on(t.orgId, t.userId),
  }),
);

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // user | assistant | tool
  content: text('content').notNull(),
  toolCalls: jsonb('tool_calls'),
  toolResults: jsonb('tool_results'),
  modelUsed: text('model_used'),
  tokenCount: integer('token_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/** Mastra Observational Memory — compressed observation logs. */
export const observations = pgTable('observations', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repositories.id, { onDelete: 'set null' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }), // baai/bge-m3 via NVIDIA NIM
  sourceConvId: uuid('source_conv_id').references(() => conversations.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/** Ingestion audit log. */
export const ingestionRuns = pgTable('ingestion_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  repoId: uuid('repo_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  commitHash: text('commit_hash').notNull(),
  trigger: text('trigger').notNull(), // 'webhook' | 'manual' | 'initial'
  status: text('status').notNull().default('running'), // running | complete | failed
  filesParsed: integer('files_parsed').default(0),
  nodesUpserted: integer('nodes_upserted').default(0),
  edgesUpserted: integer('edges_upserted').default(0),
  collateralFiles: integer('collateral_files').default(0),
  durationMs: integer('duration_ms'),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type IngestionRunRow = typeof ingestionRuns.$inferSelect;
