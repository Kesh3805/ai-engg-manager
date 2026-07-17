import { open, unlink, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Per-repo advisory lock (plan §6, secondary guard behind the BullMQ jobId).
 * Implemented as an exclusive-create lock file (portable stand-in for flock):
 * the lock dir lives OUTSIDE the clone dirs so `git gc` and clone wipes never
 * touch it. A lock older than STALE_MS is treated as leaked (crashed worker)
 * and broken.
 */

const STALE_MS = 30 * 60 * 1000;

export function locksDir(): string {
  return process.env.GIT_LOCKS_DIR ?? '/data/git-locks';
}

export function clonesDir(): string {
  return process.env.GIT_CLONES_DIR ?? '/data/git-clones';
}

export async function acquireRepoLock(repoId: string): Promise<(() => Promise<void>) | null> {
  await mkdir(locksDir(), { recursive: true });
  const lockPath = join(locksDir(), `${repoId}.lock`);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      return async () => {
        await unlink(lockPath).catch(() => {});
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > STALE_MS) {
        await unlink(lockPath).catch(() => {}); // break the stale lock, retry once
        continue;
      }
      return null; // actively held — caller skips this run
    }
  }
  return null;
}
