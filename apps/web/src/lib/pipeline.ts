import { sql } from '@/server/db';
import { getBlastRadius } from '@/server/graph';
import { llm, LLM_MODEL, embed } from '@/server/llm';
import { elasticFullText } from '@/server/search';

export type PipelineEvent =
  | { type: 'phase'; phase: string; label: string; status: 'start' | 'done' }
  | { type: 'tool'; name: string; result: unknown }
  | { type: 'context'; context: RetrievedContext }
  | { type: 'text'; chunk: string }
  | { type: 'meta'; source: 'db'; model: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface RetrievedContext {
  astHits: Array<{ name: string; nodeType: string; filePath: string; lineStart: number }>;
  blastRadius: Array<{ name: string; filePath: string; depth: number }>;
  textHits: Array<{ source: string; snippet: string }>;
  /** EKG neighbors of the matched AST nodes (commits, PRs, incidents, ADRs, people). */
  ekgNeighbors: Array<{ relation: string; kind: string; label: string }>;
  /** Semantically closest ADRs (pgvector cosine over bge-m3 embeddings). */
  adrHits: Array<{ number: number | null; title: string | null; status: string | null; excerpt: string }>;
  /** Top maintenance hotspots for grounding risk answers. */
  hotspotFiles: Array<{ filePath: string; churn: number | null; complexity: number | null }>;
}

interface OriginNode {
  id: string;
  name: string;
  nodeType: string;
  filePath: string;
  lineStart: number;
  complexity?: number | null;
  signature?: string | null;
}

const PHASES = [
  ['retrieval', 'Parallel retrieval (AST · full-text)'],
  ['reasoning', 'Strategic reasoning'],
  ['tools', 'Tool execution'],
  ['synthesis', 'Synthesis'],
  ['memory', 'Observational memory update'],
] as const;

const STOPWORDS = new Set([
  'what', 'where', 'which', 'when', 'how', 'the', 'and', 'for', 'are', 'is', 'of', 'to', 'in', 'on', 'a', 'an',
  'does', 'do', 'changing', 'change', 'used', 'across', 'codebase', 'risky', 'open', 'prs', 'summarize', 'current',
  'state', 'sprint', 'blast', 'radius', 'path', 'safe', 'merge', 'this', 'that', 'with', 'about', 'show', 'me', 'tell',
]);

function extractCandidates(query: string): string[] {
  const words = query.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w.toLowerCase())))];
}

// ── Retrieval ────────────────────────────────────────────────────────────────

async function retrieveAst(query: string): Promise<{ astHits: RetrievedContext['astHits']; blastRadius: RetrievedContext['blastRadius']; origin: OriginNode | null }> {
  const candidates = extractCandidates(query);
  if (candidates.length === 0) return { astHits: [], blastRadius: [], origin: null };

  const lowered = candidates.map((c) => c.toLowerCase());
  const rows = await sql<OriginNode[]>`
    SELECT id, name, node_type AS "nodeType", file_path AS "filePath",
           COALESCE(line_start, 0) AS "lineStart", complexity, signature
    FROM ast_nodes
    WHERE node_type <> 'file' AND lower(name) = ANY(${lowered})
    ORDER BY complexity DESC NULLS LAST
    LIMIT 6`;

  const origin = rows[0] ?? null;
  let blastRadius: RetrievedContext['blastRadius'] = [];
  if (origin) {
    const { affectedIds, depthOf } = await getBlastRadius(origin.id);
    if (affectedIds.length) {
      const detail = await sql<Array<{ id: string; name: string; filePath: string }>>`
        SELECT id::text, name, file_path AS "filePath" FROM ast_nodes WHERE id = ANY(${affectedIds})`;
      blastRadius = detail.map((d) => ({ name: d.name, filePath: d.filePath, depth: depthOf[d.id] ?? 1 }));
      blastRadius.sort((a, b) => a.depth - b.depth);
    }
  }
  return { astHits: rows.map((r) => ({ name: r.name, nodeType: r.nodeType, filePath: r.filePath, lineStart: r.lineStart })), blastRadius, origin };
}

/** EKG neighbors of matched AST nodes: who touched them, what shipped them, what broke (plan 4b-12). */
async function retrieveEkgNeighbors(nodeIds: string[]): Promise<RetrievedContext['ekgNeighbors']> {
  if (nodeIds.length === 0) return [];
  try {
    const rows = await sql<Array<{ relation: string; kind: string; label: string }>>`
      SELECT e.edge_type AS relation, e.from_type AS kind,
             COALESCE(u.github_login, left(c.message, 60), '#' || p.number || ' ' || left(p.title, 50), i.title, 'unknown') AS label
      FROM ekg_edges e
      LEFT JOIN ekg_users u   ON e.from_type = 'user'   AND u.id = e.from_id AND u.org_id = e.org_id
      LEFT JOIN git_commits c ON e.from_type = 'commit' AND c.id = e.from_id AND c.org_id = e.org_id
      LEFT JOIN pull_requests p ON e.from_type = 'pr'   AND p.id = e.from_id AND p.org_id = e.org_id
      LEFT JOIN incidents i   ON e.from_type = 'incident' AND i.id = e.from_id AND i.org_id = e.org_id
      WHERE e.valid_until IS NULL AND e.to_type = 'ast_node' AND e.to_id = ANY(${nodeIds})
      ORDER BY e.updated_at DESC
      LIMIT 15`;
    return rows.filter((r) => r.label && r.label !== 'unknown');
  } catch {
    return [];
  }
}

