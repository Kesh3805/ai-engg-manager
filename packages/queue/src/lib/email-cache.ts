import { eq, sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { emailUserCache } from '@repo/db/schema';
import type { EmailCacheStore, EmailCacheEntry } from '@repo/integrations';

/**
 * DB-backed implementation of the integrations package's EmailCacheStore,
 * over the global (cross-tenant) email_user_cache table. Expired rows are
 * treated as misses; the retention worker deletes them physically.
 */
export const dbEmailCache: EmailCacheStore = {
  async get(email: string): Promise<EmailCacheEntry | null> {
    const row = await db.query.emailUserCache.findFirst({ where: eq(emailUserCache.email, email) });
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    return {
      email: row.email,
      githubLogin: row.githubLogin,
      isBot: row.isBot ?? false,
      failureCount: row.failureCount ?? 0,
    };
  },

  async put(entry: EmailCacheEntry): Promise<void> {
    await db
      .insert(emailUserCache)
      .values({
        email: entry.email,
        githubLogin: entry.githubLogin,
        isBot: entry.isBot,
        resolvedAt: entry.githubLogin ? new Date() : null,
        failedAt: entry.failureCount > 0 ? new Date() : null,
        failureCount: entry.failureCount,
      })
      .onConflictDoUpdate({
        target: emailUserCache.email,
        set: {
          githubLogin: entry.githubLogin,
          isBot: entry.isBot,
          resolvedAt: entry.githubLogin ? new Date() : null,
          failedAt: entry.failureCount > 0 ? new Date() : null,
          failureCount: sql`${emailUserCache.failureCount} + ${entry.failureCount}`,
          expiresAt: sql`now() + interval '180 days'`,
        },
      });
  },
};
