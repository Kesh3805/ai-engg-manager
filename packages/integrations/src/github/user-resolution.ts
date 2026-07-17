import type { Octokit } from '@octokit/rest';

/**
 * Commit author → GitHub login resolution (plan §6), in priority order:
 *
 *   1. PR authorship — payload carries author.login directly. No API call;
 *      callers use that field and never reach this module.
 *   2. GitHub Commits API — batch lookup by sha (50/call budget handled by
 *      the git-history worker).
 *   3. email_user_cache → GitHub Search API — last resort, high miss rate.
 *
 * Bot filter runs before everything: bots never create ekg_users rows.
 *
 * This module is DB-free; the caller supplies an EmailCacheStore so the
 * cross-tenant cache semantics (DATA_RETENTION.md §3) live with the schema.
 */

export interface EmailCacheEntry {
  email: string;
  githubLogin: string | null;
  isBot: boolean;
  failureCount: number;
}

export interface EmailCacheStore {
  get(email: string): Promise<EmailCacheEntry | null>;
  put(entry: EmailCacheEntry): Promise<void>;
}

const BOT_EMAIL_PATTERNS = [/\[bot\]@/i, /^noreply@github\.com$/i, /@users\.noreply\.github\.com$/i];
const BOT_LOGIN_PATTERN = /\[bot\]$/i;

export function isBotEmail(email: string): boolean {
  // GitHub noreply addresses of the form `12345+login@users.noreply.github.com`
  // belong to humans — only flag the bare bot forms.
  if (/^\d+\+.+@users\.noreply\.github\.com$/i.test(email)) return false;
  return BOT_EMAIL_PATTERNS.some((p) => p.test(email));
}

export function isBotLogin(login: string): boolean {
  return BOT_LOGIN_PATTERN.test(login);
}

/** Extract the login from `12345+login@users.noreply.github.com` addresses. */
export function loginFromNoreply(email: string): string | null {
  const m = /^(?:\d+\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/i.exec(email);
  return m ? m[1]! : null;
}

/** Path 2: resolve one commit sha to its author login via the Commits API. */
export async function resolveViaCommitsApi(
  octokit: Octokit,
  owner: string,
  repo: string,
  sha: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getCommit({ owner, repo, ref: sha });
    return data.author?.login ?? null;
  } catch {
    return null;
  }
}

/**
 * Path 3: email → login via cache, then GitHub Search. Every outcome is
 * cached (including failures, with a failure counter) so the rate-limited
 * Search API is hit at most once per email per TTL window.
 */
export async function resolveEmailToLogin(
  email: string,
  octokit: Octokit | null,
  cache: EmailCacheStore,
): Promise<{ login: string | null; isBot: boolean }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { login: null, isBot: false };

  if (isBotEmail(normalized)) {
    await cache.put({ email: normalized, githubLogin: null, isBot: true, failureCount: 0 });
    return { login: null, isBot: true };
  }

  const noreplyLogin = loginFromNoreply(normalized);
  if (noreplyLogin) {
    await cache.put({ email: normalized, githubLogin: noreplyLogin, isBot: false, failureCount: 0 });
    return { login: noreplyLogin, isBot: false };
  }

  const cached = await cache.get(normalized);
  if (cached) return { login: cached.githubLogin, isBot: cached.isBot };

  if (!octokit) return { login: null, isBot: false };

  let login: string | null = null;
  let failureCount = 0;
  try {
    const { data } = await octokit.search.users({ q: `${normalized} in:email`, per_page: 1 });
    login = data.items[0]?.login ?? null;
    if (!login) failureCount = 1;
  } catch {
    failureCount = 1;
  }

  await cache.put({ email: normalized, githubLogin: login, isBot: false, failureCount });
  return { login, isBot: false };
}
