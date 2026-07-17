# AI Engineering Manager — Full Implementation Plan
> Personal AI Engineering Manager · Tech Lead · Codebase Archaeologist

---

## Architecture at a Glance

| Layer | Technology | Purpose |
|---|---|---|
| Frontend Shell | Next.js 15 | SSR, API routes, auth middleware, caching |
| Interactive SPA | React + Vite + TanStack Router | Architecture Map, real-time graph visualization |
| Animation | Framer Motion + CSS @keyframes | Page transitions, micro-interactions, streaming UI |
| Component System | shadcn/ui + Tailwind CSS v4 | Design system, accessible primitives |
| Authentication | Better Auth + Drizzle ORM | OAuth, RBAC, org-level session management |
| Macro-Orchestration | Mastra | DAG workflows, 5-phase Token Burner pipeline |
| Micro-Execution | Agentica + typia | Compiler-validated LLM tool calls |
| Primary Database | PostgreSQL + pgvector | AST graph (recursive CTEs), semantic recall |
| Full-text Search | Elasticsearch | Slack, Jira, Discord, docs |
| Job Queues | BullMQ + Redis | Ingestion flows, embedding backfill, cron syncs |
| Event Streaming | Confluent Cloud Kafka | Webhook ingestion, telemetry microservices |
| Code Parsing | Tree-sitter | AST generation for 60+ languages |
| Object Storage | S3-compatible | Repo clones, AST JSON snapshots |
| Package Manager | pnpm | Workspace monorepo isolation |

---

## Phase 1 — Monorepo Foundation & Dev Environment

### Objective
Establish the pnpm monorepo, TypeScript base configs, Docker Compose for local infrastructure, and shared utility packages. Every subsequent phase builds on this scaffold.

### Workspace Structure

```
ai-eng-manager/
├── apps/
│   ├── web/                     # Next.js 15 app shell (now includes Architecture Map)
│   ├── kafka-webhook/           # Microservice 1: webhook ingestion
│   └── kafka-telemetry/         # Microservice 2: telemetry consumer
├── packages/
│   ├── db/                      # Drizzle schema + migrations + query helpers
│   ├── ast-parser/              # Tree-sitter extraction + deterministic UUID logic
│   ├── queue/                   # BullMQ queue definitions + worker factories
│   ├── mastra-agents/           # Mastra workflows, agents, memory config
│   ├── integrations/            # GitHub, Jira, Linear, Slack, Discord clients
│   ├── ui/                      # shadcn/ui components + design tokens
│   └── config/                  # Shared ESLint, TypeScript, Tailwind configs
├── docker-compose.yml
├── pnpm-workspace.yaml
└── turbo.json
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":   { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "dev":     { "cache": false, "persistent": true },
    "lint":    { "dependsOn": ["^lint"] },
    "typecheck": { "dependsOn": ["^typecheck"] }
  }
}
```

### Docker Compose (local dev infrastructure)

```yaml
version: '3.9'
services:
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.13.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms512m -Xmx512m
    ports: ['9200:9200']
    volumes: ['esdata:/usr/share/elasticsearch/data']

volumes:
  esdata:
```

### Shared TypeScript base config

```json
// packages/config/tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "paths": {
      "@repo/db":           ["../../packages/db/src/index.ts"],
      "@repo/ast-parser":   ["../../packages/ast-parser/src/index.ts"],
      "@repo/queue":        ["../../packages/queue/src/index.ts"],
      "@repo/mastra-agents":["../../packages/mastra-agents/src/index.ts"],
      "@repo/ui":           ["../../packages/ui/src/index.ts"]
    }
  }
}
```

### Environment variable schema (use `@t3-oss/env-nextjs`)

```typescript
// packages/config/env.ts
import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: {
    // Neon Serverless Postgres
    // e.g. postgresql://neondb_owner:npg_2gM3CJlYVckh@ep-orange-mouse-ah5u7nby-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
    DATABASE_URL:           z.string().url(),
    REDIS_URL:              z.string().url(),
    ELASTICSEARCH_URL:      z.string().url(),
    CONFLUENT_BOOTSTRAP:    z.string(),
    CONFLUENT_API_KEY:      z.string(),
    CONFLUENT_API_SECRET:   z.string(),
    BETTER_AUTH_SECRET:     z.string().min(32),
    GITHUB_CLIENT_ID:       z.string(),
    GITHUB_CLIENT_SECRET:   z.string(),
    ANTHROPIC_API_KEY:      z.string(),
    OPENAI_API_KEY:         z.string().optional(),
    S3_BUCKET:              z.string(),
    S3_ENDPOINT:            z.string().url(),
    AST_UUID_NAMESPACE:     z.string().uuid(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
  },
  runtimeEnv: process.env,
});
```

---

## Phase 2 — Database Schema & Storage Layer

### Objective
Define the complete PostgreSQL schema, Elasticsearch index mappings, and Object Storage bucket structure. This is the source of truth for all persistent state.

### PostgreSQL Schema — Core Tables

```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- for fuzzy text search on names

-- Organizations (Better Auth manages users/sessions separately)
CREATE TABLE organizations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  plan        TEXT NOT NULL DEFAULT 'free',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Repositories linked per org
CREATE TABLE repositories (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  github_repo_id      BIGINT UNIQUE,
  name                TEXT NOT NULL,
  full_name           TEXT NOT NULL,              -- 'owner/repo'
  default_branch      TEXT NOT NULL DEFAULT 'main',
  last_indexed_commit TEXT,
  index_status        TEXT NOT NULL DEFAULT 'pending', -- pending | indexing | ready | error
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON repositories (org_id);
```

### PostgreSQL Schema — AST Graph Tables

```sql
-- AST Nodes: one row per code entity (Partitioned by org_id)
CREATE TABLE ast_nodes (
  id              UUID,               -- UUIDv5(org_id:repo_id:qualified_name)
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id         UUID NOT NULL REFERENCES repositories(id)  ON DELETE CASCADE,
  commit_hash     TEXT NOT NULL,
  node_type       TEXT NOT NULL,                  -- file|folder|class|interface|function|method|enum|enum_member|variable|decorator
  name            TEXT NOT NULL,
  qualified_name  TEXT NOT NULL,                  -- canonical: 'src/x.ts::ClassName.methodName'
  file_path       TEXT NOT NULL,
  line_start      INT,
  line_end        INT,
  byte_start      INT,
  byte_end        INT,
  language        TEXT,
  signature       TEXT,                           -- full function/class signature
  return_type     TEXT,
  complexity      INT,                            -- cyclomatic complexity
  metadata        JSONB DEFAULT '{}',             -- decorators, modifiers, JSDoc, etc.
  embedding       vector(512),                    -- populated async by embed-nodes queue (dimension reduced)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, id),                       -- required for partitioning
  UNIQUE (org_id, repo_id, qualified_name)
) PARTITION BY HASH (org_id);

-- Composite indexes for CTE traversal (both directions)
CREATE INDEX idx_ast_nodes_org_repo       ON ast_nodes (org_id, repo_id);
CREATE INDEX idx_ast_nodes_org_type       ON ast_nodes (org_id, repo_id, node_type);
CREATE INDEX idx_ast_nodes_org_name       ON ast_nodes (org_id, repo_id, name);
CREATE INDEX idx_ast_nodes_file_path      ON ast_nodes (org_id, repo_id, file_path);
CREATE INDEX idx_ast_nodes_commit         ON ast_nodes (repo_id, commit_hash);
CREATE INDEX idx_ast_nodes_embedding      ON ast_nodes USING hnsw (embedding vector_cosine_ops);

-- AST Edges: directed, typed adjacency list (Partitioned by org_id)
CREATE TABLE ast_edges (
  id          UUID DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id     UUID NOT NULL REFERENCES repositories(id)  ON DELETE CASCADE,
  from_node   UUID NOT NULL,
  to_node     UUID NOT NULL,
  edge_type   TEXT NOT NULL,                      -- CONTAINS|CALLS|USAGE|IMPORTS|IMPLEMENTS|INHERITS|EXPORTS|DECORATES
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, from_node, to_node, edge_type)
) PARTITION BY HASH (org_id);

-- Both traversal directions indexed
CREATE INDEX idx_ast_edges_forward  ON ast_edges (org_id, repo_id, from_node, edge_type);
CREATE INDEX idx_ast_edges_reverse  ON ast_edges (org_id, repo_id, to_node,   edge_type);
CREATE INDEX idx_ast_edges_type     ON ast_edges (org_id, repo_id, edge_type);
```

### PostgreSQL Schema — Conversations & Memory

