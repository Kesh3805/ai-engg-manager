import type { GitCommit } from './parser.js';

/**
 * File-ownership aggregation. Pure function over parsed commits — the
 * scorecard's `ownership` metric is "% of files where one author has >50% of
 * commits", which falls straight out of commit/file pairs without running
 * `git blame` per file.
 */

export interface FileOwnership {
  filePath: string;
  topAuthorEmail: string;
  topAuthorShare: number; // 0–1
  totalCommits: number;
}

export function aggregateOwnership(commits: GitCommit[]): FileOwnership[] {
  const byFile = new Map<string, Map<string, number>>();
  for (const commit of commits) {
    if (!commit.authorEmail) continue;
    for (const file of commit.files) {
      let authors = byFile.get(file);
      if (!authors) byFile.set(file, (authors = new Map()));
      authors.set(commit.authorEmail, (authors.get(commit.authorEmail) ?? 0) + 1);
    }
  }

  const out: FileOwnership[] = [];
  for (const [filePath, authors] of byFile) {
    let topAuthorEmail = '';
    let topCount = 0;
    let total = 0;
    for (const [email, count] of authors) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topAuthorEmail = email;
      }
    }
    out.push({ filePath, topAuthorEmail, topAuthorShare: total ? topCount / total : 0, totalCommits: total });
  }
  return out;
}

/** Scorecard input: share of files with a >50% single-author majority. */
export function ownershipScore(ownership: FileOwnership[]): number | null {
  if (ownership.length === 0) return null;
  const owned = ownership.filter((f) => f.topAuthorShare > 0.5).length;
  return Math.round((owned / ownership.length) * 100);
}
