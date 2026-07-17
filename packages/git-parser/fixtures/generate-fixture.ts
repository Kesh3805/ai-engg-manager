/**
 * Generates the synthetic large-repo git bundle used by the incremental-sync
 * perf gate (Phase 2B Gate B — not required per PR).
 *
 *   pnpm --filter @repo/git-parser generate-fixture [commitCount]
 *
 * Default 50_000 commits (~15 MB bundle). The bundle is written to
 * fixtures/large-repo.bundle and is NOT committed by default — regenerate it
 * locally or in the nightly perf job (deterministic content, seeded below).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMITS = Number(process.argv[2] ?? 50_000);
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'large-repo.bundle');

const AUTHORS = [
  ['Ada Lovelace', 'ada@example.com'],
  ['Grace Hopper', 'grace@example.com'],
  ['Margaret Hamilton', 'margaret@example.com'],
  ['bot-deployer[bot]', 'bot-deployer[bot]@users.noreply.github.com'],
] as const;

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

const dir = mkdtempSync(join(tmpdir(), 'aiem-fixture-'));
console.log(`[fixture] building ${COMMITS} commits in ${dir}`);

git(dir, ['init', '-q', '-b', 'main']);
writeFileSync(join(dir, 'README.md'), '# synthetic fixture\n');
git(dir, ['add', '.']);

// Deterministic pseudo-random (LCG) so the fixture is reproducible.
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

for (let i = 0; i < COMMITS; i++) {
  const [name, email] = AUTHORS[Math.floor(rand() * AUTHORS.length)]!;
  const file = `src/module-${Math.floor(rand() * 200)}.ts`;
  appendFileSync(join(dir, 'README.md'), `${i}\n`); // guarantee a change
  writeFileSync(join(dir, file.replace('/', '_')), `// rev ${i}\nexport const v = ${i};\n`);
  git(dir, ['add', '.']);
  const when = new Date(Date.UTC(2020, 0, 1) + i * 60_000).toISOString();
  git(dir, ['commit', '-q', '-m', `commit ${i}: update ${file}`], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: when,
  });
  if (i % 5000 === 0 && i > 0) console.log(`[fixture] ${i}/${COMMITS}`);
}

git(dir, ['bundle', 'create', OUT, '--all']);
rmSync(dir, { recursive: true, force: true });
console.log(`[fixture] wrote ${OUT}`);
