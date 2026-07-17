import { Worker } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { redis } from '../redis.js';
import { Queues, flowProducer, type RepoIngestionJob } from '../queues.js';

/**
 * Parent ingestion worker. Implements the full fan-out / fan-in sequence:
 *  1. fan out a `parse-file` child per changed (non-deleted) file
 *  2. (after children) collect staged node/edge batches from Redis
 *  3. PRE-DELETE inbound capture (collateral files) — BEFORE any mutation
 *  4. bulk UPSERT nodes (ON CONFLICT preserves deterministic UUID)
 *  5. bulk UPSERT edges
 *  6. stale-node sweep (CASCADE cleans orphan edges)
 *  7. post-commit: dispatch collateral re-parse + embedding backfill
 *  8. cleanup Redis staging keys
 */
export const repoIngestionWorker = new Worker(
  'repo-ingestion',
  async (job) => {
    if (job.name !== 'incremental-ingest' && job.name !== 'initial-ingest') return; // cron jobs handled elsewhere

    const { repoId, orgId, commitHash, changedFiles, runId } = job.data as RepoIngestionJob;
    const changedPaths = changedFiles.map((f) => f.path);
    const parseablePaths = changedFiles.filter((f) => f.status !== 'deleted').map((f) => f.path);

    // 1. Fan out file-parse children. BullMQ resumes the parent only once all complete.
    await flowProducer.add({
      name: 'ingest-repo',
      queueName: 'repo-ingestion',
      data: job.data,
      children: parseablePaths.map((filePath) => ({
        name: 'parse-file',
        queueName: 'file-parsing',
        data: { repoId, orgId, commitHash, filePath, depth: 0 },
      })),
    });

    // 2. Collect staged results from Redis.
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

    let collateralPaths: string[] = [];

    await db.transaction(async (trx) => {
      // 3. PRE-DELETE INBOUND CAPTURE — find files that reference the changed entities.
      const collateral = await trx.execute(sql`
        SELECT DISTINCT n_caller.file_path AS collateral_file
        FROM ast_nodes n_target
        JOIN ast_edges e        ON e.to_node = n_target.id
                                AND e.edge_type IN ('CALLS','USAGE','IMPORTS','IMPLEMENTS')
        JOIN ast_nodes n_caller ON n_caller.id = e.from_node
                                AND n_caller.org_id = ${orgId}
        WHERE n_target.org_id = ${orgId}
          AND n_target.repo_id = ${repoId}
          AND n_target.commit_hash != ${commitHash}
          AND n_target.file_path = ANY(${changedPaths}::text[])
          AND n_caller.file_path != ALL(${changedPaths}::text[])
      `);

      // 4. BULK UPSERT nodes.
      if (allNodes.length > 0) {
        await trx.execute(sql`
          INSERT INTO ast_nodes
            (id, org_id, repo_id, commit_hash, node_type, name, qualified_name,
             file_path, line_start, line_end, signature, return_type, complexity, metadata)
          SELECT * FROM UNNEST(
            ${allNodes.map((n) => n.id)}::uuid[],
            ${allNodes.map((n) => n.orgId)}::uuid[],
            ${allNodes.map((n) => n.repoId)}::uuid[],
            ${allNodes.map((n) => n.commitHash)}::text[],
            ${allNodes.map((n) => n.nodeType)}::text[],
            ${allNodes.map((n) => n.name)}::text[],
            ${allNodes.map((n) => n.qualifiedName)}::text[],
            ${allNodes.map((n) => n.filePath)}::text[],
            ${allNodes.map((n) => n.lineStart ?? null)}::int[],
            ${allNodes.map((n) => n.lineEnd ?? null)}::int[],
            ${allNodes.map((n) => n.signature ?? null)}::text[],
            ${allNodes.map((n) => n.returnType ?? null)}::text[],
            ${allNodes.map((n) => n.complexity ?? null)}::int[],
            ${allNodes.map((n) => JSON.stringify(n.metadata ?? {}))}::jsonb[]
          ) AS t(id,org_id,repo_id,commit_hash,node_type,name,qualified_name,
                 file_path,line_start,line_end,signature,return_type,complexity,metadata)
          ON CONFLICT (org_id, repo_id, qualified_name) DO UPDATE SET
            commit_hash = EXCLUDED.commit_hash,
            line_start  = EXCLUDED.line_start,
            line_end    = EXCLUDED.line_end,
            signature   = EXCLUDED.signature,
            complexity  = EXCLUDED.complexity,
            metadata    = EXCLUDED.metadata,
            updated_at  = NOW()
        `);
      }

      // 5. BULK UPSERT edges.
      if (allEdges.length > 0) {
        await trx.execute(sql`
          INSERT INTO ast_edges (org_id, repo_id, from_node, to_node, edge_type)
          SELECT * FROM UNNEST(
            ${allEdges.map((e) => e.orgId)}::uuid[],
            ${allEdges.map((e) => e.repoId)}::uuid[],
            ${allEdges.map((e) => e.fromNode)}::uuid[],
            ${allEdges.map((e) => e.toNode)}::uuid[],
            ${allEdges.map((e) => e.edgeType)}::text[]
          ) AS t(org_id, repo_id, from_node, to_node, edge_type)
          ON CONFLICT (org_id, from_node, to_node, edge_type) DO NOTHING
        `);
      }

      // 6. STALE NODE SWEEP — CASCADE removes orphaned edges automatically.
      await trx.execute(sql`
        DELETE FROM ast_nodes
        WHERE repo_id = ${repoId}
          AND commit_hash != ${commitHash}
          AND file_path = ANY(${changedPaths}::text[])
      `);

      collateralPaths = (collateral as unknown as Array<{ collateral_file: string }>)
        .map((r) => r.collateral_file)
        .filter((p) => !changedPaths.includes(p));

      // 7. Update ingestion run record (still inside the txn).
      await trx.execute(sql`
        UPDATE ingestion_runs
        SET status = 'complete',
            nodes_upserted = ${allNodes.length},
            edges_upserted = ${allEdges.length},
            collateral_files = ${collateralPaths.length},
            completed_at = NOW(),
            duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000
        WHERE id = ${runId}
      `);
    });

    // 7b. POST-COMMIT background dispatch.
    if (collateralPaths.length > 0) {
      await Queues.collateralParse.addBulk(
        collateralPaths.map((filePath) => ({
          name: 'parse-file',
          data: { repoId, orgId, commitHash, filePath, depth: 1 },
        })),
      );
    }
    const newNodeIds = allNodes.map((n) => n.id);
    for (let i = 0; i < newNodeIds.length; i += 50) {
      await Queues.embedNodes.add('embed-batch', { orgId, nodeIds: newNodeIds.slice(i, i + 50) });
    }

    // 8. Cleanup Redis staging keys.
    if (stagedKeys.length > 0) await redis.del(...stagedKeys);

    // Publish progress for the WebSocket layer.
    await redis.publish(
      'ingestion:progress',
      JSON.stringify({ orgId, repoId, runId, nodesProcessed: allNodes.length, status: 'complete' }),
    );
  },
  { connection: redis, concurrency: 5 },
);