/** ADR semantic recall via pgvector cosine over bge-m3 embeddings. */
async function retrieveAdrs(query: string): Promise<RetrievedContext['adrHits']> {
  try {
    const [vec] = await embed([query], 'query');
    if (!vec?.length) return [];
    return await sql<RetrievedContext['adrHits']>`
      SELECT number, title, status, left(content, 300) AS excerpt
      FROM adrs
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${`[${vec.join(',')}]`}::vector
      LIMIT 3`;
  } catch {
    return [];
  }
}

/** Top 3 maintenance hotspots — churn × complexity flagged files. */
async function retrieveHotspots(): Promise<RetrievedContext['hotspotFiles']> {
  try {
    return await sql<RetrievedContext['hotspotFiles']>`
      SELECT file_path AS "filePath", churn_score AS churn, complexity_score AS complexity
      FROM hotspots ORDER BY churn_score DESC NULLS LAST LIMIT 3`;
  } catch {
    return [];
  }
}

async function retrieve(query: string): Promise<{ context: RetrievedContext; origin: OriginNode | null }> {
  const [ast, textHits, adrHits, hotspotFiles] = await Promise.all([
    retrieveAst(query),
    elasticFullText(query).catch(() => []),
    retrieveAdrs(query),
    retrieveHotspots(),
  ]);
  const matchedIds = ast.origin ? [ast.origin.id] : [];
  const ekgNeighbors = await retrieveEkgNeighbors(matchedIds);
  return {
    origin: ast.origin,
    context: { astHits: ast.astHits, blastRadius: ast.blastRadius, textHits, ekgNeighbors, adrHits, hotspotFiles },
  };
}

// ── Synthesis ────────────────────────────────────────────────────────────────

const SYNTH_SYSTEM =
  'You are an AI Engineering Manager and Tech Lead. Answer the engineering question using ONLY the provided context (AST graph hits, blast radius, knowledge-graph neighbors, ADR excerpts, maintenance hotspots, and full-text hits from Slack/Jira/Linear). Reference exact files, symbols, ADR numbers and tickets. When risk is discussed, cite the hotspot files and blast radius explicitly. Lead with the answer, then the supporting evidence in markdown. If the context is empty, say so plainly and suggest indexing a repository — never invent files, symbols or tickets.';

async function* liveSynthesis(query: string, ctx: RetrievedContext): AsyncGenerator<string> {
  const stream = await llm.chat.completions.create({
    model: LLM_MODEL,
    stream: true,
    temperature: 0.3,
    max_tokens: 900,
    messages: [
      { role: 'system', content: SYNTH_SYSTEM },
      { role: 'user', content: `<query>${query}</query>\n<context>${JSON.stringify(ctx)}</context>` },
    ],
  });
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  text: string;
  context: RetrievedContext;
  model: string;
}

export async function* runPipeline(query: string): AsyncGenerator<PipelineEvent> {
  try {

    yield { type: 'phase', phase: 'retrieval', label: PHASES[0][1], status: 'start' };
    const { context, origin } = await retrieve(query);
    yield { type: 'meta', source: 'db', model: LLM_MODEL };
    yield { type: 'context', context };
    yield { type: 'phase', phase: 'retrieval', label: PHASES[0][1], status: 'done' };

    yield { type: 'phase', phase: 'reasoning', label: PHASES[1][1], status: 'start' };
    yield { type: 'phase', phase: 'reasoning', label: PHASES[1][1], status: 'done' };

    yield { type: 'phase', phase: 'tools', label: PHASES[2][1], status: 'start' };
    if (origin) yield { type: 'tool', name: 'blastRadius', result: { entity: origin.name, affected: context.blastRadius.length } };
    if (context.textHits.length) yield { type: 'tool', name: 'searchTickets', result: { hits: context.textHits.length } };
    yield { type: 'phase', phase: 'tools', label: PHASES[2][1], status: 'done' };

    yield { type: 'phase', phase: 'synthesis', label: PHASES[3][1], status: 'start' };
    for await (const chunk of liveSynthesis(query, context)) yield { type: 'text', chunk };
    yield { type: 'phase', phase: 'synthesis', label: PHASES[3][1], status: 'done' };

    yield { type: 'phase', phase: 'memory', label: PHASES[4][1], status: 'start' };
    yield { type: 'phase', phase: 'memory', label: PHASES[4][1], status: 'done' };
    yield { type: 'done' };
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : 'pipeline failed' };
  }
}

/** Non-streaming variant used for persistence (returns the full synthesised text + context). */
export async function runPipelineCollect(query: string): Promise<PipelineResult> {
  const { context } = await retrieve(query);
  let text = '';
  for await (const chunk of liveSynthesis(query, context)) text += chunk;
  return { text, context, model: LLM_MODEL };
}
