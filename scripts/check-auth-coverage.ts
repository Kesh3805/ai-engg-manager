/**
 * Auth coverage gate (plan §3.5, Gate B). Every API route handler under
 * apps/web/src/app/api must contain one of:
 *
 *   requireOrgListAccess / requireResourceAccess / requireRole / requireSession  → pass
 *   // PUBLIC_ROUTE                                                             → pass
 *   // TODO: requireRole('...')                                                 → warning
 *   nothing                                                                     → FAILURE (exit 1)
 *
 * Run: pnpm tsx scripts/check-auth-coverage.ts
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const API_ROOT = join(process.cwd(), 'apps', 'web', 'src', 'app', 'api');

const GUARDS = [
  'requireOrgListAccess(',
  'requireResourceAccess(',
  'requireRole(',
  'requireSession(',
];
const PUBLIC_MARKER = '// PUBLIC_ROUTE';
const TODO_MARKER = /\/\/\s*TODO:\s*requireRole\(/;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === 'route.ts' || entry.name === 'route.tsx') out.push(full);
  }
  return out;
}

const files = routeFiles(API_ROOT);
let errors = 0;
let warnings = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = file.slice(process.cwd().length + 1);

  if (GUARDS.some((g) => src.includes(g)) || src.includes(PUBLIC_MARKER)) continue;

  if (TODO_MARKER.test(src)) {
    warnings += 1;
    console.warn(`WARN  ${rel} — auth deferred via TODO marker`);
    continue;
  }

  errors += 1;
  console.error(`ERROR ${rel} — no auth guard and no PUBLIC_ROUTE marker`);
}

console.log(`\nauth-coverage: ${files.length} route(s), ${errors} error(s), ${warnings} warning(s)`);
if (errors > 0) process.exit(1);