```sql
-- Conversations (maps to Mastra threads)
CREATE TABLE conversations (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,                      -- Better Auth user id
  title       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON conversations (org_id, user_id);

-- Messages
CREATE TABLE messages (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,                  -- user | assistant | tool
  content         TEXT NOT NULL,
  tool_calls      JSONB,
  tool_results    JSONB,
  model_used      TEXT,
  token_count     INT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Mastra Observational Memory (compressed observation logs)
CREATE TABLE observations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  repo_id         UUID REFERENCES repositories(id) ON DELETE SET NULL,
  content         TEXT NOT NULL,                  -- compressed observation
  embedding       vector(1536),
  source_conv_id  UUID REFERENCES conversations(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON observations USING hnsw (embedding vector_cosine_ops);

-- Ingestion audit log
CREATE TABLE ingestion_runs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  repo_id         UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  commit_hash     TEXT NOT NULL,
  trigger         TEXT NOT NULL,                  -- 'webhook' | 'manual' | 'initial'
  status          TEXT NOT NULL DEFAULT 'running',-- running | complete | failed
  files_parsed    INT DEFAULT 0,
  nodes_upserted  INT DEFAULT 0,
  edges_upserted  INT DEFAULT 0,
  collateral_files INT DEFAULT 0,
  duration_ms     INT,
  error           TEXT,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

### Elasticsearch Index Mappings

```json
// slack_messages index
{
  "mappings": {
    "properties": {
      "org_id":       { "type": "keyword" },
      "channel_id":   { "type": "keyword" },
      "channel_name": { "type": "keyword" },
      "user_id":      { "type": "keyword" },
      "text":         { "type": "text",    "analyzer": "english" },
      "thread_ts":    { "type": "keyword" },
      "ts":           { "type": "date",    "format": "epoch_second" },
      "mentions":     { "type": "keyword" }
    }
  }
}

// jira_tickets index — same pattern for linear_issues
{
  "mappings": {
    "properties": {
      "org_id":       { "type": "keyword" },
      "ticket_id":    { "type": "keyword" },
      "project_key":  { "type": "keyword" },
      "summary":      { "type": "text",    "analyzer": "english" },
      "description":  { "type": "text",    "analyzer": "english" },
      "status":       { "type": "keyword" },
      "assignee":     { "type": "keyword" },
      "labels":       { "type": "keyword" },
      "created_at":   { "type": "date" },
      "updated_at":   { "type": "date" }
    }
  }
}
```

### Object Storage Bucket Structure

```
s3://ai-eng-manager-{org-id}/
├── repo-clones/
│   └── {repo_id}/
│       └── {commit_hash}.tar.gz          # compressed repo snapshot
├── ast-snapshots/
│   └── {repo_id}/
│       └── {commit_hash}/
│           └── {file_path_hash}.json     # raw Tree-sitter AST JSON per file
└── embeddings-cache/
    └── {org_id}/
        └── {node_id}.vec                 # cached embedding vectors (optional)
```

### Drizzle Schema (packages/db)

```typescript
// packages/db/src/schema/ast.ts
import { pgTable, uuid, text, integer, jsonb, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) { return `vector(${config?.dimensions ?? 512})`; },
});

export const astNodes = pgTable('ast_nodes', {
  id:            uuid('id').notNull(),
  orgId:         uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  repoId:        uuid('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  commitHash:    text('commit_hash').notNull(),
  nodeType:      text('node_type').notNull(),
  name:          text('name').notNull(),
  qualifiedName: text('qualified_name').notNull(),
  filePath:      text('file_path').notNull(),
  lineStart:     integer('line_start'),
  lineEnd:       integer('line_end'),
  signature:     text('signature'),
  returnType:    text('return_type'),
  complexity:    integer('complexity'),
  metadata:      jsonb('metadata').default({}),
  embedding:     vector('embedding', { dimensions: 512 }),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  pk:                  primaryKey({ columns: [t.orgId, t.id] }),
  uniqueQualifiedName: unique().on(t.orgId, t.repoId, t.qualifiedName),
  orgRepoIdx:          index().on(t.orgId, t.repoId),
  filePathIdx:         index().on(t.orgId, t.repoId, t.filePath),
}));

