import 'server-only';
import { sql } from './db';
import { parseProject } from './parse';
import {
  resolveRepo,
  getSourceFiles,
  getHeadSha,
  getFileContent,
  type AuthorizedRepo,
} from './github';

export interface IngestResult {
  repoId: string;
  fullName: string;
  files: number;
  nodes: number;
  edges: number;
  commit: string;
}

/** Concurrency-limited file fetch. */
async function fetchAll(r: AuthorizedRepo, paths: string[], ref: string, concurrency = 12): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  let i = 0;
  async function worker() {
    while (i < paths.length) {
      const idx = i++;
      const path = paths[idx]!;
      const content = await getFileContent(r, path, ref).catch(() => null);
      if (content) out.push({ path, content });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return out;
}

/**
 * Pull a repository from GitHub, parse it, and (re)build its AST graph in
 * Postgres. Idempotent per repo (clears the previous graph for that repo).
 */
export async function ingestRepo(fullName: string, orgId: string): Promise<IngestResult> {
  if (!sql) throw new Error('database not configured');
  const r = await resolveRepo(fullName);
  if (!r) throw new Error(`repository "${fullName}" is not accessible to the GitHub App installation`);

  const commit = (await getHeadSha(r, r.defaultBranch)).slice(0, 40);

  // find-or-create repo row, mark indexing
  const existing = await sql<{ id: string }[]>`SELECT id FROM repositories WHERE org_id = ${orgId} AND full_name = ${r.fullName} LIMIT 1`;
  const repoId =
    existing[0]?.id ??
    (
      await sql<{ id: string }[]>`
        INSERT INTO repositories (org_id, github_repo_id, name, full_name, default_branch, index_status, last_indexed_commit)
        VALUES (${orgId}, ${r.githubRepoId}, ${r.repo}, ${r.fullName}, ${r.defaultBranch}, 'indexing', ${commit.slice(0, 7)}) RETURNING id`
    )[0]!.id;
  await sql`UPDATE repositories SET index_status = 'indexing', github_repo_id = ${r.githubRepoId}, updated_at = NOW() WHERE id = ${repoId}`;

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO ingestion_runs (repo_id, commit_hash, trigger, status) VALUES (${repoId}, ${commit.slice(0, 7)}, 'manual', 'running') RETURNING id`;
  const runId = run!.id;

  try {
    const paths = await getSourceFiles(r, r.defaultBranch);
    const files = await fetchAll(r, paths, r.defaultBranch);
    const { nodes, edges } = parseProject(files);

    await sql.begin(async (tx) => {
      await tx`DELETE FROM ast_edges WHERE repo_id = ${repoId}`;
      await tx`DELETE FROM ast_nodes WHERE repo_id = ${repoId}`;

      const nodeRows = nodes.map((n) => ({
        id: n.id, org_id: orgId, repo_id: repoId, commit_hash: commit.slice(0, 7),
        node_type: n.nodeType, name: n.name, qualified_name: n.qn, file_path: n.filePath,
        line_start: n.line, line_end: n.line, complexity: n.complexity,
      }));
      for (let i = 0; i < nodeRows.length; i += 500) {
        await tx`INSERT INTO ast_nodes ${tx(nodeRows.slice(i, i + 500), 'id', 'org_id', 'repo_id', 'commit_hash', 'node_type', 'name', 'qualified_name', 'file_path', 'line_start', 'line_end', 'complexity')}`;
      }
      const edgeRows = edges.map((e) => ({ id: e.id, org_id: orgId, repo_id: repoId, from_node: e.from, to_node: e.to, edge_type: e.type }));
      for (let i = 0; i < edgeRows.length; i += 500) {
        await tx`INSERT INTO ast_edges ${tx(edgeRows.slice(i, i + 500), 'id', 'org_id', 'repo_id', 'from_node', 'to_node', 'edge_type')}`;
      }
    });

    await sql`UPDATE repositories SET index_status = 'ready', last_indexed_commit = ${commit.slice(0, 7)}, updated_at = NOW() WHERE id = ${repoId}`;
    await sql`UPDATE ingestion_runs SET status = 'complete', files_parsed = ${files.length}, nodes_upserted = ${nodes.length}, edges_upserted = ${edges.length}, completed_at = NOW() WHERE id = ${runId}`;

    return { repoId, fullName: r.fullName, files: files.length, nodes: nodes.length, edges: edges.length, commit: commit.slice(0, 7) };
  } catch (err) {
    await sql`UPDATE repositories SET index_status = 'error', updated_at = NOW() WHERE id = ${repoId}`;
    await sql`UPDATE ingestion_runs SET status = 'failed', error = ${err instanceof Error ? err.message : 'ingest failed'}, completed_at = NOW() WHERE id = ${runId}`;
    throw err;
  }
}
