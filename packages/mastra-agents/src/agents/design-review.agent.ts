import { z } from 'zod';
import { DESIGN_REVIEW_SYSTEM_PROMPT } from '../prompts.js';
import { completeJson } from '../llm.js';

/**
 * Design-review agent (plan 3a-1). Heavy tier (Claude Sonnet / Llama-70B
 * class) — architecture reasoning. The worker gathers the context (blast
 * radius CTE, ADRs, layer rules); this module owns prompt + output contract.
 */

export const FindingListSchema = z.object({
  violations: z.array(
    z.object({
      rule: z.string(),
      filePath: z.string(),
      detail: z.string(),
      severity: z.enum(['high', 'medium', 'low']),
    }),
  ),
  circularDeps: z.array(z.object({ cycle: z.array(z.string()), detail: z.string() })),
  blastScore: z.number().min(0).max(100),
  refactor: z.array(z.object({ filePath: z.string(), suggestion: z.string() })),
});

export type FindingList = z.infer<typeof FindingListSchema>;

export interface DesignReviewInput {
  prTitle: string;
  changedFiles: string[];
  blastRadius: Array<{ name: string; nodeType: string; filePath: string; depth: number }>;
  totalGraphNodes: number;
  adrs: Array<{ number: number | null; title: string | null; status: string | null; excerpt: string }>;
  layerRules: string[];
  /** Pre-computed import cycles among changed files (deterministic, from the AST). */
  detectedCycles: string[][];
}

export const designReviewAgent = {
  id: 'design-review-agent',
  description: 'Principal architect — reviews PRs against ADRs, blast radius and layer contracts.',
  modelTier: 'heavy',
  agentVersion: 'design-review/1',
} as const;

export async function runDesignReview(input: DesignReviewInput): Promise<FindingList> {
  const user = [
    `PR: ${input.prTitle}`,
    `Changed files:\n${input.changedFiles.map((f) => `- ${f}`).join('\n') || '(none)'}`,
    `Blast radius (${input.blastRadius.length} of ${input.totalGraphNodes} graph nodes):`,
    ...input.blastRadius.slice(0, 100).map((n) => `- [d${n.depth}] ${n.nodeType} ${n.name} (${n.filePath})`),
    `Detected import cycles (from AST, authoritative): ${JSON.stringify(input.detectedCycles)}`,
    `Layer rules:\n${input.layerRules.map((r) => `- ${r}`).join('\n') || '(none defined)'}`,
    `ADRs:`,
    ...input.adrs.slice(0, 20).map((a) => `- ADR-${a.number ?? '?'} [${a.status ?? 'unknown'}] ${a.title ?? ''}: ${a.excerpt}`),
  ].join('\n');

  const result = await completeJson(FindingListSchema, DESIGN_REVIEW_SYSTEM_PROMPT, user, 'heavy');

  // The AST-derived cycles are authoritative — merge any the model dropped.
  const reported = new Set(result.circularDeps.map((c) => c.cycle.join('→')));
  for (const cycle of input.detectedCycles) {
    if (!reported.has(cycle.join('→'))) {
      result.circularDeps.push({ cycle, detail: 'Import cycle detected in the AST graph.' });
    }
  }
  return result;
}
