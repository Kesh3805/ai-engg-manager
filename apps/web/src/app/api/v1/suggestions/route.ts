import { sql } from '@/server/db';
import { requireRole } from '@/server/auth-guard';
import { errorResponse } from '@/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Suggested prompts grounded in the actual indexed graph (most-depended-on + complex entities). */
export async function GET() {
  try {
    await requireRole('viewer');
  } catch (err) {
    return errorResponse(err);
  }

  const depended = await sql<Array<{ name: string }>>`
    SELECT n.name FROM ast_nodes n JOIN ast_edges e ON e.to_node = n.id
    WHERE e.edge_type IN ('CALLS','USAGE','IMPLEMENTS') AND n.node_type <> 'file'
    GROUP BY n.id, n.name ORDER BY count(*) DESC LIMIT 3`;

  const complex = await sql<Array<{ name: string }>>`
    SELECT name FROM ast_nodes WHERE node_type <> 'file' AND complexity IS NOT NULL
    ORDER BY complexity DESC LIMIT 2`;

  const suggestions: string[] = [];
  for (const r of depended) suggestions.push(`What is the blast radius of changing \`${r.name}\`?`);
  if (complex[0]) suggestions.push(`Explain what \`${complex[0].name}\` does and how risky it is to change.`);
  suggestions.push('Summarize the architecture and the most-depended-on parts of the codebase.');

  return Response.json({ suggestions: [...new Set(suggestions)].slice(0, 4) });
}