export const astEdges = pgTable('ast_edges', {
  id:         uuid('id').defaultRandom().primaryKey(),
  orgId:      uuid('org_id').notNull(),
  repoId:     uuid('repo_id').notNull(),
  fromNode:   uuid('from_node').notNull().references(() => astNodes.id, { onDelete: 'cascade' }),
  toNode:     uuid('to_node').notNull().references(() => astNodes.id,   { onDelete: 'cascade' }),
  edgeType:   text('edge_type').notNull(),
  metadata:   jsonb('metadata').default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  forwardIdx: index().on(t.orgId, t.repoId, t.fromNode, t.edgeType),
  reverseIdx: index().on(t.orgId, t.repoId, t.toNode,   t.edgeType),
}));
```

---

## Phase 3 — Authentication & Multi-tenancy

### Objective
Implement Better Auth with full organizational RBAC, Drizzle adapter, Next.js 15 middleware, and API key management for CI/CD pipelines.

### Better Auth Installation

```bash
pnpm add better-auth drizzle-orm --filter web
```

```typescript
// apps/web/src/lib/auth.ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization } from 'better-auth/plugins';
import { db } from '@repo/db';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  secret: process.env.BETTER_AUTH_SECRET!,
  
  socialProviders: {
    github: {
      clientId:     process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  session: {
    cookieCache: {
      enabled:   true,
      maxAge:    60 * 5,          // 5-minute signed cookie cache
    },
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 3,
      roles: {
        owner:  { permissions: ['*'] },
        admin:  { permissions: ['repo:*', 'integration:*', 'member:read'] },
        member: { permissions: ['repo:read', 'query:*'] },
        viewer: { permissions: ['repo:read', 'query:read'] },
      },
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
```

### Next.js 15 Middleware

```typescript
// apps/web/src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });

  // Protect all /app/* routes
  if (request.nextUrl.pathname.startsWith('/app') && !session) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  // Inject org_id into headers for downstream API routes
  if (session?.session?.activeOrganizationId) {
    const response = NextResponse.next();
    response.headers.set('x-org-id', session.session.activeOrganizationId);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/api/v1/:path*'],
};
```

### Org-level Query Guard Utility

```typescript
// packages/db/src/guards.ts
import { db } from './client';
import { organizationMembers } from './schema/auth';
import { eq, and } from 'drizzle-orm';

export async function assertOrgAccess(
  userId:     string,
  orgId:      string,
  permission: string
): Promise<void> {
  const member = await db.query.organizationMembers.findFirst({
    where: and(
      eq(organizationMembers.userId,         userId),
      eq(organizationMembers.organizationId, orgId)
    ),
  });

  if (!member) throw new Error('UNAUTHORIZED');

  const rolePermissions = ROLE_PERMISSIONS[member.role] ?? [];
  const hasPermission = rolePermissions.includes('*') ||
    rolePermissions.includes(permission) ||
    rolePermissions.some(p => permission.startsWith(p.replace('*', '')));

  if (!hasPermission) throw new Error('FORBIDDEN');
}
```

---

## Phase 4 — Codebase Archaeologist: AST Ingestion Pipeline

### Objective
Build the Tree-sitter parsing pipeline with deterministic UUIDv5 identity, BullMQ FlowProducer fan-out/fan-in pattern, pre-delete inbound capture for rename resolution, and async embedding backfill.

### Deterministic Node Identity (packages/ast-parser)

```typescript
// packages/ast-parser/src/identity.ts
import { v5 as uuidv5 } from 'uuid';

const AST_NAMESPACE = process.env.AST_UUID_NAMESPACE!;

export const QualifiedName = {
  file:       (filePath: string) =>
                filePath,
  class:      (filePath: string, name: string) =>
                `${filePath}::${name}`,
  interface:  (filePath: string, name: string) =>
                `${filePath}::${name}`,
  function:   (filePath: string, name: string) =>
                `${filePath}::${name}`,
  method:     (filePath: string, className: string, methodName: string) =>
                `${filePath}::${className}.${methodName}`,
  enum:       (filePath: string, name: string) =>
                `${filePath}::${name}`,
  enumMember: (filePath: string, enumName: string, member: string) =>
                `${filePath}::${enumName}.${member}`,
  // Overloaded methods: append param type signature
  methodOverload: (filePath: string, className: string, methodName: string, paramTypes: string[]) =>
                `${filePath}::${className}.${methodName}(${paramTypes.join(',')})`,
};

export function deterministicNodeId(
  orgId:         string,
  repoId:        string,
  qualifiedName: string
): string {
  return uuidv5(`${orgId}:${repoId}:${qualifiedName}`, AST_NAMESPACE);
}
```

### Tree-sitter Extraction Worker

```typescript
// packages/ast-parser/src/extractor.ts
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { deterministicNodeId, QualifiedName } from './identity';
import type { ASTNode, ASTEdge } from './types';

export async function extractFromFile(
  orgId:      string,
  repoId:     string,
  commitHash: string,
  filePath:   string,
  content:    string
): Promise<{ nodes: ASTNode[]; edges: ASTEdge[] }> {
  const parser = new Parser();
  parser.setLanguage(TypeScript.typescript);

  const tree   = parser.parse(content);
  const nodes: ASTNode[] = [];
  const edges: ASTEdge[] = [];

  // Insert the file node itself
  const fileQN = QualifiedName.file(filePath);
  const fileId = deterministicNodeId(orgId, repoId, fileQN);
  nodes.push({
    id: fileId, orgId, repoId, commitHash,
    nodeType: 'file', name: filePath.split('/').pop()!,
    qualifiedName: fileQN, filePath,
    lineStart: 1, lineEnd: content.split('\n').length,
  });

  // Walk the syntax tree
  walkTree(tree.rootNode, { orgId, repoId, commitHash, filePath, fileId, nodes, edges });

  return { nodes, edges };
}

function walkTree(node: Parser.SyntaxNode, ctx: WalkContext) {
  switch (node.type) {
    case 'class_declaration':
      handleClass(node, ctx);
      break;
    case 'function_declaration':
    case 'arrow_function':
      handleFunction(node, ctx);
      break;
    case 'enum_declaration':
      handleEnum(node, ctx);
      break;
    case 'call_expression':
      handleCallExpression(node, ctx);
      break;
    case 'import_declaration':
      handleImport(node, ctx);
      break;
  }
  for (const child of node.children) walkTree(child, ctx);
}
```

### BullMQ Queue Definitions (packages/queue)

```typescript
// packages/queue/src/queues.ts
import { Queue, FlowProducer } from 'bullmq';
import { redis } from './redis';

export const Queues = {
  repoIngestion: new Queue('repo-ingestion',  { connection: redis }),
  fileParsing:   new Queue('file-parsing',    { connection: redis }),
  embedNodes:    new Queue('embed-nodes',     { connection: redis }),
  collateralParse: new Queue('collateral-parse', { connection: redis }),
};

export const flowProducer = new FlowProducer({ connection: redis });

// Job type definitions
export type RepoIngestionJob = {
  repoId:      string;
  orgId:       string;
  commitHash:  string;
  changedFiles: { path: string; status: 'modified' | 'renamed' | 'deleted'; oldPath?: string }[];
  trigger:     'webhook' | 'manual' | 'initial';
  runId:       string;
};

export type FileParsingJob = {
  repoId:     string;
  orgId:      string;
  commitHash: string;
  filePath:   string;
  depth:      0 | 1;            // depth=1 = collateral re-parse, never spawns further collateral
};

export type EmbedNodesJob = {
  orgId:   string;
  nodeIds: string[];            // batched at 50-100 per job
};
```

### Parent Ingestion Worker — Full Transaction Sequence

```typescript
// packages/queue/src/workers/repo-ingestion.worker.ts
import { Worker } from 'bullmq';
import { db } from '@repo/db';
import { astNodes, astEdges } from '@repo/db/schema';
import { sql, inArray, and, eq, ne } from 'drizzle-orm';
import { redis } from '../redis';
import { Queues, flowProducer } from '../queues';

export const repoIngestionWorker = new Worker('repo-ingestion', async (job) => {
  const { repoId, orgId, commitHash, changedFiles, runId } = job.data as RepoIngestionJob;

  const changedPaths   = changedFiles.map(f => f.path);
  const deletedPaths   = changedFiles.filter(f => f.status === 'deleted').map(f => f.path);

  // 1. Fan out file parse children (skip deleted files — nothing to parse)
  const parseablePaths = changedFiles
    .filter(f => f.status !== 'deleted')
    .map(f => f.path);

  await flowProducer.add({
    name:      'ingest-repo',
    queueName: 'repo-ingestion',
    data:      job.data,
    children:  parseablePaths.map(filePath => ({
      name:      'parse-file',
      queueName: 'file-parsing',
      data:      { repoId, orgId, commitHash, filePath, depth: 0 },
    })),
  });

  // BullMQ resumes here only after ALL children complete
  // 2. Collect staged results from Redis
  const stagedKeys = await redis.keys(`ast:staged:${repoId}:${commitHash}:*`);
  const allNodes: any[] = [];
  const allEdges: any[] = [];

  for (const key of stagedKeys) {
    const raw = await redis.get(key);
    if (!raw) continue;
    const { nodes, edges } = JSON.parse(raw);
    allNodes.push(...nodes);
    allEdges.push(...edges);
  }

  await db.transaction(async (trx) => {
    // 3. PRE-DELETE INBOUND CAPTURE — runs first, before any mutation
    const collateralFiles = await trx.execute(sql`
      SELECT DISTINCT n_caller.file_path AS collateral_file
      FROM ast_nodes n_target
      JOIN ast_edges e         ON e.to_node    = n_target.id
                              AND e.edge_type  IN ('CALLS','USAGE','IMPORTS','IMPLEMENTS')
      JOIN ast_nodes n_caller  ON n_caller.id  = e.from_node
                              AND n_caller.org_id = ${orgId}
      WHERE n_target.org_id    = ${orgId}
        AND n_target.repo_id   = ${repoId}
        AND n_target.commit_hash != ${commitHash}
        AND n_target.file_path   = ANY(${changedPaths}::text[])
        AND n_caller.file_path  != ALL(${changedPaths}::text[])
    `);

    // 4. BULK UPSERT nodes — ON CONFLICT preserves UUID, updates volatile fields
    if (allNodes.length > 0) {
      await trx.execute(sql`
        INSERT INTO ast_nodes
          (id, org_id, repo_id, commit_hash, node_type, name, qualified_name,
           file_path, line_start, line_end, signature, return_type, complexity, metadata)
        SELECT * FROM UNNEST(
          ${allNodes.map(n => n.id)}::uuid[],
          ${allNodes.map(n => n.orgId)}::uuid[],
          ${allNodes.map(n => n.repoId)}::uuid[],
          ${allNodes.map(n => n.commitHash)}::text[],
          ${allNodes.map(n => n.nodeType)}::text[],
          ${allNodes.map(n => n.name)}::text[],
          ${allNodes.map(n => n.qualifiedName)}::text[],
          ${allNodes.map(n => n.filePath)}::text[],
          ${allNodes.map(n => n.lineStart)}::int[],
          ${allNodes.map(n => n.lineEnd)}::int[],
          ${allNodes.map(n => n.signature ?? null)}::text[],
          ${allNodes.map(n => n.returnType ?? null)}::text[],
          ${allNodes.map(n => n.complexity ?? null)}::int[],
          ${allNodes.map(n => JSON.stringify(n.metadata ?? {}))}::jsonb[]
        ) AS t(id,org_id,repo_id,commit_hash,node_type,name,qualified_name,
               file_path,line_start,line_end,signature,return_type,complexity,metadata)
        ON CONFLICT (org_id, repo_id, qualified_name) DO UPDATE SET
          commit_hash  = EXCLUDED.commit_hash,
          line_start   = EXCLUDED.line_start,
          line_end     = EXCLUDED.line_end,
          signature    = EXCLUDED.signature,
          complexity   = EXCLUDED.complexity,
          metadata     = EXCLUDED.metadata,
          updated_at   = NOW()
      `);
    }

    // 5. BULK UPSERT edges
    if (allEdges.length > 0) {
      await trx.execute(sql`
        INSERT INTO ast_edges (org_id, repo_id, from_node, to_node, edge_type)
        SELECT * FROM UNNEST(...)
        ON CONFLICT (org_id, from_node, to_node, edge_type) DO NOTHING
      `);
    }

    // 6. STALE NODE SWEEP — CASCADE handles orphaned edges automatically
    await trx.execute(sql`
      DELETE FROM ast_nodes
      WHERE repo_id    = ${repoId}
        AND commit_hash != ${commitHash}
        AND file_path   = ANY(${changedPaths}::text[])
    `);

    // Transaction commits here — graph immediately queryable

    // 7. POST-COMMIT: dispatch background queues
    const collateralPaths = collateralFiles.rows
      .map((r: any) => r.collateral_file)
      .filter((p: string) => !changedPaths.includes(p));

    if (collateralPaths.length > 0) {
      await Queues.collateralParse.addBulk(
        collateralPaths.map((filePath: string) => ({
          name: 'parse-file',
          data: { repoId, orgId, commitHash, filePath, depth: 1 },
        }))
      );
    }

    // Dispatch embed-nodes in batches of 50
    const newNodeIds = allNodes.map(n => n.id);
    for (let i = 0; i < newNodeIds.length; i += 50) {
      await Queues.embedNodes.add('embed-batch', {
        orgId,
        nodeIds: newNodeIds.slice(i, i + 50),
      });
    }

    // Update ingestion run record
    await trx.execute(sql`
      UPDATE ingestion_runs
      SET status         = 'complete',
          nodes_upserted = ${allNodes.length},
          edges_upserted = ${allEdges.length},
          collateral_files = ${collateralPaths.length},
          completed_at   = NOW(),
          duration_ms    = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
      WHERE id = ${runId}
    `);
  });

  // 8. Cleanup Redis staging keys
  await redis.del(...stagedKeys);
}, {
  connection: redis,
  concurrency: 5,
});
```

### Embedding Backfill Worker

```typescript
// packages/queue/src/workers/embed-nodes.worker.ts
import { Worker } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '@repo/db';
import { astNodes } from '@repo/db/schema';
import { inArray } from 'drizzle-orm';

const anthropic = new Anthropic();

function buildEmbedText(node: typeof astNodes.$inferSelect): string {
  switch (node.nodeType) {
    case 'function':
    case 'method':
      // Signature + docstring + body if short
      return [
        node.signature,
        (node.metadata as any)?.docstring,
        (node.metadata as any)?.bodyLines <= 50 ? (node.metadata as any)?.body : null,
      ].filter(Boolean).join('\n').slice(0, 3000);

    case 'class':
    case 'interface':
      return [
        node.signature,
        (node.metadata as any)?.propertyNames?.join(', '),
        (node.metadata as any)?.methodSignatures?.join('\n'),
      ].filter(Boolean).join('\n').slice(0, 2000);

    case 'enum':
      return [
        `enum ${node.name}`,
        (node.metadata as any)?.members?.join(', '),
        (node.metadata as any)?.docstring,
      ].filter(Boolean).join('\n');

    default:
      return node.qualifiedName;
  }
}

export const embedNodesWorker = new Worker('embed-nodes', async (job) => {
  const { orgId, nodeIds } = job.data as EmbedNodesJob;

  const nodes = await db.query.astNodes.findMany({
    where: inArray(astNodes.id, nodeIds),
  });

  // Batch embed via text-embedding-3-small (cost-effective)
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model: 'text-embedding-3-small',
      input: nodes.map(buildEmbedText),
    }),
  });

  const { data } = await response.json();

  // Bulk update embeddings
  for (let i = 0; i < nodes.length; i++) {
    await db.execute(sql`
      UPDATE ast_nodes SET embedding = ${JSON.stringify(data[i].embedding)}::vector
      WHERE id = ${nodes[i].id} AND org_id = ${orgId}
    `);
  }
}, { connection: redis, concurrency: 3 });
```

---

## Phase 5 — Async Infrastructure: BullMQ + Kafka Microservices

### Objective
Implement the two Kafka microservices on Confluent Cloud and finalize all BullMQ queue configurations including retry policies, dead-letter queues, and cron sync jobs.

### Confluent Cloud Topic Setup

```
Topics:
  github.webhooks          partitions=12, key=repo_id hash
  slack.messages           partitions=6,  key=channel_id hash
  discord.messages         partitions=6,  key=channel_id hash
  jira.events              partitions=4,  key=project_key hash
  linear.events            partitions=4,  key=team_id hash
  telemetry.processed      partitions=8,  key=org_id hash
