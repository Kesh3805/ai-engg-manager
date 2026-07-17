import { simpleGit, type SimpleGit } from 'simple-git';

/**
 * Pure git-log parser. No DB, no GitHub API — takes a local (bare) clone and
 * returns structured commits. All identity resolution happens elsewhere.
 */

export interface GitCommit {
  sha: string;
  authorName: string;
  authorEmail: string;
  message: string; // subject line only
  committedAt: Date;
  filesChanged: number;
  additions: number;
  deletions: number;
  /** Paths touched by this commit (from --numstat). */
  files: string[];
}

export interface ParseOptions {
  /** Walk only `sinceSha..HEAD`. Omit for a full `--all` history walk (first sync). */
  sinceSha?: string;
  /** Safety valve for pathological repos. Default 100_000. */
  maxCommits?: number;
}

// Field and record separators unlikely to appear in commit messages.
const FIELD = '\x1f'; // ASCII unit separator
const RECORD = '\x1e'; // ASCII record separator
const FORMAT = `${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%s`;

export function openRepo(cloneDir: string): SimpleGit {
  return simpleGit(cloneDir);
}

/**
 * Parse commit history from a local clone. Uses a single `git log --numstat`
 * invocation — one process regardless of history size.
 */
export async function parseHistory(cloneDir: string, opts: ParseOptions = {}): Promise<GitCommit[]> {
  const git = openRepo(cloneDir);
  const args = ['log', `--format=${FORMAT}`, '--numstat', '--no-renames', `--max-count=${opts.maxCommits ?? 100_000}`];
  if (opts.sinceSha) args.push(`${opts.sinceSha}..HEAD`);
  else args.push('--all');

  const raw = await git.raw(args);
  return parseLogOutput(raw);
}

/** Pure text→struct parser, exported separately so tests need no git binary. */
export function parseLogOutput(raw: string): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const chunk of raw.split(RECORD)) {
    if (!chunk.trim()) continue;
    const [header, ...bodyLines] = chunk.split('\n');
    const [sha, authorName, authorEmail, isoDate, subject] = (header ?? '').split(FIELD);
    if (!sha || !isoDate) continue;

    let additions = 0;
    let deletions = 0;
    const files: string[] = [];
    for (const line of bodyLines) {
      // numstat: "<added>\t<deleted>\t<path>"; binary files use "-".
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m) continue;
      if (m[1] !== '-') additions += Number(m[1]);
      if (m[2] !== '-') deletions += Number(m[2]);
      files.push(m[3]!);
    }

    commits.push({
      sha,
      authorName: authorName ?? '',
      authorEmail: (authorEmail ?? '').toLowerCase(),
      message: subject ?? '',
      committedAt: new Date(isoDate),
      filesChanged: files.length,
      additions,
      deletions,
      files,
    });
  }
  return commits;
}

/** HEAD sha of the clone (used to advance repositories.last_commit_indexed_sha). */
export async function headSha(cloneDir: string): Promise<string> {
  const git = openRepo(cloneDir);
  return (await git.revparse(['HEAD'])).trim();
}
