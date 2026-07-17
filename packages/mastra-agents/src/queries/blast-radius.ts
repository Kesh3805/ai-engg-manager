import { sql } from 'drizzle-orm';
import { db } from '@repo/db';

/**
 * Recursive-CTE blast radius: from a named entity, walk inbound CALLS/USAGE/
 * IMPLEMENTS edges to find every node that would be affected by a change, up to
 * `maxDepth`. Cycle-safe via the `visited` array.
 */
export async function blastRadiusCTE(
  orgId: string,
  repoId: string,
  entityName: string,
  maxDepth = 8,
) {
  const result = await db.execute(sql`
    WITH RECURSIVE blast_radius AS (
      SELECT n.id, n.name, n.node_type, n.file_path, n.line_start,
             0 AS depth, ARRAY[n.id] AS visited, ARRAY[n.name] AS path
      FROM ast_nodes n
      WHERE n.org_id = ${orgId}
        AND n.repo_id = ${repoId}
        AND n.name = ${entityName}

      UNION ALL

      SELECT n.id, n.name, n.node_type, n.file_path, n.line_start,
             br.depth + 1, br.visited || n.id, br.path || n.name
      FROM blast_radius br
      JOIN ast_edges e ON e.to_node = br.id
                      AND e.edge_type IN ('CALLS','USAGE','IMPLEMENTS')
                      AND e.org_id = ${orgId}
      JOIN ast_nodes n ON n.id = e.from_node
                      AND n.org_id = ${orgId}
      WHERE br.depth < ${maxDepth}
        AND NOT (n.id = ANY(br.visited))
    )
    SELECT DISTINCT id, name, node_type, file_path, line_start, depth, path
    FROM blast_radius
    WHERE depth > 0
    ORDER BY depth, node_type, name
  `);
  return (result as any).rows ?? result;
}

/** Forward dependency walk (what an entity depends on). */
export async function dependencyCTE(orgId: string, repoId: string, entityName: string, maxDepth = 6) {
  const result = await db.execute(sql`
    WITH RECURSIVE deps AS (
      SELECT n.id, n.name, n.node_type, n.file_path, 0 AS depth, ARRAY[n.id] AS visited
      FROM ast_nodes n
      WHERE n.org_id = ${orgId} AND n.repo_id = ${repoId} AND n.name = ${entityName}
      UNION ALL
      SELECT n.id, n.name, n.node_type, n.file_path, d.depth + 1, d.visited || n.id
      FROM deps d
      JOIN ast_edges e ON e.from_node = d.id AND e.org_id = ${orgId}
                      AND e.edge_type IN ('CALLS','USAGE','IMPORTS')
      JOIN ast_nodes n ON n.id = e.to_node AND n.org_id = ${orgId}
      WHERE d.depth < ${maxDepth} AND NOT (n.id = ANY(d.visited))
    )
    SELECT DISTINCT id, name, node_type, file_path, depth FROM deps WHERE depth > 0 ORDER BY depth
  `);
  return (result as any).rows ?? result;
}
