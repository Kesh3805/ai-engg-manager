import { z } from 'zod';
import { SECURITY_SYSTEM_PROMPT } from '../prompts.js';
import { completeJson } from '../llm.js';

/**
 * Security synthesis agent (plan 3a-2 / §9). Light tier (Claude Haiku /
 * Llama-8B class). SYNTHESIZER, not a scanner: input is gitleaks + semgrep
 * JSON only, and output findings that don't map back to a scanner rule id
 * are dropped post-hoc — the agent cannot invent findings.
 */

export const SecurityFindingSchema = z.object({
  findings: z.array(
    z.object({
      scanner: z.enum(['gitleaks', 'semgrep']),
      ruleId: z.string(),
      filePath: z.string(),
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      explanation: z.string(),
      suggestedFix: z.string(),
    }),
  ),
  summary: z.string(),
});

export type SecurityFindings = z.infer<typeof SecurityFindingSchema>;

export interface ScannerFinding {
  scanner: 'gitleaks' | 'semgrep';
  ruleId: string;
  filePath: string;
  rawSeverity: string;
  description: string;
}

export const securityAgent = {
  id: 'security-agent',
  description: 'Security synthesizer — explains and prioritizes gitleaks/semgrep output. Never invents findings.',
  modelTier: 'light',
  agentVersion: 'security/1',
} as const;

export async function runSecuritySynthesis(scannerFindings: ScannerFinding[]): Promise<SecurityFindings> {
  if (scannerFindings.length === 0) {
    return { findings: [], summary: 'No scanner findings.' };
  }

  const user = `Scanner output (${scannerFindings.length} findings):\n${JSON.stringify(scannerFindings, null, 2)}`;
  const result = await completeJson(SecurityFindingSchema, SECURITY_SYSTEM_PROMPT, user, 'light');

  // Hard guarantee: drop anything not traceable to actual scanner output.
  const validRuleIds = new Set(scannerFindings.map((f) => `${f.scanner}:${f.ruleId}`));
  result.findings = result.findings.filter((f) => validRuleIds.has(`${f.scanner}:${f.ruleId}`));
  return result;
}
