/**
 * Minimal, strict unified-diff utilities for the doc agent. Deliberately
 * conservative: any hunk that doesn't apply cleanly aborts the whole file
 * (returns null) — a wrong doc edit is worse than no doc edit.
 */

/** Split a multi-file unified diff into per-file diffs keyed by new path. */
export function splitDiffByFile(diff: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = diff.split(/^(?=--- )/m).filter((p) => p.startsWith('--- '));
  for (const part of parts) {
    const m = /^\+\+\+ b\/(.+)$/m.exec(part);
    if (m) out.set(m[1]!.trim(), part);
  }
  return out;
}

/** Apply one file's unified diff to its original content. Null on any mismatch. */
export function applyUnifiedDiff(original: string, fileDiff: string): string | null {
  const lines = original.split('\n');
  const result: string[] = [];
  let cursor = 0; // index into `lines`

  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;
  const diffLines = fileDiff.split('\n');
  let i = 0;

  while (i < diffLines.length) {
    const header = hunkRe.exec(diffLines[i] ?? '');
    if (!header) {
      i++;
      continue;
    }
    const oldStart = Number(header[1]) - 1;
    if (oldStart < cursor || oldStart > lines.length) return null;

    // Copy untouched region.
    result.push(...lines.slice(cursor, oldStart));
    cursor = oldStart;
    i++;

    while (i < diffLines.length && !hunkRe.test(diffLines[i] ?? '') && !(diffLines[i] ?? '').startsWith('--- ')) {
      const line = diffLines[i] ?? '';
      if (line.startsWith(' ')) {
        if (lines[cursor] !== line.slice(1)) return null; // context mismatch
        result.push(lines[cursor]!);
        cursor++;
      } else if (line.startsWith('-')) {
        if (lines[cursor] !== line.slice(1)) return null; // deletion mismatch
        cursor++;
      } else if (line.startsWith('+')) {
        result.push(line.slice(1));
      } else if (line === '' || line.startsWith('\\')) {
        // trailing blank / "\ No newline" marker — ignore
      } else {
        return null;
      }
      i++;
    }
  }

  result.push(...lines.slice(cursor));
  return result.join('\n');
}
