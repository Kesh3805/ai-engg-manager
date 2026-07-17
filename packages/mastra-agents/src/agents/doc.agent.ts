import { DOC_AGENT_SYSTEM_PROMPT } from '../prompts.js';
import { completeText } from '../llm.js';

/**
 * Documentation agent (plan 3c-1). Light tier (cost-efficient structured
 * diff generation). Opt-in per repo; all safeguards (weekly claim, 200-line
 * cap, label rules) live in doc-generation.worker.ts.
 */

export interface DocAgentInput {
  astDiff: string; // human-readable summary of changed entities
  docs: Array<{ path: string; content: string }>;
}

export interface DocAgentResult {
  /** Unified diff over doc files only; empty string when nothing to change. */
  diff: string;
  changedLines: number;
}

// Named docWriterAgent to avoid colliding with the legacy declarative
// `docAgent` in ../agents.ts (kept for the chat pipeline).
export const docWriterAgent = {
  id: 'doc-writer-agent',
  description: 'Technical writer — emits minimal unified-diff patches for docs invalidated by code changes.',
  modelTier: 'light',
  agentVersion: 'doc/1',
} as const;

export function countChangedLines(diff: string): number {
  return diff
    .split('\n')
    .filter((l) => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---'))
    .length;
}

export async function runDocAgent(input: DocAgentInput): Promise<DocAgentResult> {
  const user = [
    `AST diff of changed source files:`,
    input.astDiff,
    ``,
    `Current documentation files:`,
    ...input.docs.map((d) => `\n===== ${d.path} =====\n${d.content.slice(0, 8_000)}`),
  ].join('\n');

  const output = (await completeText(DOC_AGENT_SYSTEM_PROMPT, user, 'light')).trim();
  if (!output || output === 'NO_CHANGES') return { diff: '', changedLines: 0 };

  // Strip a fence if the model added one.
  const fenced = /```(?:diff)?\s*([\s\S]*?)```/.exec(output);
  const diff = (fenced ? fenced[1]! : output).trim();
  if (!diff.includes('--- a/')) return { diff: '', changedLines: 0 }; // not a diff — refuse rather than guess

  return { diff, changedLines: countChangedLines(diff) };
}
