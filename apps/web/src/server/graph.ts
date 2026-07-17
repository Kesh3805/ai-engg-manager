import 'server-only';
import { sql } from './db';

const MAX_NODES = 220;

export interface GraphNode {
  id: string;
  nodeType: 'class' | 'function' | 'method' | 'interface' | 'file';
  name: string;
  filePath: string;
  qualifiedName: string;
  lineStart?: number;
  lineEnd?: number;
  complexity?: number;
  signature?: string;
  position: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  edgeType: 'CALLS' | 'USAGE' | 'IMPLEMENTS' | 'CONTAINS';
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  source: 'db';
  repo?: { id: string; fullName: string };
}

/** Resolve the repo to visualise: most recently updated indexed repo. */
async function activeRepo(): Promise<{ id: string; full_name: string } | null> {
  const rows = await sql<{ id: string; full_name: string }[]>`
    SELECT id, full_name FROM repositories
    ORDER BY (index_status = 'ready') DESC, updated_at DESC
    LIMIT 1`;
  return rows[0] ?? null;
}

/** Deterministic columnar layout: one column per file, entities stacked below. */
function layout(nodes: Omit<GraphNode, 'position'>[]): GraphNode[] {
  const fileOrder: string[] = [];
  const byFile = new Map<string, Omit<GraphNode, 'position'>[]>();
  for (const n of nodes) {
    if (!byFile.has(n.filePath)) {
      byFile.set(n.filePath, []);
      fileOrder.push(n.filePath);
    }
    byFile.get(n.filePath)!.push(n);
  }
  const COLS = Math.max(1, Math.ceil(Math.sqrt(fileOrder.length)));
  const COL_W = 320;
  const ROW_H = 92;
  const GROUP_GAP = 1; // extra row between files in a column

  const colHeights = new Array<number>(COLS).fill(0);
  const out: GraphNode[] = [];
  fileOrder.forEach((file, fi) => {
    const col = fi % COLS;
    const group = byFile.get(file)!;
    // file node first, then others sorted by line
    group.sort((a, b) => (a.nodeType === 'file' ? -1 : b.nodeType === 'file' ? 1 : (a.lineStart ?? 0) - (b.lineStart ?? 0)));
    group.forEach((n, gi) => {
      out.push({ ...n, position: { x: col * COL_W, y: (colHeights[col]! + gi) * ROW_H } });
    });
    colHeights[col]! += group.length + GROUP_GAP;
  });
  return out;
}

export async function getGraph(): Promise<GraphPayload> {
  try {
    const repo = await activeRepo();
    if (!repo) return { nodes: [], edges: [], source: 'db' };

    const rawNodes = await sql<Array<Omit<GraphNode, 'position'>>>`
      SELECT id, node_type AS "nodeType", name, file_path AS "filePath",
             qualified_name AS "qualifiedName", line_start AS "lineStart",
             line_end AS "lineEnd", complexity, signature
      FROM ast_nodes WHERE repo_id = ${repo.id}
      ORDER BY file_path, line_start NULLS FIRST
      LIMIT ${MAX_NODES}`;

    if (rawNodes.length === 0) return { nodes: [], edges: [], source: 'db' };

    const ids = rawNodes.map((n) => n.id);
    const rawEdges = await sql<GraphEdge[]>`
      SELECT id::text, from_node AS source, to_node AS target, edge_type AS "edgeType"
      FROM ast_edges
      WHERE repo_id = ${repo.id} AND from_node = ANY(${ids}) AND to_node = ANY(${ids})`;

    return {
      nodes: layout(rawNodes),
      edges: rawEdges,
      source: 'db',
      repo: { id: repo.id, fullName: repo.full_name },
    };
  } catch {
    return { nodes: [], edges: [], source: 'db' };
  }
}

export async function getBlastRadius(nodeId: string): Promise<{ affectedIds: string[]; depthOf: Record<string, number> }> {
  try {
    const rows = await sql<Array<{ id: string; depth: number }>>`
      WITH RECURSIVE blast AS (
        SELECT n.id, 0 AS depth, ARRAY[n.id] AS visited
        FROM ast_nodes n WHERE n.id = ${nodeId}
        UNION ALL
        SELECT n.id, b.depth + 1, b.visited || n.id
        FROM blast b
        JOIN ast_edges e ON e.to_node = b.id AND e.edge_type IN ('CALLS','USAGE','IMPLEMENTS')
        JOIN ast_nodes n ON n.id = e.from_node
        WHERE b.depth < 8 AND NOT (n.id = ANY(b.visited))
      )
      SELECT DISTINCT id::text, MIN(depth) AS depth FROM blast WHERE depth > 0 GROUP BY id`;
    const depthOf: Record<string, number> = {};
    for (const r of rows) depthOf[r.id] = Number(r.depth);
    return { affectedIds: rows.map((r) => r.id), depthOf };
  } catch {
    return { affectedIds: [], depthOf: {} };
  }
}
