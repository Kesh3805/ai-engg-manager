import { anthropic } from '@ai-sdk/anthropic';
import { generateText, streamText } from 'ai';
import { REASONING_SYSTEM_PROMPT, SYNTHESIS_SYSTEM_PROMPT, MODEL_IDS } from '../prompts.js';
import { blastRadiusCTE } from '../queries/blast-radius.js';
import { elasticFullText } from '@repo/integrations';

const MODELS = {
  reasoning: anthropic(MODEL_IDS.reasoning),
  execution: anthropic(MODEL_IDS.execution),
};

export interface PipelineInput {
  orgId: string;
  repoId?: string;
  query: string;
  userId: string;
  conversationId?: string;
}

export interface RetrievalPayload {
  astResults: unknown;
  vectorResults: unknown;
  esResults: unknown;
}

function extractEntityName(query: string): string {
  // Heuristic: first PascalCase / camelCase identifier in the query.
  return /([A-Z][A-Za-z0-9]+|[a-z]+[A-Z][A-Za-z0-9]+)/.exec(query)?.[1] ?? '';
}

/** Phase 1 — Parallel retrieval across AST graph, semantic memory, full-text. */
export async function parallelRetrieval(input: PipelineInput): Promise<RetrievalPayload> {
  const entity = extractEntityName(input.query);
  const [astResults, esResults] = await Promise.all([
    input.repoId && entity
      ? blastRadiusCTE(input.orgId, input.repoId, entity).catch(() => [])
      : Promise.resolve([]),
    elasticFullText(input.orgId, input.query).catch(() => []),
  ]);
  return { astResults, vectorResults: [], esResults };
}

/** Phase 2 — Strategic reasoning (Sonnet): produce an execution plan. */
export async function strategicReasoning(input: PipelineInput, retrieval: RetrievalPayload) {
  const { text } = await generateText({
    model: MODELS.reasoning,
    system: REASONING_SYSTEM_PROMPT,
    prompt: [
      `<query>${input.query}</query>`,
      `<ast_context>${JSON.stringify(retrieval.astResults)}</ast_context>`,
      `<semantic_context>${JSON.stringify(retrieval.vectorResults)}</semantic_context>`,
      `<text_context>${JSON.stringify(retrieval.esResults)}</text_context>`,
      'Analyse the query against this context. Identify knowledge gaps. Output a structured execution plan.',
    ].join('\n'),
  });
  return text;
}

/** Phase 4 — Synthesis (Sonnet), streamed token-by-token. */
export function synthesize(input: PipelineInput, retrieval: RetrievalPayload, toolResults: unknown) {
  return streamText({
    model: MODELS.reasoning,
    system: SYNTHESIS_SYSTEM_PROMPT,
    prompt: [
      `<query>${input.query}</query>`,
      `<context>${JSON.stringify({ ...retrieval, toolResults })}</context>`,
      'Synthesise the final answer for the engineering manager.',
    ].join('\n'),
  });
}
