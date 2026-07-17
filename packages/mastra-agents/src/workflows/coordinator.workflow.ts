import { runDesignReview, type DesignReviewInput, type FindingList } from '../agents/design-review.agent.js';
import { runSecuritySynthesis, type ScannerFinding, type SecurityFindings } from '../agents/security.agent.js';

/**
 * Multi-agent coordinator (plan 4c-1).
 *
 * On PR opened/synchronize: DesignReviewAgent ∥ SecurityAgent → merged into a
 * single structured PR comment (this module).
 * On merge to main: DocAgent → ADRIngestion, sequential (`coordinateMergeToMain`,
 * driven by the workers that own the side effects).
 * On incident: IncidentAgent → staging channel (incident-analysis.worker).
 */

export interface PrReviewResult {
  design: FindingList;
  security: SecurityFindings;
  comment: string;
}

export async function coordinatePrReview(
  designInput: DesignReviewInput,
  scannerFindings: ScannerFinding[],
): Promise<PrReviewResult> {
  // Parallel by design — the two agents share no state.
  const [design, security] = await Promise.all([
    runDesignReview(designInput),
    runSecuritySynthesis(scannerFindings),
  ]);
  return { design, security, comment: renderPrComment(design, security) };
}

const SEVERITY_ICON: Record<string, string> = { critical: '🟥', high: '🟧', medium: '🟨', low: '🟦' };

/** Single structured comment merging both agents' findings. */
export function renderPrComment(design: FindingList, security: SecurityFindings): string {
  const lines: string[] = ['## 🤖 AI Review', ''];

  lines.push(`**Blast score:** ${design.blastScore}/100`);
  lines.push('');

  if (design.violations.length > 0) {
    lines.push('### Architecture violations');
    for (const v of design.violations) {
      lines.push(`- ${SEVERITY_ICON[v.severity] ?? ''} **${v.rule}** in \`${v.filePath}\` — ${v.detail}`);
    }
    lines.push('');
  }

  if (design.circularDeps.length > 0) {
    lines.push('### Circular dependencies');
    for (const c of design.circularDeps) {
      lines.push(`- \`${c.cycle.join(' → ')}\` — ${c.detail}`);
    }
    lines.push('');
  }

  if (security.findings.length > 0) {
    lines.push('### Security findings');
    for (const f of security.findings) {
      lines.push(
        `- ${SEVERITY_ICON[f.severity] ?? ''} \`${f.ruleId}\` (${f.scanner}) in \`${f.filePath}\` — ${f.explanation}\n  - Fix: ${f.suggestedFix}`,
      );
    }
    lines.push('');
  }

  if (design.refactor.length > 0) {
    lines.push('### Refactor suggestions');
    for (const r of design.refactor) lines.push(`- \`${r.filePath}\`: ${r.suggestion}`);
    lines.push('');
  }

  if (design.violations.length + design.circularDeps.length + security.findings.length === 0) {
    lines.push('No architecture or security findings. ✅');
    lines.push('');
  }

  lines.push('---');
  lines.push('_AI-generated review (design-review + security agents). Verify before acting._');
  return lines.join('\n');
}

/** Merge-to-main sequencing: docs first, then ADR ingestion — never parallel. */
export async function coordinateMergeToMain(steps: {
  runDocGeneration: () => Promise<void>;
  runAdrIngestion: () => Promise<void>;
}): Promise<void> {
  await steps.runDocGeneration();
  await steps.runAdrIngestion();
}
