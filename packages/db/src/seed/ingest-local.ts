/**
 * Local ingestion: parse this monorepo's own TypeScript into a real AST graph
 * and write it to Postgres. Demonstrates the Codebase Archaeologist pipeline
 * end-to-end (parse → nodes/edges → upsert) without needing Kafka/BullMQ.
 *
 * Two passes:
 *   1. extract declarations (file/class/interface/function/method/enum) per file
 *   2. derive cross-file edges (CALLS / IMPLEMENTS / USAGE) by scanning each
 *      file's text for references to entities defined elsewhere
 *
 * Run: pnpm --filter @repo/db seed
 */
import postgres from 'postgres';
import { randomUUID, createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://aiem:aiem@localhost:55432/aiem';
const ROOT = join(process.cwd(), '..', '..'); // repo root from packages/db
const TARGET_DIRS = ['apps/web/src', 'packages/db/src', 'packages/ast-parser/src', 'packages/queue/src', 'packages/mastra-agents/src', 'packages/integrations/src'];
const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo']);

type NodeType = 'file' | 'class' | 'interface' | 'function' | 'method' | 'enum';
interface Decl { id: string; nodeType: NodeType; name: string; qn: string; filePath: string; line: number; complexity: number }

const DECL_PATTERNS: Array<[RegExp, NodeType]> = [
  [/^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/, 'class'],
  [/^\s*export\s+interface\s+([A-Za-z0-9_]+)/, 'interface'],
  [/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/, 'function'],
  [/^\s*export\s+enum\s+([A-Za-z0-9_]+)/, 'enum'],
  [/^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/, 'function'],
  [/^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*:\s*[A-Za-z0-9_<>.]+\s*=\s*(?:async\s*)?\(/, 'function'],
  // PascalCase exported consts (React components, e.g. `export const Button = forwardRef(...)`)
  [/^\s*export\s+const\s+([A-Z][A-Za-z0-9_]+)\s*=/, 'function'],
];

// Ultra-common identifiers that produce noisy cross-file edges.
const USAGE_DENYLIST = new Set(['next', 'link', 'type', 'props', 'data', 'value', 'name', 'index', 'config', 'main', 'POST', 'GET']);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.has(e)) continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e) && !e.endsWith('.d.ts')) out.push(full);
  }
}

function complexity(code: string): number {
  return 1 + (code.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g)?.length ?? 0);
}