```

### Kafka Microservice 1 — Webhook Ingestion (apps/kafka-webhook)

```typescript
// apps/kafka-webhook/src/index.ts
import { Kafka, CompressionTypes } from '@confluentinc/kafka-javascript';
import express from 'express';

const kafka = new Kafka({
  kafkaJS: {
    brokers:  [process.env.CONFLUENT_BOOTSTRAP!],
    sasl: {
      mechanism: 'plain',
      username:  process.env.CONFLUENT_API_KEY!,
      password:  process.env.CONFLUENT_API_SECRET!,
    },
    ssl: true,
  },
});

const producer = kafka.producer({
  kafkaJS: {
    linger:       5,           // 5ms batching window for high-volume merge events
    compression:  CompressionTypes.Snappy,
    acks:         -1,          // all ISRs must acknowledge
  },
});

const app = express();
app.use(express.json());

// GitHub webhook handler
app.post('/webhooks/github', verifyGithubSignature, async (req, res) => {
  const event   = req.headers['x-github-event'] as string;
  const payload = req.body;

  await producer.send({
    topic:    'github.webhooks',
    messages: [{
      key:   payload.repository?.id?.toString(),
      value: JSON.stringify({ event, payload, receivedAt: Date.now() }),
    }],
  });

  res.status(202).send({ ok: true });
});

// Slack Events API handler
app.post('/webhooks/slack', verifySlackSignature, async (req, res) => {
  if (req.body.type === 'url_verification') {
    return res.json({ challenge: req.body.challenge });
  }
  await producer.send({
    topic:    'slack.messages',
    messages: [{ key: req.body.event?.channel, value: JSON.stringify(req.body) }],
  });
  res.status(200).send();
});
```

### Kafka Microservice 2 — Telemetry Consumer (apps/kafka-telemetry)

```typescript
// apps/kafka-telemetry/src/index.ts
const consumer = kafka.consumer({
  kafkaJS: { groupId: 'telemetry-consumer-group' },
});

await consumer.subscribe({ topics: ['github.webhooks', 'slack.messages', 'jira.events'] });

await consumer.run({
  eachMessage: async ({ topic, message }) => {
    const payload = JSON.parse(message.value!.toString());

    switch (topic) {
      case 'github.webhooks':
        await handleGithubEvent(payload);   // triggers BullMQ repo ingestion
        break;
      case 'slack.messages':
        await indexSlackMessage(payload);   // writes to Elasticsearch
        break;
      case 'jira.events':
        await indexJiraEvent(payload);      // writes to Elasticsearch + triggers PM Agent update
        break;
    }
  },
});

async function handleGithubEvent({ event, payload }) {
  if (event === 'push') {
    const changedFiles = await getChangedFiles(payload.commits);
    await Queues.repoIngestion.add('incremental-ingest', {
      repoId:      payload.repository.id.toString(),
      orgId:       await getOrgForRepo(payload.repository.id),
      commitHash:  payload.after,
      changedFiles,
      trigger:     'webhook',
      runId:       randomUUID(),
    });
  }
}
```

### BullMQ Cron Jobs — Scheduled Syncs

```typescript
// packages/queue/src/crons.ts
export async function registerCronJobs() {
  // Sync Jira tickets every 15 minutes
  await Queues.repoIngestion.add('sync-jira', {}, {
    repeat: { pattern: '*/15 * * * *' },
    jobId:  'jira-sync-cron',
  });

  // Sync Linear issues every 15 minutes
  await Queues.repoIngestion.add('sync-linear', {}, {
    repeat: { pattern: '*/15 * * * *' },
    jobId:  'linear-sync-cron',
  });

  // Daily Observational Memory compression (midnight IST)
  await Queues.repoIngestion.add('compress-memory', {}, {
    repeat:   { pattern: '30 18 * * *' },  // 18:30 UTC = midnight IST
    jobId:    'memory-compression-cron',
  });
}
```

---

## Phase 6 — External Service Integrations (packages/integrations)

### GitHub App Client

```typescript
// packages/integrations/src/github/client.ts
import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export function getGithubClient(installationId: number): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId:          process.env.GITHUB_APP_ID!,
      privateKey:     process.env.GITHUB_APP_PRIVATE_KEY!,
      installationId,
    },
  });
}

export async function getChangedFiles(
  octokit:    Octokit,
  owner:      string,
  repo:       string,
  baseSha:    string,
  headSha:    string
) {
  const { data } = await octokit.repos.compareCommitsWithBasehead({
    owner, repo,
    basehead: `${baseSha}...${headSha}`,
  });
  return data.files?.map(f => ({
    path:    f.filename,
    status:  f.status as 'modified' | 'renamed' | 'deleted',
    oldPath: f.previous_filename,
  })) ?? [];
}
```

### Linear GraphQL Client

```typescript
// packages/integrations/src/linear/client.ts
import { LinearClient } from '@linear/sdk';

export function getLinearClient(accessToken: string) {
  return new LinearClient({ accessToken });
}

export async function fetchIssuesByTeam(client: LinearClient, teamId: string) {
  const issues = await client.issues({
    filter: { team: { id: { eq: teamId } } },
    orderBy: LinearDocument.PaginationOrderBy.UpdatedAt,
  });
  return issues.nodes;
}
```

### Slack Web API Client

```typescript
// packages/integrations/src/slack/client.ts
import { WebClient } from '@slack/web-api';

export function getSlackClient(botToken: string) {
  return new WebClient(botToken);
}

