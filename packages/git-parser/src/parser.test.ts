import { describe, it, expect } from 'vitest';
import { parseLogOutput } from './parser.js';
import { aggregateOwnership, ownershipScore } from './blame.js';

const FIELD = '\x1f';
const RECORD = '\x1e';

function record(sha: string, name: string, email: string, iso: string, subject: string, numstat: string[]): string {
  return `${RECORD}${sha}${FIELD}${name}${FIELD}${email}${FIELD}${iso}${FIELD}${subject}\n${numstat.join('\n')}\n`;
}

describe('parseLogOutput', () => {
  it('parses commits with numstat aggregation', () => {
    const raw =
      record('abc123', 'Ada', 'ADA@Example.com', '2024-01-02T03:04:05+00:00', 'feat: add parser', [
        '10\t2\tsrc/a.ts',
        '3\t1\tsrc/b.ts',
      ]) +
      record('def456', 'Grace', 'grace@example.com', '2024-01-03T00:00:00+00:00', 'fix: binary asset', [
        '-\t-\tassets/logo.png',
      ]);

    const commits = parseLogOutput(raw);
    expect(commits).toHaveLength(2);

    const [first, second] = commits;
    expect(first!.sha).toBe('abc123');
    expect(first!.authorEmail).toBe('ada@example.com'); // normalized lowercase
    expect(first!.additions).toBe(13);
    expect(first!.deletions).toBe(3);
    expect(first!.filesChanged).toBe(2);
    expect(first!.files).toEqual(['src/a.ts', 'src/b.ts']);

    expect(second!.additions).toBe(0); // binary files don't count
    expect(second!.files).toEqual(['assets/logo.png']);
  });

  it('ignores empty chunks and malformed headers', () => {
    expect(parseLogOutput('')).toEqual([]);
    expect(parseLogOutput(`${RECORD}garbage-without-fields\n`)).toEqual([]);
  });
});

describe('ownership aggregation', () => {
  it('computes per-file majority ownership', () => {
    const commits = parseLogOutput(
      record('c1', 'Ada', 'ada@x.com', '2024-01-01T00:00:00+00:00', 'a', ['1\t0\tsrc/core.ts']) +
        record('c2', 'Ada', 'ada@x.com', '2024-01-02T00:00:00+00:00', 'b', ['1\t0\tsrc/core.ts']) +
        record('c3', 'Grace', 'grace@x.com', '2024-01-03T00:00:00+00:00', 'c', ['1\t0\tsrc/core.ts', '1\t0\tsrc/util.ts']) +
        record('c4', 'Ada', 'ada@x.com', '2024-01-04T00:00:00+00:00', 'd', ['1\t0\tsrc/util.ts']),
    );

    const ownership = aggregateOwnership(commits);
    const core = ownership.find((f) => f.filePath === 'src/core.ts')!;
    expect(core.topAuthorEmail).toBe('ada@x.com');
    expect(core.topAuthorShare).toBeCloseTo(2 / 3);

    // core.ts has a >50% owner; util.ts is a 50/50 split (no majority)
    expect(ownershipScore(ownership)).toBe(50);
  });

  it('returns null score for empty input', () => {
    expect(ownershipScore([])).toBeNull();
  });
});