async function main() {
  const sql = postgres(DATABASE_URL, { max: 4, prepare: false });

  // 1. org + repo
  const slug = 'acme-engineering';
  const [org] = await sql<{ id: string }[]>`
    INSERT INTO organizations (name, slug) VALUES ('Acme Engineering', ${slug})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
  const orgId = org!.id;

  const fullName = 'local/ai-eng-manager';
  const commit = createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 7);
  // Find-or-create by (org_id, full_name) so re-ingestion reuses the same repo.
  const existing = await sql<{ id: string }[]>`SELECT id FROM repositories WHERE org_id = ${orgId} AND full_name = ${fullName} LIMIT 1`;
  const repoId =
    existing[0]?.id ??
    (
      await sql<{ id: string }[]>`
        INSERT INTO repositories (org_id, name, full_name, default_branch, index_status, last_indexed_commit)
        VALUES (${orgId}, 'ai-eng-manager', ${fullName}, 'main', 'indexing', ${commit}) RETURNING id`
    )[0]!.id;

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO ingestion_runs (repo_id, commit_hash, trigger, status) VALUES (${repoId}, ${commit}, 'initial', 'running') RETURNING id`;
  const runId = run!.id;

  // Clean previous graph for idempotent re-ingest.
  await sql`DELETE FROM ast_edges WHERE repo_id = ${repoId}`;
  await sql`DELETE FROM ast_nodes WHERE repo_id = ${repoId}`;

  // 2. PASS 1 — declarations
  const files: string[] = [];
  for (const d of TARGET_DIRS) walk(join(ROOT, d), files);

  const decls: Decl[] = [];
  const fileDecl = new Map<string, Decl>(); // filePath -> file node
  const fileText = new Map<string, string>();
  const nameToIds = new Map<string, string[]>();
  const seenQn = new Set<string>(); // dedupe qualified_name collisions within a repo

  for (const abs of files) {
    const filePath = relative(ROOT, abs).split(sep).join('/');
    const content = readFileSync(abs, 'utf-8');
    fileText.set(filePath, content);
    const lines = content.split('\n');

    const fileNode: Decl = { id: randomUUID(), nodeType: 'file', name: filePath.split('/').pop()!, qn: filePath, filePath, line: 1, complexity: 1 };
    decls.push(fileNode);
    fileDecl.set(filePath, fileNode);

    lines.forEach((line, i) => {
      for (const [re, type] of DECL_PATTERNS) {
        const m = re.exec(line);
        if (m?.[1]) {
          const qn = `${filePath}::${m[1]}`;
          if (!seenQn.has(qn)) {
            seenQn.add(qn);
            const id = randomUUID();
            decls.push({ id, nodeType: type, name: m[1], qn, filePath, line: i + 1, complexity: complexity(line) });
            (nameToIds.get(m[1]) ?? nameToIds.set(m[1], []).get(m[1])!).push(id);
          }
          break;
        }
      }
    });
  }

  // CONTAINS edges (file -> entity)
  const edges: Array<{ from: string; to: string; type: string }> = [];
  for (const d of decls) {
    if (d.nodeType === 'file') continue;
    const f = fileDecl.get(d.filePath);
    if (f) edges.push({ from: f.id, to: d.id, type: 'CONTAINS' });
  }

  // 3. PASS 2 — cross-file usage edges (file -> entity defined elsewhere)
  const entityIndex = decls.filter((d) => d.nodeType !== 'file' && d.name.length >= 4 && !USAGE_DENYLIST.has(d.name));
  for (const [filePath, text] of fileText) {
    const f = fileDecl.get(filePath)!;
    const seen = new Set<string>();
    for (const e of entityIndex) {
      if (e.filePath === filePath) continue; // defined here → CONTAINS already
      if (seen.has(e.id)) continue;
      const isCall = new RegExp(`\\b${e.name}\\s*[(<]`).test(text) || new RegExp(`new\\s+${e.name}\\b`).test(text);
      const isImpl = new RegExp(`(implements|extends)\\s+[^\\n]*\\b${e.name}\\b`).test(text);
      const isPascal = /^[A-Z]/.test(e.name);
      // Only link when it's a real call/impl, or a PascalCase type referenced by word.
      if (!isCall && !isImpl && !(isPascal && new RegExp(`\\b${e.name}\\b`).test(text))) continue;
      const type = isImpl ? 'IMPLEMENTS' : isCall ? 'CALLS' : 'USAGE';
      edges.push({ from: f.id, to: e.id, type });
      seen.add(e.id);
    }
  }

  // 4. bulk insert
  const nodeRows = decls.map((d) => ({
    id: d.id, org_id: orgId, repo_id: repoId, commit_hash: commit,
    node_type: d.nodeType, name: d.name, qualified_name: d.qn, file_path: d.filePath,
    line_start: d.line, line_end: d.line, complexity: d.complexity,
  }));
  for (let i = 0; i < nodeRows.length; i += 500) {
    await sql`INSERT INTO ast_nodes ${sql(nodeRows.slice(i, i + 500), 'id', 'org_id', 'repo_id', 'commit_hash', 'node_type', 'name', 'qualified_name', 'file_path', 'line_start', 'line_end', 'complexity')}`;
  }

  // dedupe edges on (from,to,type)
  const seenEdge = new Set<string>();
  const edgeRows = edges
    .filter((e) => {
      const k = `${e.from}|${e.to}|${e.type}`;
      if (seenEdge.has(k)) return false;
      seenEdge.add(k);
      return true;
    })
    .map((e) => ({ id: randomUUID(), org_id: orgId, repo_id: repoId, from_node: e.from, to_node: e.to, edge_type: e.type }));
  for (let i = 0; i < edgeRows.length; i += 500) {
    await sql`INSERT INTO ast_edges ${sql(edgeRows.slice(i, i + 500), 'id', 'org_id', 'repo_id', 'from_node', 'to_node', 'edge_type')}`;
  }

  await sql`UPDATE repositories SET index_status = 'ready', updated_at = NOW() WHERE id = ${repoId}`;
  await sql`UPDATE ingestion_runs SET status = 'complete', files_parsed = ${files.length}, nodes_upserted = ${nodeRows.length}, edges_upserted = ${edgeRows.length}, completed_at = NOW() WHERE id = ${runId}`;

  console.log(`[seed] repo=${fullName} files=${files.length} nodes=${nodeRows.length} edges=${edgeRows.length} commit=${commit}`);
  await sql.end();
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});