export async function fetchChannelHistory(
  client:    WebClient,
  channelId: string,
  oldest:    string  // Unix timestamp string
) {
  const result = await client.conversations.history({
    channel: channelId,
    oldest,
    limit:   200,
  });
  return result.messages ?? [];
}
```

---

## Phase 7 — AI Orchestration: Token Burner Pipeline

### Objective
Implement the 5-phase Mastra workflow with model-routing, three specialized agents, Agentica micro-executor, and three memory systems.

### Mastra Setup (packages/mastra-agents)

```typescript
// packages/mastra-agents/src/mastra.ts
import { Mastra, createLogger } from '@mastra/core';
import { PostgresMemory } from '@mastra/memory-postgres';
import { codeAgent } from './agents/code.agent';
import { docAgent }  from './agents/doc.agent';
import { pmAgent }   from './agents/pm.agent';

export const mastra = new Mastra({
  agents: { codeAgent, docAgent, pmAgent },
  memory: new PostgresMemory({
    connectionString: process.env.DATABASE_URL!,
    workingMemory: {
      enabled:     true,
      maxTokens:   4000,                    // active sprint goals, arch patterns
    },
    semanticRecall: {
      enabled:     true,
      topK:        15,
      minSimilarity: 0.72,
    },
    observational: {
      enabled:        true,
      compressionModel: 'claude-haiku-4-5-20251001',
    },
  }),
  logger: createLogger({ level: 'INFO' }),
});
```

### Token Burner Workflow

```typescript
// packages/mastra-agents/src/workflows/token-burner.workflow.ts
import { createWorkflow, createStep } from '@mastra/core';
import { anthropic } from '@ai-sdk/anthropic';

const MODELS = {
  reasoning:    anthropic('claude-sonnet-4-6'),   // Phase 2 & 4
  execution:    anthropic('claude-haiku-4-5-20251001'), // Phase 3 & 5
};

// Phase 1: Parallel Retrieval
const retrievalStep = createStep({
  id: 'parallel-retrieval',
  execute: async ({ context }) => {
    const { query, orgId, repoId } = context;

    const [astResults, vectorResults, esResults] = await Promise.all([
      // Code Agent: recursive CTE blast radius / dependency
      runBlastRadiusCTE(orgId, repoId, extractEntityName(query)),
      // pgvector: semantic recall from past interactions
      semanticRecall(orgId, query, 15),
      // Elasticsearch: Jira tickets, Slack threads, docs
      elasticFullText(orgId, query),
    ]);

    return { astResults, vectorResults, esResults };
  },
});

// Phase 2: Reasoning (Sonnet)
const reasoningStep = createStep({
  id: 'strategic-reasoning',
  execute: async ({ context, results }) => {
    const { query } = context;
    const retrievalPayload = results['parallel-retrieval'];

    const response = await generateText({
      model:  MODELS.reasoning,
      system: REASONING_SYSTEM_PROMPT,
      prompt: `
        <query>${query}</query>
        <ast_context>${JSON.stringify(retrievalPayload.astResults)}</ast_context>
        <semantic_context>${JSON.stringify(retrievalPayload.vectorResults)}</semantic_context>
        <text_context>${JSON.stringify(retrievalPayload.esResults)}</text_context>

        Analyze the query against this context. Identify knowledge gaps.
        Output a structured execution plan listing which external tools to call
        and in what order, with justification for each.
      `,
    });

    return { executionPlan: response.text, retrievalPayload };
  },
});

// Phase 3: Compiler-Validated Tool Calls (Haiku + Agentica)
const toolExecutionStep = createStep({
  id: 'tool-execution',
  execute: async ({ results }) => {
    const { executionPlan } = results['strategic-reasoning'];
    const toolResults = await agenticaExecutor.run(executionPlan);
    return { toolResults };
  },
});

// Phase 4: Synthesis (Sonnet)
const synthesisStep = createStep({
  id: 'synthesis',
  execute: async ({ context, results }) => {
    const allContext = {
      ...results['strategic-reasoning'].retrievalPayload,
      ...results['tool-execution'].toolResults,
    };
    const response = await streamText({
      model:  MODELS.reasoning,
      system: SYNTHESIS_SYSTEM_PROMPT,
      prompt: buildSynthesisPrompt(context.query, allContext),
    });
    return { stream: response.textStream };
  },
});

// Phase 5: Memory Update (Haiku — runs async, doesn't block response stream)
const memoryUpdateStep = createStep({
  id: 'memory-update',
  execute: async ({ context, results }) => {
    // Runs in background — not awaited by the response stream
    setImmediate(async () => {
      await mastra.memory.observe({
        orgId:  context.orgId,
        thread: context.conversationId,
        content: buildObservation(context.query, results),
        model:  MODELS.execution,
      });
    });
    return {};
  },
});

export const tokenBurnerWorkflow = createWorkflow({
  id: 'token-burner',
  steps: [
    retrievalStep,
    reasoningStep.after(retrievalStep),
    toolExecutionStep.after(reasoningStep),
    synthesisStep.after(toolExecutionStep),
    memoryUpdateStep.after(synthesisStep),  // non-blocking
  ],
});
```

### Agentica Micro-Executor

```typescript
// packages/mastra-agents/src/agentica/executor.ts
import { Agentica } from '@agentica/core';
import { z } from 'zod';
import { GithubTools } from './tools/github.tools';
import { JiraTools }   from './tools/jira.tools';
import { LinearTools } from './tools/linear.tools';

// Zod validates tool schemas seamlessly with ai-sdk integration
export const agenticaExecutor = new Agentica({
  model:  'claude-haiku-4-5-20251001',
  tools: [
    ...GithubTools,
    ...JiraTools,
    ...LinearTools,
  ],
  onValidationError: async (error, retry) => {
    // Agentica feeds validation failure back to model for auto-correction
    console.warn('Tool call validation failed, retrying:', error.message);
    return retry();   // max 3 auto-correction attempts built-in
  },
});
```

### Recursive CTE Query Layer

```typescript
// packages/mastra-agents/src/queries/blast-radius.ts
import { db } from '@repo/db';
import { sql } from 'drizzle-orm';

