import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ScannerFinding } from '@repo/mastra-agents';

const execFileAsync = promisify(execFile);

/**
 * Shells to the PINNED scanner binaries baked into the worker image
 * (gitleaks 8.18.2, semgrep 1.72.0 — apps/queue-workers/Dockerfile).
 * Never npx, never fetched at runtime (plan §9). Scope: changed files only,
 * so pathological repos can't hang semgrep.
 */

const EXEC_OPTS = { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 } as const;

export async function runGitleaks(cloneDir: string): Promise<ScannerFinding[]> {
  try {
    // --exit-code 0 keeps findings from being reported as process failure.
    const { stdout } = await execFileAsync(
      'gitleaks',
      ['detect', '--source', cloneDir, '--no-banner', '--report-format', 'json', '--report-path', '/dev/stdout', '--exit-code', '0'],
      EXEC_OPTS,
    );
    const parsed = JSON.parse(stdout || '[]') as Array<{ RuleID?: string; File?: string; Description?: string }>;
    return parsed.map((f) => ({
      scanner: 'gitleaks' as const,
      ruleId: f.RuleID ?? 'unknown',
      filePath: f.File ?? '',
      rawSeverity: 'high', // any leaked secret is at least high
      description: f.Description ?? 'Potential secret detected',
    }));
  } catch (err) {
    console.error('[scanners] gitleaks failed:', err);
    return [];
  }
}

export async function runSemgrep(cwd: string, changedFiles: string[]): Promise<ScannerFinding[]> {
  if (changedFiles.length === 0) return [];
  try {
    const { stdout } = await execFileAsync(
      'semgrep',
      ['--config', 'p/security-audit', '--json', '--quiet', ...changedFiles],
      { ...EXEC_OPTS, cwd },
    );
    const parsed = JSON.parse(stdout || '{}') as {
      results?: Array<{ check_id?: string; path?: string; extra?: { severity?: string; message?: string } }>;
    };
    return (parsed.results ?? []).map((r) => ({
      scanner: 'semgrep' as const,
      ruleId: r.check_id ?? 'unknown',
      filePath: r.path ?? '',
      rawSeverity: (r.extra?.severity ?? 'medium').toLowerCase(),
      description: r.extra?.message ?? '',
    }));
  } catch (err) {
    console.error('[scanners] semgrep failed:', err);
    return [];
  }
}
