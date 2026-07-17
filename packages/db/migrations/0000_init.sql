-- Extensions ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- NOTE: ast_nodes / ast_edges are PARTITION BY HASH (org_id) in production.
-- drizzle-kit generates the column shape; the partitioning + HNSW indexes below
-- are applied as a follow-up because drizzle cannot express them.

-- HNSW vector index for semantic node recall.
CREATE INDEX IF NOT EXISTS idx_ast_nodes_embedding
  ON ast_nodes USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_observations_embedding
  ON observations USING hnsw (embedding vector_cosine_ops);

-- Trigram index for fuzzy entity-name lookups used by the chat retrieval phase.
CREATE INDEX IF NOT EXISTS idx_ast_nodes_name_trgm
  ON ast_nodes USING gin (name gin_trgm_ops);