export async function blastRadiusCTE(
  orgId:      string,
  repoId:     string,
  entityName: string,
  maxDepth:   number = 8
) {
  return db.execute(sql`
    WITH RECURSIVE blast_radius AS (
      SELECT n.id, n.name, n.node_type, n.file_path, n.line_start,
             0 AS depth, ARRAY[n.id] AS visited, ARRAY[n.name] AS path
      FROM ast_nodes n
      WHERE n.org_id  = ${orgId}
        AND n.repo_id = ${repoId}
        AND n.name    = ${entityName}

      UNION ALL

      SELECT n.id, n.name, n.node_type, n.file_path, n.line_start,
             br.depth + 1, br.visited || n.id, br.path || n.name
      FROM blast_radius br
      JOIN ast_edges e ON e.to_node   = br.id
                      AND e.edge_type IN ('CALLS','USAGE','IMPLEMENTS')
                      AND e.org_id    = ${orgId}
      JOIN ast_nodes n ON n.id        = e.from_node
                      AND n.org_id    = ${orgId}
      WHERE br.depth < ${maxDepth}
        AND NOT (n.id = ANY(br.visited))
    )
    SELECT DISTINCT id, name, node_type, file_path, line_start, depth, path
    FROM blast_radius
    WHERE depth > 0
    ORDER BY depth, node_type, name
  `);
}
```

---

## Phase 8 — Backend API Layer (Next.js 15)

### Objective
Implement streaming chat endpoint, repository management APIs, WebSocket for real-time ingestion status, and org-scoped middleware.

### Streaming Chat Route

```typescript
// apps/web/src/app/api/v1/chat/route.ts
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { tokenBurnerWorkflow } from '@repo/mastra-agents';
import { assertOrgAccess } from '@repo/db/guards';

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { message, conversationId, orgId, repoId } = await req.json();
  await assertOrgAccess(session.user.id, orgId, 'query:write');

  const encoder = new TextEncoder();
  const stream  = new ReadableStream({
    async start(controller) {
      try {
        const result = await tokenBurnerWorkflow.execute({
          orgId, repoId, query: message,
          userId: session.user.id,
          conversationId,
        });

        for await (const chunk of result.stream) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Pipeline failed' })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
```

### Repository Management Routes

```typescript
// apps/web/src/app/api/v1/repos/route.ts
export async function POST(req: NextRequest) {
  // Link a new repository → triggers initial full ingestion
  const { githubRepoFullName, orgId } = await req.json();
  // ... create repo record, add ingestion job
}

// apps/web/src/app/api/v1/repos/[repoId]/status/route.ts
export async function GET(req: NextRequest, { params }) {
  // Returns current ingestion run status, node/edge counts, last commit
}
```

### WebSocket — Real-time Ingestion Progress

```typescript
// apps/web/src/app/api/v1/ws/route.ts  (Next.js 15 WebSocket support)
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ noServer: true });
const orgSockets = new Map<string, Set<WebSocket>>();

// BullMQ workers emit events to Redis pub/sub
// WebSocket route subscribes and forwards to connected clients
redis.subscribe('ingestion:progress', (message) => {
  const { orgId, repoId, runId, nodesProcessed, status } = JSON.parse(message);
  orgSockets.get(orgId)?.forEach(ws => {
    ws.send(JSON.stringify({ type: 'ingestion:progress', repoId, nodesProcessed, status }));
  });
});
```

---

## Phase 9 — Frontend Foundation & Design System

### Objective
Establish the Next.js 15 app shell, Tailwind CSS v4 with custom design tokens, shadcn/ui component library, Framer Motion setup, and the dual Next.js/Vite architecture.

### Tailwind CSS v4 Config with Custom Tokens

```css
/* apps/web/src/styles/globals.css */
@import "tailwindcss";

@theme {
  /* Brand colors */
  --color-brand-50:   #f0f4ff;
  --color-brand-100:  #e0e9ff;
  --color-brand-500:  #4f46e5;
  --color-brand-600:  #4338ca;
  --color-brand-900:  #1e1b4b;

  /* Semantic surface colors */
  --color-surface:          oklch(0.99 0 0);
  --color-surface-raised:   oklch(0.97 0 0);
  --color-surface-overlay:  oklch(0.95 0 0);
  --color-border:           oklch(0.90 0 0);
  --color-border-strong:    oklch(0.82 0 0);

  /* Typography */
  --font-sans:   'Geist', system-ui, sans-serif;
  --font-mono:   'Geist Mono', 'Fira Code', monospace;

  /* Motion */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out:    cubic-bezier(0.22, 1, 0.36, 1);

  /* Shadows */
  --shadow-sm:  0 1px 2px oklch(0 0 0 / 0.05);
  --shadow-md:  0 4px 6px oklch(0 0 0 / 0.07), 0 2px 4px oklch(0 0 0 / 0.05);
  --shadow-lg:  0 10px 15px oklch(0 0 0 / 0.1), 0 4px 6px oklch(0 0 0 / 0.05);
  --shadow-glow: 0 0 0 3px oklch(from var(--color-brand-500) l c h / 0.2);
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  @theme {
    --color-surface:         oklch(0.09 0 0);
    --color-surface-raised:  oklch(0.12 0 0);
    --color-surface-overlay: oklch(0.15 0 0);
    --color-border:          oklch(0.22 0 0);
    --color-border-strong:   oklch(0.30 0 0);
  }
}
```

### Framer Motion Setup & Global Animation Config

```typescript
// packages/ui/src/lib/motion.ts
export const SPRING = {
  type:    'spring',
  stiffness: 400,
  damping:   30,
} as const;

export const EASE_OUT = {
  type:     'tween',
  ease:     [0.22, 1, 0.36, 1],
  duration: 0.35,
} as const;

// Shared page transition variants
export const PAGE_VARIANTS = {
  hidden:  { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0,  filter: 'blur(0px)', transition: EASE_OUT },
  exit:    { opacity: 0, y: -8, filter: 'blur(2px)', transition: { duration: 0.2 } },
};

// List item stagger variants
export const STAGGER_CONTAINER = {
  visible: { transition: { staggerChildren: 0.06 } },
};

export const STAGGER_ITEM = {
  hidden:  { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0,  transition: SPRING },
};

// Sidebar slide variants
export const SIDEBAR_VARIANTS = {
  open:   { x: 0,     opacity: 1, transition: EASE_OUT },
  closed: { x: '-100%', opacity: 0, transition: { duration: 0.25 } },
};
```

### App Shell Layout (Next.js 15)

```typescript
// apps/web/src/app/(app)/layout.tsx
import { AnimatePresence, motion } from 'framer-motion';
import { Sidebar } from '@/components/sidebar';
import { TopNav }  from '@/components/top-nav';
import { PAGE_VARIANTS } from '@repo/ui/motion';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopNav />
        <AnimatePresence mode="wait">
          <motion.main
            key={/* route key */}
            className="flex-1 overflow-y-auto"
            variants={PAGE_VARIANTS}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
    </div>
  );
}
```

### shadcn/ui Initialization

```bash
cd apps/web
pnpx shadcn@latest init
pnpx shadcn@latest add button card dialog dropdown-menu input
pnpx shadcn@latest add command tooltip badge separator avatar
pnpx shadcn@latest add scroll-area resizable tabs skeleton
```

---

## Phase 10 — Authentication UI & Onboarding

### Objective
Build login, GitHub OAuth flow, organization creation wizard, and the repository connection + integration setup onboarding.

### Login Page with Animation

```typescript
// apps/web/src/app/auth/login/page.tsx
'use client';
import { motion } from 'framer-motion';
import { signIn } from '@/lib/auth-client';
import { Button } from '@repo/ui/button';
import { GitHubIcon } from '@repo/ui/icons';
import { STAGGER_CONTAINER, STAGGER_ITEM, SPRING } from '@repo/ui/motion';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-raised">
      {/* Animated background mesh */}
      <div className="absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -right-40 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(0.55 0.24 270 / 0.15), transparent)' }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full"
          style={{ background: 'radial-gradient(circle, oklch(0.65 0.2 200 / 0.12), transparent)' }}
          animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        />
      </div>

      <motion.div
        className="relative w-full max-w-sm space-y-8"
        variants={STAGGER_CONTAINER}
        initial="hidden"
        animate="visible"
      >
        <motion.div variants={STAGGER_ITEM} className="text-center">
          <h1 className="text-2xl font-semibold text-primary">AI Engineering Manager</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your codebase, finally understood.
          </p>
        </motion.div>

        <motion.div variants={STAGGER_ITEM}>
          <Button
            variant="outline"
            className="w-full h-11 gap-3 border-border-strong hover:bg-surface-overlay
                       transition-all duration-200 hover:shadow-md hover:-translate-y-px"
            onClick={() => signIn.social({ provider: 'github', callbackURL: '/app' })}
          >
            <GitHubIcon className="w-5 h-5" />
            Continue with GitHub
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
```

### Onboarding Wizard — Multi-step with Progress Animation

```typescript
// apps/web/src/app/onboarding/page.tsx
const STEPS = ['organization', 'repository', 'integrations', 'complete'];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-8">
      {/* Animated progress bar */}
      <div className="w-full max-w-lg mb-10">
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-brand-500 rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
          />
        </div>
        <div className="flex justify-between mt-2">
          {STEPS.map((s, i) => (
            <motion.span
              key={s}
              className={`text-xs ${i <= step ? 'text-brand-500' : 'text-muted-foreground'}`}
              animate={{ opacity: i <= step ? 1 : 0.4 }}
            >
              {s}
            </motion.span>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, x: -40, transition: { duration: 0.2 } }}
          className="w-full max-w-lg"
        >
          <StepComponent step={STEPS[step]} onNext={() => setStep(s => s + 1)} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
```

---

## Phase 11 — AI Chat Interface (Streaming)

### Objective
Build the primary user interface: a streaming chat with real-time token rendering, tool call visualization, retrieved context panel, and conversation history sidebar.

### Chat Page Layout

```
┌────────────────────────────────────────────┐
│  Sidebar (conversations)  │  Chat area     │
│  ─────────────────────── │  ─────────────  │
│  > Sprint Summary Chat    │  Messages       │
│    Blast Radius Analysis  │                 │
│    PR Risk Review         │  [Context tray] │
│                           │  ─────────────  │
│  + New conversation       │  [Input]        │
└────────────────────────────────────────────┘
```

### Streaming Message Component

```typescript
// apps/web/src/components/chat/streaming-message.tsx
'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { CodeBlock } from './code-block';

interface StreamingMessageProps {
  content:    string;
  isStreaming: boolean;
}

export function StreamingMessage({ content, isStreaming }: StreamingMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="prose prose-sm dark:prose-invert max-w-none"
    >
      <ReactMarkdown
        components={{
          code: ({ className, children }) => (
            <CodeBlock language={className?.replace('language-', '')} code={String(children)} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {/* Blinking cursor while streaming */}
      <AnimatePresence>
        {isStreaming && (
          <motion.span
            className="inline-block w-0.5 h-4 bg-brand-500 ml-0.5 align-middle"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.8, repeat: Infinity }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
```

### Tool Call Visualization (Phase 3 pipeline transparency)

```typescript
// apps/web/src/components/chat/tool-call-trace.tsx
export function ToolCallTrace({ calls }: { calls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="border border-border rounded-lg overflow-hidden text-xs my-2"
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 p-2.5 bg-surface-raised
                   hover:bg-surface-overlay transition-colors text-left"
      >
        <motion.span
          animate={{ rotate: expanded ? 90 : 0 }}
          transition={{ duration: 0.2 }}
        >
          ›
        </motion.span>
        <span className="text-muted-foreground">
          {calls.length} tool call{calls.length !== 1 ? 's' : ''} executed
        </span>
        <div className="flex gap-1 ml-auto">
          {calls.map((c, i) => (
            <span key={i} className="px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded text-[10px]">
              {c.name}
            </span>
          ))}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            {calls.map((call, i) => (
              <div key={i} className="p-2.5 border-t border-border font-mono">
                <div className="text-green-400">✓ {call.name}</div>
                <div className="text-muted-foreground mt-1 pl-2">
                  {JSON.stringify(call.result, null, 2).slice(0, 300)}...
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
```

### Chat Input with Send Animation

```typescript
// apps/web/src/components/chat/chat-input.tsx
export function ChatInput({ onSend, isLoading }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim()) { onSend(value.trim()); setValue(''); }
    }
  };

  return (
    <div className="relative flex items-end gap-2 p-3 border border-border rounded-xl
                    bg-surface focus-within:border-brand-500 focus-within:ring-1
                    focus-within:ring-brand-500/20 transition-all duration-200
                    shadow-sm focus-within:shadow-glow">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your codebase, sprint, or architecture..."
        rows={1}
        className="flex-1 resize-none bg-transparent outline-none text-sm
                   min-h-[24px] max-h-[160px] overflow-y-auto placeholder:text-muted-foreground"
        style={{ height: 'auto' }}
      />
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={isLoading ? { opacity: 0.5 } : { opacity: 1 }}
        onClick={() => { if (value.trim()) { onSend(value.trim()); setValue(''); } }}
        disabled={isLoading || !value.trim()}
        className="flex-shrink-0 w-8 h-8 rounded-lg bg-brand-500 text-white
                   flex items-center justify-center disabled:cursor-not-allowed
                   transition-colors hover:bg-brand-600"
      >
        {isLoading
          ? <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
          : <ArrowUpIcon className="w-4 h-4" />
        }
      </motion.button>
    </div>
  );
}
```

---

## Phase 12 — Architecture Map Visualization (The Killer Feature)

### Objective
Build the interactive AST dependency graph using React Flow, with animated edge traversal for blast radius analysis, node type color-coding, minimap, and real-time update animations on new commits.

### Custom Node Types for AST Entities (Next.js Client Components)

```typescript
// apps/web/src/app/(app)/map/components/nodes/function-node.tsx
import { Handle, Position } from '@xyflow/react';
import { motion } from 'framer-motion';

const NODE_COLORS = {
  file:        { bg: '#f1efee', border: '#5f5e5a', text: '#2c2c2a' },
  class:       { bg: '#e1f5ee', border: '#0f6e56', text: '#04342c' },
  function:    { bg: '#eeedfe', border: '#534ab7', text: '#26215c' },
  enum:        { bg: '#faeeda', border: '#854f0b', text: '#412402' },
  interface:   { bg: '#e6f1fb', border: '#185fa5', text: '#042c53' },
};

export function ASTNode({ data, selected }: NodeProps) {
  const colors = NODE_COLORS[data.nodeType] ?? NODE_COLORS.file;

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1,   opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`rounded-xl border px-3 py-2 min-w-[120px] max-w-[200px]
                  transition-shadow cursor-pointer select-none
                  ${selected ? 'shadow-[0_0_0_2px_#4f46e5]' : 'shadow-sm hover:shadow-md'}`}
      style={{
        background:   colors.bg,
        borderColor:  colors.border,
        borderWidth:  selected ? 2 : 0.5,
      }}
    >
      <div className="text-[10px] font-mono mb-0.5" style={{ color: colors.border }}>
        {data.nodeType}
      </div>
      <div className="text-xs font-medium truncate" style={{ color: colors.text }}>
        {data.name}
      </div>
      {data.complexity && (
        <div className="text-[9px] mt-1" style={{ color: colors.border }}>
          complexity: {data.complexity}
        </div>
      )}
      <Handle type="target" position={Position.Top}    className="!w-2 !h-2 !border-none" style={{ background: colors.border }} />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-none" style={{ background: colors.border }} />
    </motion.div>
  );
}
```

### Blast Radius Highlight Mode

```typescript
// apps/web/src/app/(app)/map/components/use-blast-radius.ts
export function useBlastRadius(nodes: Node[], edges: Edge[]) {
  const [blastOrigin, setBlastOrigin] = useState<string | null>(null);
  const [blastNodes,  setBlastNodes]  = useState<Set<string>>(new Set());

  const activateBlastRadius = useCallback(async (nodeId: string) => {
    setBlastOrigin(nodeId);
    const response = await fetch(`/api/v1/blast-radius?nodeId=${nodeId}`);
    const { affectedIds } = await response.json();
    setBlastNodes(new Set(affectedIds));
  }, []);

  // Apply visual dimming to non-affected nodes
  const styledNodes = useMemo(() => nodes.map(node => ({
    ...node,
    data: {
      ...node.data,
      dimmed:    blastOrigin !== null && !blastNodes.has(node.id) && node.id !== blastOrigin,
      highlight: blastNodes.has(node.id),
      isOrigin:  node.id === blastOrigin,
    },
  })), [nodes, blastOrigin, blastNodes]);

  return { styledNodes, activateBlastRadius, clearBlastRadius: () => setBlastOrigin(null) };
}
```

### Architecture Map Page

```typescript
// apps/web/src/app/(app)/map/page.tsx
'use client';
import { ReactFlow, MiniMap, Controls, Background, useNodesState, useEdgesState, ReactFlowProvider } from '@xyflow/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback, useMemo } from 'react';
import { ASTNode }       from './components/nodes/function-node';
import { useBlastRadius } from './components/use-blast-radius';
import { NodeDetailPanel } from './components/node-detail-panel';

const nodeTypes = {
  astNode: ASTNode,
};

export default function ArchitectureMapPage() {
  return (
    <ReactFlowProvider>
      <ArchitectureMapContent />
    </ReactFlowProvider>
  );
}

function ArchitectureMapContent() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const { styledNodes, activateBlastRadius, clearBlastRadius } = useBlastRadius(nodes, edges);

  return (
    <div className="w-full h-full relative bg-surface">
      <ReactFlow
        nodes={styledNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          setSelectedNode(node);
          activateBlastRadius(node.id);
        }}
        onPaneClick={clearBlastRadius}
        fitView
        className="bg-surface"
      >
        <Background color="var(--color-border)" gap={24} size={1} />
        <Controls className="[&>button]:bg-surface [&>button]:border-border" />
        <MiniMap
          className="bg-surface-raised border border-border rounded-lg overflow-hidden"
          nodeColor={n => NODE_COLORS[n.data?.nodeType]?.border ?? '#888'}
        />
      </ReactFlow>

      {/* Blast radius legend */}
      <AnimatePresence>
        {selectedNode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute top-4 left-4 bg-surface border border-border
                       rounded-xl p-3 shadow-lg text-xs"
          >
            <div className="font-medium mb-1">Blast radius active</div>
            <div className="text-muted-foreground">Highlighted nodes would be affected</div>
            <button onClick={clearBlastRadius} className="mt-2 text-brand-500 hover:underline">
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Node detail side panel */}
      <AnimatePresence>
        {selectedNode && (
          <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
```

---

## Phase 13 — Sprint Dashboard & Analytics

### Objective
Build the primary analytics views: sprint summary, PR risk radar, team activity timeline, and ticket-to-implementation mapping.

### Sprint Summary Dashboard

```typescript
// apps/web/src/app/(app)/dashboard/page.tsx
export default function DashboardPage() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="p-6 space-y-6 max-w-7xl mx-auto"
    >
      {/* Header with AI summarize button */}
      <motion.div variants={STAGGER_ITEM} className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sprint Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {currentSprint.name} · {daysRemaining} days remaining
          </p>
        </div>
        <Button onClick={triggerSprintSummary} className="gap-2">
          <SparklesIcon className="w-4 h-4" />
          AI Summarize Sprint
        </Button>
      </motion.div>

      {/* Metric cards with animated counters */}
      <motion.div variants={STAGGER_ITEM} className="grid grid-cols-4 gap-4">
        {METRICS.map(metric => (
          <MetricCard key={metric.id} {...metric} />
        ))}
      </motion.div>

      {/* PR Risk Radar */}
      <motion.div variants={STAGGER_ITEM} className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <PRRiskTable prs={riskyPRs} />
        </div>
        <div>
          <ActivityFeed events={recentEvents} />
        </div>
      </motion.div>
    </motion.div>
  );
}
```

### Animated Metric Card

```typescript
// apps/web/src/components/dashboard/metric-card.tsx
import { useMotionValue, useSpring, useTransform, motion } from 'framer-motion';
import { useEffect } from 'react';

export function MetricCard({ label, value, delta, unit, trend }: MetricCardProps) {
  const count = useMotionValue(0);
  const rounded = useTransform(count, v => Math.round(v));
  const spring = useSpring(count, { stiffness: 80, damping: 20 });

  useEffect(() => { spring.set(value); }, [value]);

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: '0 8px 24px oklch(0 0 0 / 0.08)' }}
      transition={{ duration: 0.2 }}
      className="bg-surface border border-border rounded-xl p-4 cursor-default"
    >
      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-3">
        {label}
      </div>
      <div className="flex items-end justify-between">
        <div className="text-2xl font-semibold tabular-nums">
          <motion.span>{rounded}</motion.span>
          {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </div>
        {delta !== undefined && (
          <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium
            ${delta >= 0
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}>
            {delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
    </motion.div>
  );
}
```

---

## Phase 14 — Animations, Micro-interactions & Modern UI Polish

### Objective
Layer Framer Motion page transitions, layout animations, skeleton loading states, hover micro-interactions, and dark mode transitions across the full UI.

### Global Page Transition Wrapper

```typescript
// apps/web/src/components/page-transition.tsx
'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0,  filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -6,   filter: 'blur(2px)' }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

### Skeleton Loading States

```typescript
// packages/ui/src/components/skeleton.tsx
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-surface-overlay',
        'before:absolute before:inset-0 before:-translate-x-full',
        'before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent',
        'before:animate-[shimmer_1.4s_infinite]',
        className
      )}
    />
  );
}

// Shimmer keyframe in globals.css
// @keyframes shimmer { to { transform: translateX(100%); } }
```

### Skeleton for Chat History

```typescript
export function ChatHistorySkeleton() {
  return (
    <motion.div
      variants={STAGGER_CONTAINER}
      initial="hidden"
      animate="visible"
      className="space-y-4 p-4"
    >
      {[80, 60, 90, 50, 75].map((w, i) => (
        <motion.div key={i} variants={STAGGER_ITEM} className="flex gap-3">
          <Skeleton className="w-7 h-7 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className={`h-3.5`} style={{ width: `${w}%` }} />
            <Skeleton className="h-3.5" style={{ width: `${w * 0.7}%` }} />
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
```

### Shared Hover Lift Utility Component

```typescript
// packages/ui/src/components/hover-lift.tsx
import { motion } from 'framer-motion';
import { ReactNode } from 'react';

export function HoverLift({
  children,
  intensity = 'md',
  className,
}: {
  children: ReactNode;
  intensity?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const lifts = { sm: -1, md: -2, lg: -4 };
  const shadows = {
    sm: '0 4px 12px oklch(0 0 0 / 0.06)',
    md: '0 8px 24px oklch(0 0 0 / 0.08)',
    lg: '0 16px 40px oklch(0 0 0 / 0.12)',
  };

  return (
    <motion.div
      whileHover={{ y: lifts[intensity], boxShadow: shadows[intensity] }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
```

### Sidebar with Smooth Collapse

```typescript
// apps/web/src/components/sidebar.tsx
const SIDEBAR_WIDTH = 256;

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <motion.aside
      animate={{ width: collapsed ? 64 : SIDEBAR_WIDTH }}
      transition={{ type: 'spring', stiffness: 350, damping: 35 }}
      className="flex flex-col h-full border-r border-border bg-surface-raised overflow-hidden"
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="text-sm font-semibold truncate"
            >
              AI Eng Manager
            </motion.span>
          )}
        </AnimatePresence>
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => setCollapsed(c => !c)}
          className="w-7 h-7 flex items-center justify-center rounded-lg
                     hover:bg-surface-overlay transition-colors"
        >
          <motion.span animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.25 }}>
            ‹
          </motion.span>
        </motion.button>
      </div>

      {/* Navigation items */}
      <nav className="flex-1 p-2 space-y-1">
        {NAV_ITEMS.map(item => (
          <NavItem key={item.id} item={item} collapsed={collapsed} />
        ))}
      </nav>
    </motion.aside>
  );
}
```

### Graph Node Entrance Animation (Architecture Map)

```typescript
// Applied in useLayoutEffect after React Flow loads nodes
useLayoutEffect(() => {
  if (!rfInstance) return;
  const nodes = rfInstance.getNodes();

  // Stagger node entrance by depth level
  nodes.forEach((node, i) => {
    const depth = node.data.depth ?? 0;
    setTimeout(() => {
      rfInstance.setNodes(prev => prev.map(n =>
        n.id === node.id ? { ...n, data: { ...n.data, visible: true } } : n
      ));
    }, depth * 80 + i * 20);
  });
}, [rfInstance, nodes.length]);
```

### Command Palette (⌘K) with Framer Presence

```typescript
// apps/web/src/components/command-palette.tsx
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useHotkeys('meta+k', () => setOpen(true));

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/40 z-50"
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-xl z-50"
          >
            <Command className="rounded-2xl border border-border shadow-2xl bg-surface">
              <CommandInput placeholder="Search repos, ask a question, navigate..." />
              <CommandList>
                <CommandGroup heading="Quick actions">
                  <CommandItem onSelect={() => router.push('/app/chat')}>
                    <SparklesIcon /> New AI conversation
                  </CommandItem>
                  <CommandItem onSelect={() => router.push('/app/map')}>
                    <MapIcon /> Open Architecture Map
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
```

---

## Phase 15 — Production Hardening & Performance

### Objective
Error boundaries, OpenTelemetry tracing, Sentry integration, performance optimization (React Server Components, streaming SSR, edge caching), load testing, and security hardening.

### OpenTelemetry Setup

```typescript
// apps/web/src/lib/telemetry.ts
import { registerOTel } from '@vercel/otel';
import { trace, SpanStatusCode } from '@opentelemetry/api';

export function register() {
  registerOTel({ serviceName: 'ai-eng-manager-web' });
}

// Wrap Mastra workflow calls with spans
export async function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('ai-eng-manager');
  return tracer.startActiveSpan(name, async (span) => {
    try {
      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

### Error Boundary with Animated Fallback

```typescript
// apps/web/src/components/error-boundary.tsx
'use client';
import { Component } from 'react';
import { motion } from 'framer-motion';

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }

  render() {
    if (this.state.error) {
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center h-full p-8 text-center"
        >
          <div className="text-4xl mb-4">⚠</div>
          <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
          <p className="text-sm text-muted-foreground mb-4">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm
                       hover:bg-brand-600 transition-colors"
          >
            Try again
          </button>
        </motion.div>
      );
    }
    return this.props.children;
  }
}
```

### Next.js 15 Performance Optimizations

```typescript
// apps/web/next.config.ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  experimental: {
    ppr:              true,   // Partial Pre-rendering — stream shell instantly
    reactCompiler:    true,   // Auto-memoization
    useCache:         true,   // Granular caching with 'use cache' directive
    inlineCss:        true,   // Eliminate CSS render-blocking
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
};

export default config;
```

### Load Testing Config (k6)

```javascript
// scripts/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    chat_load: {
      executor:        'ramping-vus',
      startVUs:        0,
      stages: [
        { duration: '2m', target: 50 },   // ramp up
        { duration: '5m', target: 50 },   // sustain
        { duration: '2m', target: 0 },    // ramp down
      ],
    },
    ingestion_spike: {
      executor: 'constant-arrival-rate',
      rate:     20,                        // 20 webhook events/second
      duration: '3m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000'],     // 95% of chat requests < 2s to first token
    http_req_failed:   ['rate<0.01'],      // <1% error rate
  },
};
```

---

## Phase Dependency Map

```
Phase 1  (Monorepo)
  └→ Phase 2  (DB Schema)
       └→ Phase 3  (Auth)
            └→ Phase 4  (AST Ingestion)
            |    └→ Phase 5  (BullMQ + Kafka)
            |         └→ Phase 6  (External Integrations)
            |              └→ Phase 7  (AI Orchestration)
            |                   └→ Phase 8  (Backend API)
            └→ Phase 9  (Frontend Foundation)
                 ├→ Phase 10 (Auth UI + Onboarding)
                 ├→ Phase 11 (AI Chat Interface)  ← requires Phase 8
                 ├→ Phase 12 (Architecture Map)   ← requires Phase 4, Phase 8
                 ├→ Phase 13 (Dashboard)          ← requires Phase 7, Phase 8
                 └→ Phase 14 (Animations & Polish)
                      └→ Phase 15 (Production Hardening)
```

---

## Key Library Versions

| Package | Version |
|---|---|
| Next.js | 15.x |
| React | 19.x |
| Vite | 6.x |
| TanStack Router | 1.x |
| Framer Motion | 11.x |
| Tailwind CSS | 4.x |
| shadcn/ui | latest |
| Better Auth | 1.x |
| Drizzle ORM | 0.38.x |
| Mastra | 0.x (latest) |
| Agentica | latest |
| BullMQ | 5.x |
| @confluentinc/kafka-javascript | 1.x |
| Tree-sitter | 0.22.x |
| React Flow (@xyflow/react) | 12.x |
| uuid (v5) | 10.x |
| @ai-sdk/anthropic | latest |

---

*Generated from PRD discussion — AI Engineering Manager v1.0*