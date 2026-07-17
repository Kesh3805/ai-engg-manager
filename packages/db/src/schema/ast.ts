import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  unique,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { organizations, repositories } from './organizations';

/**
 * pgvector column type. Dimension is reduced to 512 for AST node embeddings
 * (cost/latency trade-off) and 1536 for observational memory.
 */
export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 512})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
});

/**
 * AST Nodes — one row per code entity.
 * In production this table is `PARTITION BY HASH (org_id)` (see migrations/0000_init.sql);
 * Drizzle models the logical shape. `id` is a deterministic UUIDv5 derived from
 * `org_id:repo_id:qualified_name` so re-ingestion is idempotent.
 */
export const astNodes = pgTable(
  'ast_nodes',
  {
    id: uuid('id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    commitHash: text('commit_hash').notNull(),
    nodeType: text('node_type').notNull(), // file|folder|class|interface|function|method|enum|enum_member|variable|decorator
    name: text('name').notNull(),
    qualifiedName: text('qualified_name').notNull(), // 'src/x.ts::ClassName.methodName'
    filePath: text('file_path').notNull(),
    lineStart: integer('line_start'),
    lineEnd: integer('line_end'),
    byteStart: integer('byte_start'),
    byteEnd: integer('byte_end'),
    language: text('language'),
    signature: text('signature'),
    returnType: text('return_type'),
    complexity: integer('complexity'), // cyclomatic complexity
    metadata: jsonb('metadata').default({}),
    embedding: vector('embedding', { dimensions: 1024 }), // baai/bge-m3 via NVIDIA NIM
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    uniqueQualifiedName: unique('ast_nodes_qn_uq').on(t.orgId, t.repoId, t.qualifiedName),
    orgRepoIdx: index('idx_ast_nodes_org_repo').on(t.orgId, t.repoId),
    typeIdx: index('idx_ast_nodes_org_type').on(t.orgId, t.repoId, t.nodeType),
    nameIdx: index('idx_ast_nodes_org_name').on(t.orgId, t.repoId, t.name),
    filePathIdx: index('idx_ast_nodes_file_path').on(t.orgId, t.repoId, t.filePath),
    commitIdx: index('idx_ast_nodes_commit').on(t.repoId, t.commitHash),
  }),
);

/**
 * AST Edges — directed, typed adjacency list. Both traversal directions indexed
 * to keep recursive-CTE blast-radius queries fast in either direction.
 */
export const astEdges = pgTable(
  'ast_edges',
  {
    id: uuid('id').defaultRandom().notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    fromNode: uuid('from_node').notNull(),
    toNode: uuid('to_node').notNull(),
    edgeType: text('edge_type').notNull(), // CONTAINS|CALLS|USAGE|IMPORTS|IMPLEMENTS|INHERITS|EXPORTS|DECORATES
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.orgId, t.id] }),
    uniqueEdge: unique('ast_edges_uq').on(t.orgId, t.fromNode, t.toNode, t.edgeType),
    forwardIdx: index('idx_ast_edges_forward').on(t.orgId, t.repoId, t.fromNode, t.edgeType),
    reverseIdx: index('idx_ast_edges_reverse').on(t.orgId, t.repoId, t.toNode, t.edgeType),
    typeIdx: index('idx_ast_edges_type').on(t.orgId, t.repoId, t.edgeType),
  }),
);

export type AstNodeRow = typeof astNodes.$inferSelect;
export type AstNodeInsert = typeof astNodes.$inferInsert;
export type AstEdgeRow = typeof astEdges.$inferSelect;
export type AstEdgeInsert = typeof astEdges.$inferInsert;
