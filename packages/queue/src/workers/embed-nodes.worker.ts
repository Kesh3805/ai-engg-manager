import { Worker } from 'bullmq';
import { inArray, sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { astNodes } from '@repo/db/schema';
import { redis } from '../redis.js';
import type { EmbedNodesJob } from '../queues.js';

type NodeRow = typeof astNodes.$inferSelect;

/** Builds the text fed to the embedding model, tuned per node type. */
export function buildEmbedText(node: NodeRow): string {
  const meta = (node.metadata ?? {}) as Record<string, any>;
  switch (node.nodeType) {
    case 'function':
    case 'method':
      return [node.signature, meta.docstring, meta.bodyLines <= 50 ? meta.body : null]
        .filter(Boolean)
        .join('\n')
        .slice(0, 3000);
    case 'class':
    case 'interface':
      return [node.signature, meta.propertyNames?.join(', '), meta.methodSignatures?.join('\n')]
        .filter(Boolean)
        .join('\n')
        .slice(0, 2000);
    case 'enum':
      return [`enum ${node.name}`, meta.members?.join(', '), meta.docstring].filter(Boolean).join('\n');
    default:
      return node.qualifiedName;
  }
}

export const embedNodesWorker = new Worker(
  'embed-nodes',
  async (job) => {
    const { orgId, nodeIds } = job.data as EmbedNodesJob;
    if (!process.env.OPENAI_API_KEY) return; // embeddings disabled when no provider key is configured

    const nodes = await db.query.astNodes.findMany({ where: inArray(astNodes.id, nodeIds) });
    if (nodes.length === 0) return;

    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', dimensions: 512, input: nodes.map(buildEmbedText) }),
    });
    const { data } = (await response.json()) as { data: { embedding: number[] }[] };

    for (let i = 0; i < nodes.length; i++) {
      const vec = data[i]?.embedding;
      if (!vec) continue;
      await db.execute(sql`
        UPDATE ast_nodes SET embedding = ${`[${vec.join(',')}]`}::vector
        WHERE id = ${nodes[i]!.id} AND org_id = ${orgId}
      `);
    }
  },
  { connection: redis, concurrency: 3 },
);
